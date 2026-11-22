"""IMGW-PIB historical hydrological warnings and bulletins (danepubliczne.imgw.pl).

The live map apps (hydro.imgw.pl, baltyk.imgw.pl) only show the current
state. History comes from IMGW's own public archive instead:

- /data/arch/ost_hydro/<year>/<month>.zip: one UTF-8 TXT per issued warning,
  change or cancellation, from every hydrological forecast office. The Gdynia
  office covers the coast (storm surges on the Baltic coast and lagoons), so
  this also serves "IMGW - Bałtyk" for coastal flooding. Marine weather
  warnings (gales at sea) are meteorological and are not collected (user).
- /data/dane_pomiarowo_obserwacyjne/Biuletyn_PSHM/: the monthly bulletin of
  the state hydrological service (PDF, text extracted).

Terms (https://danepubliczne.imgw.pl/apiinfo): free re-use with the source
named; the bulletins allow redistribution only verbatim with IMGW-PIB named,
so text is stored as extracted, never rewritten.
"""

from __future__ import annotations

import io
import re
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from typing import Callable, Iterable
from urllib.parse import quote

import requests

from .models import Record
from .sources import HttpSource

BASE = "https://danepubliczne.imgw.pl/data"
ATTRIBUTION = (
    "Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – "
    "Państwowy Instytut Badawczy."
)
KINDS = (
    ("Ostrzeżenie hydrologiczne Nr", "ostrzezenie"),
    ("Zmiana ostrzeżenia Nr", "zmiana"),
    ("Odwołanie ostrzeżenia Nr", "odwolanie"),
)
COAST_WORDS = ("Wybrzeże", "Bałtyk", "morskie wody", "Zalew", "Żuławy", "Mierzeja")
MONTHS_PL = {
    1: "styczen", 2: "luty", 3: "marzec", 4: "kwiecien", 5: "maj", 6: "czerwiec",
    7: "lipiec", 8: "sierpien", 9: "wrzesien", 10: "pazdziernik", 11: "listopad", 12: "grudzien",
}


MONTH_NAMES = {
    1: "styczeń", 2: "luty", 3: "marzec", 4: "kwiecień", 5: "maj", 6: "czerwiec",
    7: "lipiec", 8: "sierpień", 9: "wrzesień", 10: "październik", 11: "listopad", 12: "grudzień",
}


def _months_back(today: date, cutoff: date) -> list[tuple[int, int]]:
    months, y, m = [], cutoff.year, cutoff.month
    while (y, m) <= (today.year, today.month):
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def _dt(day: str | None, clock: str | None) -> str | None:
    """'30.06.2026', '22:55' -> '2026-06-30T22:55' (Europe/Warsaw local time)."""
    if not day:
        return None
    try:
        parsed = datetime.strptime(day.strip(), "%d.%m.%Y")
    except ValueError:
        return None
    if clock and re.fullmatch(r"\d{1,2}:\d{2}", clock.strip()):
        hh, mm = clock.strip().split(":")
        return parsed.replace(hour=int(hh), minute=int(mm)).strftime("%Y-%m-%dT%H:%M")
    return parsed.date().isoformat()


def parse_warning(text: str) -> dict:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^([^:]{2,60}):\s?(.*)$", line)
        if match:
            fields.setdefault(match.group(1).strip(), match.group(2).strip())
    kind, number, ref_date = None, None, None
    # Offices differ in case ("Nr" / "nr"), so labels are matched case-insensitively.
    lowered = {key.lower(): value for key, value in fields.items()}
    for label, name in KINDS:
        if label.lower() in lowered:
            kind = name
            nr = re.match(r"(\d+)(?:\s+z dnia\s+([\d.]+))?", lowered[label.lower()])
            if nr:
                number, ref_date = nr.group(1), nr.group(2)
            break
    issued = re.match(r"([\d.]+)\s*-\s*godz\.\s*([\d:]+)", fields.get("Data i godzina wydania", ""))
    valid = re.match(
        r"od godz\.\s*([\d:]*)\s*dnia\s*([\d.]*)\s*do godz\.\s*([\d:]*)\s*dnia\s*([\d.]*)",
        fields.get("Ważność", ""),
    )
    probability = fields.get("Prawdopodobieństwo wystąpienia zjawiska", "").rstrip("%").strip()
    return {
        "kind": kind,
        "number": number,
        "ref_date": ref_date,
        "issued_at": _dt(issued.group(1), issued.group(2)) if issued else None,
        "valid_from": _dt(valid.group(2), valid.group(1)) if valid else None,
        "valid_to": _dt(valid.group(4), valid.group(3)) if valid else None,
        "office": fields.get("Nazwa biura prognoz hydrologicznych"),
        "phenomenon": fields.get("Zjawisko"),
        "degree": fields.get("Stopień"),
        "area": fields.get("Obszar"),
        "course": fields.get("Przebieg"),
        "probability": probability or None,
        "remarks": fields.get("Uwagi"),
        "sms": fields.get("SMS"),
    }


