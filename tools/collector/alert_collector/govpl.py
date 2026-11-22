"""News lists on www.gov.pl (one template for every ministry and office).

Every unit's news section is the same CMS list: `article .art-prev li` items
with `.title a` and `.event .date`, paged with `?page=N`, newest first; each
article has `h2`, `.event-date`, `.intro` and `.editor-content`. One adapter
with a name and a list URL therefore covers KPRM, MSWiA, RCB and any other
unit. gov.pl text is CC BY-SA 4.0 (https://www.gov.pl/web/gov/warunki-korzystania-z-portalu).

Differences from the older per-unit copies in sources.py: it stops at a date
cutoff instead of a fixed page count, writes ISO dates, keeps paragraphs
intact, waits `delay` seconds between every request, and counts failures.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from typing import Callable, Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

from .models import Record
from .sources import HttpSource

GOV_PL_LICENSE = "CC BY-SA 4.0 (tekst), https://www.gov.pl/web/gov/warunki-korzystania-z-portalu"


@dataclass(frozen=True)
class GovPlUnit:
    name: str
    list_url: str
    publisher: str
    category: str = "aktualnosci"


UNITS = {
    "kprm": GovPlUnit("kprm", "https://www.gov.pl/web/premier/wydarzenia", "Kancelaria Prezesa Rady Ministrów"),
    "mswia": GovPlUnit("mswia", "https://www.gov.pl/web/mswia/aktualnosci", "Ministerstwo Spraw Wewnętrznych i Administracji"),
    "rcb": GovPlUnit("rcb", "https://www.gov.pl/web/rcb/komunikaty", "Rządowe Centrum Bezpieczeństwa", "komunikaty"),
}


class GovPlNewsSource(HttpSource):
    def __init__(
        self,
        unit: GovPlUnit,
        months: float = 6,
        delay: float = 1.0,
        max_pages: int = 400,
        now: Callable[[], datetime] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        super().__init__()
        self.unit = unit
        self.name = unit.name
        self.delay = delay
        self.max_pages = max_pages
        self.sleep = sleep
        current = (now or (lambda: datetime.now(timezone.utc)))()
        self.today: date = current.date()
        self.cutoff: date = (current - timedelta(days=round(30.44 * months))).date()
        self.stats = {"pages": 0, "listed": 0, "fetched": 0, "failed": 0, "no_content": 0}
        self.failed_urls: list[str] = []

    def _polite_get(self, url: str) -> requests.Response:
        response = self.get(url)
        self.sleep(self.delay)
        return response

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        for page in range(1, self.max_pages + 1):
            url = self.unit.list_url if page == 1 else f"{self.unit.list_url}?page={page}"
            try:
                response = self._polite_get(url)
            except requests.RequestException:
                self.stats["failed"] += 1
                self.failed_urls.append(url)
                break
            self.stats["pages"] += 1
            items = _list_items(response.text, response.url)
            if not items:
                break
            fresh = [(u, t, d) for u, t, d in items if d is None or d >= self.cutoff]
            for detail_url, title, list_date in fresh:
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                self.stats["listed"] += 1
                record = self._detail(detail_url, title, list_date)
                if record is not None:
                    yield record
            # Lists are newest first: once a page holds an item older than the
            # cutoff, every later page is older too.
            if len(fresh) < len(items):
                break

    def _detail(self, url: str, title: str, list_date: date | None) -> Record | None:
        try:
            response = self._polite_get(url)
        except requests.RequestException:
            self.stats["failed"] += 1
            self.failed_urls.append(url)
            return None
        self.stats["fetched"] += 1
        soup = BeautifulSoup(response.text, "html.parser")
        article = soup.select_one("article") or soup
        heading = article.select_one("h2")
        if heading and heading.get_text(strip=True):
            title = heading.get_text(" ", strip=True)
        date_node = article.select_one(".event-date")
        published = _parse_pl_date(date_node.get_text(strip=True)) if date_node else None
        published = published or list_date
        date_issue = None
        # gov.pl editors occasionally mistype the year (seen: 02.09.2029 on a
        # November 2026 KPRM article). Never guess a date: drop it and say why.
        if published and published > self.today + timedelta(days=1):
            date_issue = f"future date on the page: {published.isoformat()}"
            published = None
        elif published is None:
            date_issue = "no date on the list or the article page"
        intro_node = article.select_one(".intro")
        intro = _clean(intro_node.get_text(" ", strip=True)) if intro_node else None
        body_node = article.select_one(".editor-content")
        body = _paragraphs(body_node) if body_node else ""
        parts = [part for part in (intro, body) if part]
        # Some short komunikaty repeat the intro as the whole body.
        if intro and body.startswith(intro):
            parts = [body]
        content = "\n\n".join(parts)
        if len(content) < 40:
            self.stats["no_content"] += 1
            return None
        return Record(
            source=self.name,
            source_url=self.unit.list_url,
            detail_url=url,
            external_id=url,
            title=title,
            published_at=published.isoformat() if published else None,
            summary=intro,
            content=content,
            category=self.unit.category,
            raw={
                "html_sha256": sha256(response.content).hexdigest(),
                "publisher": self.unit.publisher,
                "source_type": "official",
                "license": GOV_PL_LICENSE,
                **({"date_issue": date_issue} if date_issue else {}),
            },
        )


def _list_items(html: str, base_url: str) -> list[tuple[str, str, date | None]]:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article")
    if article is None:
        return []
    items: list[tuple[str, str, date | None]] = []
    for item in article.select(".art-prev li"):
        link = item.select_one(".title a[href]")
        if link is None:
            continue
        date_node = item.select_one(".event .date")
        items.append(
            (
                urljoin(base_url, str(link.get("href"))),
                link.get_text(" ", strip=True),
                _parse_pl_date(date_node.get_text(strip=True)) if date_node else None,
            )
        )
    return items


def _parse_pl_date(value: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), "%d.%m.%Y").date()
    except ValueError:
        return None


BLOCK_TAGS = ("p", "li", "h2", "h3", "h4", "h5", "blockquote", "figcaption", "td")


def _clean(text: str) -> str:
    text = " ".join(text.split())
    return text.replace(" ,", ",").replace(" .", ".").replace("( ", "(").replace(" )", ")")


def _paragraphs(node: Tag) -> str:
    """Block elements as paragraphs; inline links and bold do not split sentences."""
    for junk in node.select("script, style, noscript, button"):
        junk.decompose()
    paragraphs: list[str] = []
    for block in node.find_all(BLOCK_TAGS):
        if block.find(BLOCK_TAGS):
            continue
        text = _clean(block.get_text(" ", strip=True))
        if text and (not paragraphs or paragraphs[-1] != text):
            paragraphs.append(text)
    return "\n\n".join(paragraphs) if paragraphs else _clean(node.get_text(" ", strip=True))
