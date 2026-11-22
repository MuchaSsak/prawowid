"""Demagog (demagog.org.pl) fact-checks, fake-news debunks and reports.

Demagog is an IFCN and EFCSN verified Polish fact-checker, so this is the
corpus's secondary (fact-checker) source type. Its robots.txt allows `*` with
`Content-Signal: search=yes,ai-train=no,use=reference`: we never train on it,
and consumers should cite it as a reference (short quote + link).

URLs come from the WordPress sitemaps (one request per sitemap instead of
paging lists). Dates and verdicts come from the page's own JSON-LD (WebPage
`datePublished`, ClaimReview `reviewRating`), not from scraped labels.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Callable, Iterable
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup

from .models import Record
from .sources import HttpSource

SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class DemagogSource(HttpSource):
    name = "demagog"
    BASE_URL = "https://demagog.org.pl/"
    SITEMAP_INDEX = "https://demagog.org.pl/sitemap_index.xml"
    # Post types that carry checkable content, mapped to our category names.
    SECTIONS = {
        "wypowiedzi": "ocena_wypowiedzi",
        "fake_news": "fake_news",
        "analizy_i_raporty": "analiza_raport",
    }

    def __init__(
        self,
        years: float = 3,
        delay: float = 1.0,
        limit: int | None = None,
        now: Callable[[], datetime] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        super().__init__()
        self.delay = delay
        self.limit = limit
        self.sleep = sleep
        current = (now or (lambda: datetime.now(timezone.utc)))()
        self.cutoff = current - timedelta(days=round(365.25 * years))
        self.stats = {"listed": 0, "fetched": 0, "too_old": 0, "failed": 0, "no_content": 0}
        self.failed_urls: list[str] = []

    # -- discovery -------------------------------------------------------

    def _polite_get(self, url: str) -> requests.Response:
        response = self.get(url)
        self.sleep(self.delay)
        return response

    def sitemap_urls(self) -> list[tuple[str, str, datetime | None]]:
        """(section, url, lastmod) for every page newer than the cutoff.

        `lastmod` is the last modification, which is never earlier than the
        publication date, so filtering on it cannot drop a page we want.
        """
        index = ElementTree.fromstring(self._polite_get(self.SITEMAP_INDEX).content)
        sitemaps = [node.text.strip() for node in index.findall("sm:sitemap/sm:loc", SITEMAP_NS) if node.text]
        found: list[tuple[str, str, datetime | None]] = []
        for sitemap in sitemaps:
            section = _section_of_sitemap(sitemap, self.SECTIONS)
            if section is None:
                continue
            try:
                tree = ElementTree.fromstring(self._polite_get(sitemap).content)
            except (requests.RequestException, ElementTree.ParseError):
                self.stats["failed"] += 1
                self.failed_urls.append(sitemap)
                continue
            for url_node in tree.findall("sm:url", SITEMAP_NS):
                loc = url_node.findtext("sm:loc", default="", namespaces=SITEMAP_NS).strip()
                lastmod = _parse_dt(url_node.findtext("sm:lastmod", default="", namespaces=SITEMAP_NS))
                # Skip the section's own archive page (e.g. /fake_news/).
                if not loc or loc.rstrip("/").endswith(f"/{section}"):
                    continue
                if lastmod is not None and lastmod < self.cutoff:
                    continue
                found.append((section, loc, lastmod))
        # Newest first, so a limited trial run gets recent pages.
        found.sort(key=lambda row: row[2] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        self.stats["listed"] = len(found)
        return found

    # -- extraction ------------------------------------------------------

    def fetch(self) -> Iterable[Record]:
        for section, url, lastmod in self.sitemap_urls():
            if self.limit is not None and self.stats["fetched"] >= self.limit:
                break
            try:
                response = self._polite_get(url)
            except requests.RequestException:
                self.stats["failed"] += 1
                self.failed_urls.append(url)
                continue
            self.stats["fetched"] += 1
            record = self.parse_page(section, url, response.text, response.content)
            if record is None:
                self.stats["no_content"] += 1
                continue
            published = _parse_dt(record.published_at)
            if published is not None and published < self.cutoff:
                self.stats["too_old"] += 1
                continue
            yield record

    def parse_page(self, section: str, url: str, text: str, content: bytes) -> Record | None:
        soup = BeautifulSoup(text, "html.parser")
        web_page, claim_reviews = _json_ld(soup)

        title = _meta(soup, "og:title")
        heading = soup.select_one(".dg-post-content h2, .dg-post-content h1")
        if heading and heading.get_text(strip=True):
            title = heading.get_text(" ", strip=True)
        if not title:
            return None

        body = _body_text(soup)
        if len(body) < 200:
            return None

        verdicts = [
            {
                "claim": review.get("claimReviewed"),
                "rating": (review.get("reviewRating") or {}).get("alternateName"),
                "claimant": ((review.get("itemReviewed") or {}).get("author") or {}).get("name"),
                "claim_date": (review.get("itemReviewed") or {}).get("datePublished"),
                "review_date": review.get("datePublished"),
            }
            for review in claim_reviews
        ]
        summary = _meta(soup, "description", attr="name")
        if verdicts and verdicts[0]["rating"]:
            summary = f"Ocena Demagoga: {verdicts[0]['rating']}. {summary or ''}".strip()

        return Record(
            source=self.name,
            source_url=self.BASE_URL,
            detail_url=url,
            external_id=url,
            title=strip_invisible(title),
            published_at=web_page.get("datePublished") or (verdicts[0]["review_date"] if verdicts else None),
            updated_at=web_page.get("dateModified"),
            content=strip_invisible(body),
            summary=strip_invisible(summary),
            category=self.SECTIONS[section],
            raw={
                "html_sha256": sha256(content).hexdigest(),
                "claim_reviews": strip_invisible(verdicts),
                "publisher": "Demagog (Stowarzyszenie Demagog)",
                "source_type": "factcheck",
                "content_signal": "search=yes,ai-train=no,use=reference",
            },
        )


# Invisible characters copied from the site's HTML: zero-width space/joiners,
# soft hyphen, word joiner, BOM, bidi marks and isolates, and C0/C1 control
# characters (newline and tab are kept). They break word search, embeddings and
# the verbatim quote check while showing nothing to a reader.
_INVISIBLE = re.compile(
    "[­​‌‍‎‏⁠﻿‪-‮⁦-⁩"
    "\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]"
)


def strip_invisible(value):
    """Remove invisible characters from a string, or from every string in a list or dict."""
    if isinstance(value, str):
        return _INVISIBLE.sub("", value)
    if isinstance(value, list):
        return [strip_invisible(item) for item in value]
    if isinstance(value, dict):
        return {key: strip_invisible(item) for key, item in value.items()}
    return value


def _section_of_sitemap(url: str, sections: dict[str, str]) -> str | None:
    name = url.rstrip("/").rsplit("/", 1)[-1]
    for section in sections:
        if name.startswith(f"{section}-sitemap"):
            return section
    return None


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _meta(soup: BeautifulSoup, key: str, attr: str = "property") -> str | None:
    node = soup.find("meta", attrs={attr: key})
    value = node.get("content") if node else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def _json_ld(soup: BeautifulSoup) -> tuple[dict, list[dict]]:
    web_page: dict = {}
    reviews: list[dict] = []
    for script in soup.select("script[type='application/ld+json']"):
        try:
            data = json.loads(script.string or "")
        except json.JSONDecodeError:
            continue
        nodes = data.get("@graph", [data]) if isinstance(data, dict) else data
        for node in nodes if isinstance(nodes, list) else []:
            if not isinstance(node, dict):
                continue
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if "ClaimReview" in kinds:
                reviews.append(node)
            elif "WebPage" in kinds and not web_page:
                web_page = node
    return web_page, reviews


BLOCK_TAGS = ("p", "li", "h2", "h3", "h4", "blockquote", "figcaption", "td")


def _body_text(soup: BeautifulSoup) -> str:
    """The article body as clean paragraphs, one per line block.

    Takes the longest content row (skipping the section header and the
    newsletter box), then joins each block element's text with single spaces,
    so links and bold words do not break sentences apart.
    """
    post = soup.select_one(".dg-post-content")
    if post is None:
        return ""
    best = None
    best_len = 0
    for row in post.find_all("div", class_="row", recursive=False):
        if row.select_one(".dg-post-content__top"):
            continue
        text = row.get_text(" ", strip=True)
        if text.startswith("Newsletter"):
            continue
        if len(text) > best_len:
            best, best_len = row, len(text)
    if best is None:
        return ""
    for junk in best.select("script, style, noscript, button, .dg-share, .sharedaddy, .dg-post-support"):
        junk.decompose()
    # Fundraising call-outs ("przekaż 1,5% podatku ... KRS") share the
    # .important-text box with real editorial notes, so drop only those.
    for box in best.select(".important-text"):
        if "KRS" in box.get_text(" ", strip=True):
            box.decompose()
    paragraphs: list[str] = []
    for block in best.find_all(BLOCK_TAGS):
        # Only the innermost blocks, so a <li> holding a <p> is not counted twice.
        if block.find(BLOCK_TAGS):
            continue
        text = " ".join(block.get_text(" ", strip=True).split())
        text = text.replace(" ,", ",").replace(" .", ".").replace("( ", "(").replace(" )", ")")
        if text and (not paragraphs or paragraphs[-1] != text):
            paragraphs.append(text)
    if not paragraphs:
        return " ".join(best.get_text(" ", strip=True).split())
    return "\n\n".join(paragraphs)