class ImgwHydroWarningsArchiveSource(HttpSource):
    name = "imgw_hydro_warnings"
    SOURCE_URL = "https://hydro.imgw.pl/"

    def __init__(
        self,
        months: float = 6,
        delay: float = 1.0,
        now: Callable[[], datetime] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        super().__init__(timeout=120)
        current = (now or (lambda: datetime.now(timezone.utc)))()
        self.today = current.date()
        self.cutoff = (current - timedelta(days=round(30.44 * months))).date()
        self.delay = delay
        self.sleep = sleep
        self.stats = {"archives": 0, "files": 0, "kept": 0, "too_old": 0, "unparsed": 0, "failed": 0}
        self.failed_urls: list[str] = []

    def fetch(self) -> Iterable[Record]:
        for year, month in _months_back(self.today, self.cutoff):
            url = f"{BASE}/arch/ost_hydro/{year}/{month:02d}.zip"
            try:
                response = self.get(url)
            except requests.RequestException:
                self.stats["failed"] += 1
                self.failed_urls.append(url)
                continue
            finally:
                self.sleep(self.delay)
            self.stats["archives"] += 1
            archive = zipfile.ZipFile(io.BytesIO(response.content))
            for member in sorted(archive.namelist()):
                if member.endswith("/"):
                    continue
                self.stats["files"] += 1
                raw_bytes = archive.read(member)
                try:
                    text = raw_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    text = raw_bytes.decode("cp1250", errors="replace")
                record = self._record(url, member, text, raw_bytes)
                if record is None:
                    self.stats["unparsed"] += 1
                    continue
                if record.published_at and record.published_at[:10] < self.cutoff.isoformat():
                    self.stats["too_old"] += 1
                    continue
                self.stats["kept"] += 1
                yield record

    def _record(self, archive_url: str, member: str, text: str, raw_bytes: bytes) -> Record | None:
        w = parse_warning(text)
        if not w["kind"] or not w["issued_at"]:
            return None
        label = {"ostrzezenie": "Ostrzeżenie hydrologiczne", "zmiana": "Zmiana ostrzeżenia",
                 "odwolanie": "Odwołanie ostrzeżenia"}[w["kind"]]
        degree = f", stopień {w['degree']}" if w["degree"] and w["degree"] != "nie dotyczy" else ""
        office = (w["office"] or "").split(",")[0]
        area = w["area"] or ""
        regions = re.findall(r"\(([^()]*)\)\s*$", area)
        coast = any(word in area for word in COAST_WORDS)
        content = "\n\n".join(p for p in (w["course"], w["remarks"]) if p and p != "Brak.")
        return Record(
            source=self.name,
            source_url=self.SOURCE_URL,
            detail_url=f"{archive_url}#{member}",
            external_id=member,
            title=f"{label} nr {w['number']}: {w['phenomenon']}{degree} – {office}",
            published_at=w["issued_at"],
            valid_from=w["valid_from"],
            valid_to=w["valid_to"],
            content=f"Obszar: {area}\n\n{content}" if area else content,
            summary=w["sms"],
            category=f"hydro_{w['kind']}" + ("_wybrzeze" if coast else ""),
            location=[r.strip() for r in regions[0].split(",")] if regions else [],
            raw={
                "warning": w,
                "archive": archive_url,
                "file": member,
                "file_sha256": sha256(raw_bytes).hexdigest(),
                "coast": coast,
                "publisher": "IMGW-PIB",
                "source_type": "official",
                "license": ATTRIBUTION,
                "timezone": "Europe/Warsaw",
            },
        )


class ImgwPshmBulletinSource(HttpSource):
    """Monthly bulletins of the state hydrological service (PSHM), text only."""

    name = "imgw_pshm_bulletin"
    SOURCE_URL = f"{BASE}/dane_pomiarowo_obserwacyjne/Biuletyn_PSHM/"

    def __init__(self, months: float = 6, delay: float = 1.0, now: Callable[[], datetime] | None = None) -> None:
        super().__init__(timeout=120)
        current = (now or (lambda: datetime.now(timezone.utc)))()
        self.today = current.date()
        self.cutoff = (current - timedelta(days=round(30.44 * months))).date()
        self.delay = delay
        self.stats = {"bulletins": 0, "missing": 0, "failed": 0}

    def fetch(self) -> Iterable[Record]:
        from pypdf import PdfReader

        for year, month in _months_back(self.today, self.cutoff):
            name = f"Biuletyn_PSHM_{year}_{month:02d}_({MONTHS_PL[month]}).pdf"
            url = self.SOURCE_URL + quote(name)
            try:
                response = self.session.get(url, timeout=self.timeout)
            except requests.RequestException:
                self.stats["failed"] += 1
                continue
            finally:
                time.sleep(self.delay)
            if response.status_code == 404:
                self.stats["missing"] += 1  # the current month is not published yet
                continue
            if not response.ok:
                self.stats["failed"] += 1
                continue
            pages = PdfReader(io.BytesIO(response.content)).pages
            text = "\n\n".join(" ".join((page.extract_text() or "").split()) for page in pages)
            if len(text) < 200:
                self.stats["failed"] += 1
                continue
            self.stats["bulletins"] += 1
            yield Record(
                source=self.name,
                source_url=self.SOURCE_URL,
                detail_url=url,
                external_id=name,
                title=f"Biuletyn PSHM – {MONTH_NAMES[month]} {year}",
                published_at=f"{year}-{month:02d}",
                content=text,
                category="biuletyn_hydrologiczny",
                raw={
                    "pdf_sha256": sha256(response.content).hexdigest(),
                    "pages": len(pages),
                    "publisher": "IMGW-PIB, Państwowa Służba Hydrologiczno-Meteorologiczna",
                    "source_type": "official",
                    "license": ATTRIBUTION + " Rozpowszechnianie wyłącznie w formie dosłownej.",
                },
            )
