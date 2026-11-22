from __future__ import annotations

import re
from datetime import date
from io import BytesIO
from urllib.parse import urldefrag, urljoin, urlsplit

from bs4 import BeautifulSoup, Tag
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .catalog import SourceSpec
from .models import Record
from .sources import HttpSource, SourceError


def text(node: Tag | None, separator: str = " ") -> str:
    return node.get_text(separator, strip=True) if node is not None else ""


def excerpt(value: str | None) -> str | None:
    if not value:
        return None
    # Keep a bounded fragment so short documents are not archived in full.
    cutoff = min(1199, len(value) * 3 // 4)
    fragment = value[:cutoff].rsplit(maxsplit=1)[0].strip()
    return f"{fragment}…" if fragment else None


def date_in(value: str) -> str | None:
    iso = re.search(r"\b\d{4}-\d{2}-\d{2}\b", value)
    numeric = re.search(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b", value)
    named = re.search(
        r"\b(\d{1,2}) (stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|"
        r"sierpnia|września|października|listopada|grudnia) (\d{4})\b",
        re.sub(r"\bpaździernik\b", "października", value.lower()),
    )
    try:
        if iso:
            return date.fromisoformat(iso[0]).isoformat()
        if numeric:
            day, month, year = map(int, numeric.groups())
            return date(year, month, day).isoformat()
        if named:
            day, month, year = named.groups()
            months = (
                "stycznia lutego marca kwietnia maja czerwca lipca sierpnia "
                "września października listopada grudnia"
            ).split()
            return date(int(year), months.index(month) + 1, int(day)).isoformat()
    except ValueError:
        pass
    return None


class TransportSource(HttpSource):
    publisher: str

    def __init__(self, spec: SourceSpec) -> None:
        super().__init__()
        self.name = spec.name
        self.url = spec.url
        self.session.headers["Accept-Language"] = "pl"

    def page(self, url: str) -> tuple[str, BeautifulSoup]:
        response = self.get(url)
        soup = BeautifulSoup(response.content, "html.parser", from_encoding="utf-8")
        if soup.select_one('iframe[src*="/_Incapsula_Resource"]') or (
            not soup.title and soup.select_one('script[src*="/_Incapsula_Resource"]')
        ):
            raise SourceError(f"Access challenge at {response.url}")
        return response.url, soup

    def local_url(self, base: str, anchor: Tag) -> str | None:
        url = urldefrag(urljoin(base, anchor["href"])).url
        target = urlsplit(url)
        source = urlsplit(self.url)
        if target.scheme == "https" and target.hostname and source.hostname:
            if target.hostname.removeprefix("www.") == source.hostname.removeprefix("www."):
                return url
        return None

    def record(
        self,
        detail_url: str,
        title: str,
        content: str | None,
        *,
        published_at: str | None = None,
        updated_at: str | None = None,
        raw: dict | None = None,
        **fields,
    ) -> Record:
        return Record(
            source=self.name,
            source_url=self.url,
            external_id=detail_url,
            detail_url=detail_url,
            title=title,
            content=excerpt(content),
            published_at=published_at,
            updated_at=updated_at,
            raw={"publisher": self.publisher, **(raw or {})},
            **fields,
        )

    def fetch(self) -> list[Record]:
        records = list(self.collect())
        if not records:
            raise SourceError(f"No matching records at {self.url}")
        return list({record.external_id: record for record in records}.values())


class ArticleListSource(TransportSource):
    body_selector: str
    title_selector: str
    date_selector: str = 'time[datetime], [itemprop="datePublished"]'
    updated_selector = '[itemprop="dateModified"]'
    summary_selector: str | None = None
    category = "aktualności"
    category_selector: str | None = None

    def article(
        self, url: str, *, published: str | None = None, updated: str | None = None
    ) -> Record:
        return self.parse_article(*self.page(url), published=published, updated=updated)

    def parse_article(
        self, detail_url: str, soup: BeautifulSoup, *,
        published: str | None = None, updated: str | None = None,
        fallback_title: str = "",
    ) -> Record:
        title = text(soup.select_one(self.title_selector)) or fallback_title
        body = soup.select_one(self.body_selector)
        if not title or body is None:
            raise SourceError(f"Expected article at {detail_url}")
        for node in body.select("script, style, nav, .pagenavigation, .single-new-share-buttons"):
            node.decompose()
        content = text(body, "\n")
        summary = text(soup.select_one(self.summary_selector)) if self.summary_selector else ""
        if not content and not summary:
            raise SourceError(f"Empty article at {detail_url}")
        dates = {}
        for field, selector in (
            ("published_at", self.date_selector), ("updated_at", self.updated_selector),
        ):
            node = soup.select_one(selector)
            if node is not None:
                dates[field] = date_in(node.get("datetime") or node.get("content") or text(node))
        category = text(soup.select_one(self.category_selector)) if self.category_selector else ""
        attachments = [
            urljoin(detail_url, anchor["href"])
            for anchor in body.select('a[href$=".pdf" i], a[href^="/attachment/"]')
        ]
        return self.record(
            detail_url, title, content,
            published_at=dates.get("published_at") or published,
            updated_at=dates.get("updated_at") or updated,
            summary=excerpt(summary), category=category.casefold() or self.category,
            raw={"attachments": list(dict.fromkeys(attachments))} if attachments else None,
        )

    def links(self, base: str, soup: BeautifulSoup, selector: str) -> list[str]:
        return list(dict.fromkeys(
            url for anchor in soup.select(selector)
            if (url := self.local_url(base, anchor)) and url != base
        ))

    def collect(self):
        base, soup = self.page(self.url)
        for url in self.links(base, soup, self.list_selector):
            yield self.article(url)


class UlcSource(ArticleListSource):
    publisher = "Urząd Lotnictwa Cywilnego"
    list_selector = 'a[href*="/aktualnosci/"]'
    title_selector = 'main h1, .com-content-article h1, .item-page h1, h1'
    body_selector = '[itemprop="articleBody"], .com-content-article__body, .item-page'
    date_selector = '.published, [itemprop="datePublished"]'
    updated_selector = '.modified, [itemprop="dateModified"]'


class UlcPassengerSource(UlcSource):
    category = "prawa pasażera"

    def collect(self):
        base, soup = self.page(self.url)
        for row in soup.select("table tbody tr"):
            anchor = row.select_one("td a[href]")
            if anchor is None or not (url := self.local_url(base, anchor)) or url == base:
                continue
            cells = row.select("td")
            updated = date_in(text(cells[-1]))
            if updated:
                yield self.article(url, updated=updated)


class PortalPasazeraSource(TransportSource):
    publisher = "PKP Polskie Linie Kolejowe S.A."

    def collect(self):
        detail_url, soup = self.page(urljoin(self.url, "/Poradnik"))
        main = soup.select_one('main, [role="main"]')
        if main is None:
            raise SourceError(f"Expected passenger guide at {detail_url}")
        title = text(main.select_one("h1")) or text(soup.title)
        for node in main.select("nav, form, script, style"):
            node.decompose()
        content = text(main, "\n")
        if title and main.select_one("p, li") and len(content) > 40:
            yield self.record(detail_url, title, content, category="poradnik pasażera")


class UtkSource(ArticleListSource):
    publisher = "Urząd Transportu Kolejowego"
    list_selector = "main .slider a:has(h3), main .uslugi a:has(h3)"
    body_selector = "main article.txt"
    title_selector = "main .head h2"
    summary_selector = "main .head h3"
    category = "informacje dla pasażerów"

    def collect(self):
        base, soup = self.page(self.url)
        for url in self.links(base, soup, self.list_selector):
            detail_url, page = self.page(url)
            title = text(page.select_one("main .naglowek h2"))
            if page.select_one(self.body_selector):
                yield self.parse_article(detail_url, page, fallback_title=title)
                continue
            section = page.select_one("main .subRight")
            if section is None or not title:
                raise SourceError(f"Expected passenger section at {detail_url}")
            sections = self.links(detail_url, section, "a[href]")
            content = text(section, "\n")
            yield self.record(
                detail_url, title, content, category=self.category,
                raw={"section_links": sections},
            )


class KgsokSource(ArticleListSource):
    publisher = "Komenda Główna Straży Ochrony Kolei"
    list_selector = ".news .news-list-post-title a[href]"
    title_selector = "article .single-new-h1"
    body_selector = "article .single-new-content"
    summary_selector = "article .single-new-lead"
    date_selector = "article .single-new-date"
    category_selector = 'article a.taxonomy.category[href*="/category/kronika-wydarzen/"]'


class SarSource(ArticleListSource):
    publisher = "Morska Służba Poszukiwania i Ratownictwa"
    title_selector = "main h1, article h1, h1"
    body_selector = 'main article, main .field--name-body, main [itemprop="articleBody"], main'

    def collect(self):
        base, soup = self.page(urljoin(self.url, "/aktualnosci"))
        for anchor in soup.select("a[href]"):
            match = re.match(r"\d{4}-\d{2}-\d{2}\b", text(anchor))
            if match and (url := self.local_url(base, anchor)):
                yield self.article(url, published=date_in(match[0]))


class UmgdySource(ArticleListSource):
    publisher = "Urząd Morski w Gdyni"
    list_selector = '.card-title a[href*="/aktualnosc/"]'
    title_selector = "main #section__heading h1"
    body_selector = "main .mb-n3"
    date_selector = "main .list-inline-item"


class UmsNavigationSource(TransportSource):
    publisher = "Urząd Morski w Szczecinie"
    notice_number = re.compile(r"\bkomunikatu?\s+(?:nr\.?\s*)?(\d+)\s*/\s*(\d{2,4})\b", re.I)

    def warning_excerpt(self, url: str) -> tuple[str, str | None]:
        try:
            pdf = PdfReader(BytesIO(self.get(url).content))
            content = "\n".join(page.extract_text() for page in pdf.pages).strip()
        except PdfReadError as exc:
            raise SourceError(f"Could not read warning PDF at {url}") from exc
        if not content:
            raise SourceError(f"Warning PDF has no text at {url}")
        stamp = re.search(
            r"Data ostatniej modyfikacji:\s*(\d{4}-\d{2}-\d{2})", content.replace("ﬁ", "fi"),
        )
        return content, date_in(stamp[1]) if stamp else None

    def collect(self):
        base, soup = self.page(self.url)
        body = soup.select_one('[itemprop="articleBody"]')
        if body is None:
            raise SourceError(f"Expected navigation notices at {base}")
        section = None
        records = []
        originals = []
        withdrawals = {}
        for block in body.find_all(["p", "ul"], recursive=False):
            if block.name == "p" and block.strong and not block.a:
                section = text(block.strong)
            for anchor in block.select("a[href]"):
                url = self.local_url(base, anchor)
                title = text(anchor)
                if not url or not title or not (path := urlsplit(url).path.lower()).endswith(".pdf"):
                    continue
                row = anchor.find_parent("li") or block
                withdrawn = bool(
                    anchor.find_parent(["s", "del", "strike"])
                    or anchor.find_parent(style=re.compile("line-through", re.I))
                )
                content, updated = None, None
                if path.endswith("/ost_snpl.pdf"):
                    content, updated = self.warning_excerpt(url)
                record = self.record(
                    url, title, content, updated_at=updated, category=section,
                    language="en" if path.endswith("en.pdf") else "pl",
                    raw={
                        "listing_url": base, "listing_text": text(row),
                        "withdrawn_in_listing": withdrawn, "format": "pdf",
                    },
                )
                records.append(record)
                number = self.notice_number.search(title)
                if section and number:
                    key = (section, int(number[1]), number[2][-2:])
                    if "odwołanie" in title.casefold():
                        withdrawals[key] = url
                    elif number.start() == 0:
                        originals.append((key, record))

        for key, record in originals:
            if key in withdrawals:
                record.raw["withdrawn_in_listing"] = True
                record.raw["withdrawal_url"] = withdrawals[key]
        by_url = {}
        for record in records:
            previous = by_url.get(record.detail_url)
            if previous is not None:
                contexts = previous.raw.get("listing_contexts") or [previous.raw["listing_text"]]
                record.raw["listing_contexts"] = list(dict.fromkeys(
                    [*contexts, record.raw["listing_text"]]
                ))
            by_url[record.detail_url] = record
        yield from by_url.values()


class WodyPolskieNavigationSource(TransportSource):
    publisher = "Państwowe Gospodarstwo Wodne Wody Polskie"

    def collect(self):
        base, soup = self.page(self.url)
        for anchor in soup.select("#main-content .editor-content table a[href]"):
            region_url = self.local_url(base, anchor)
            if not region_url or not urlsplit(region_url).path.startswith("/web/wody-polskie-"):
                continue
            region = text(anchor)
            page_url, page = self.page(region_url)
            # Regional portals use one or two landing pages before the current list.
            for _ in range(2):
                link = next((item for item in page.select("main article a[href]")
                             if text(item).lower().startswith((
                                 "komunikaty nawigacyjne", "aktualne komunikaty nawigacyjne",
                                 "obowiązujące komunikaty nawigacyjne",
                             ))), None)
                if link is None or not (url := self.local_url(page_url, link)) or url == page_url:
                    break
                page_url, page = self.page(url)
            listing = page.select_one("#main-content.article-area--accordion-list")
            if listing is None:
                raise SourceError(f"Expected regional notice list at {page_url}")
            listing_title = text(listing.select_one("h2"))
            for notice in listing.select("details.accordion-detail[id]"):
                title = text(notice.select_one("summary"))
                body = notice.select_one(".editor-content")
                if not title or body is None:
                    continue
                url = f"{page_url}#{notice['id']}"
                attachments = [
                    urljoin(page_url, link["href"])
                    for link in notice.select("a.file-download[href]")
                ]
                published = date_in(title) or date_in(text(notice.select_one("p.event-date, p.intro")))
                yield self.record(
                    url, title, text(body, "\n") or None, published_at=published,
                    category="komunikat nawigacyjny", location=[region],
                    raw={"region": region, "listing_url": page_url,
                         "listing_title": listing_title, "attachments": attachments},
                )


TRANSPORT_SOURCES = {
    "ulc": UlcSource,
    "ulc_passenger": UlcPassengerSource,
    "portal_pasazera": PortalPasazeraSource,
    "utk": UtkSource,
    "kgsok": KgsokSource,
    "sar": SarSource,
    "umgdy": UmgdySource,
    "ums_navigation": UmsNavigationSource,
    "wody_polskie_navigation": WodyPolskieNavigationSource,
}
