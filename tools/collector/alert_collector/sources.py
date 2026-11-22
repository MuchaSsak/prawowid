from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from html import unescape
from hashlib import sha256
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup

from .models import Record


class SourceError(RuntimeError):
    pass


class HttpSource:
    def __init__(self, timeout: float = 30.0) -> None:
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "PublicAlertCollector/0.1 (official public data collection)",
                "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
            }
        )

    def get_json(self, url: str) -> dict:
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            raise SourceError(f"Expected JSON from {url}") from exc

    def get(self, url: str) -> requests.Response:
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response


class RsoSource(HttpSource):
    name = "rso"

    CATEGORIES = (
        "meteorologiczne",
        "hydrologiczne",
        "informacje-drogowe",
        "ogolne",
        "stany-wod",
    )
    VOIVODESHIPS = (
        "wszystkie",
        "dolnoslaskie",
        "kujawsko-pomorskie",
        "lubelskie",
        "lubuskie",
        "lodzkie",
        "malopolskie",
        "mazowieckie",
        "opolskie",
        "podkarpackie",
        "podlaskie",
        "pomorskie",
        "slaskie",
        "swietokrzyskie",
        "warminsko-mazurskie",
        "wielkopolskie",
        "zachodniopomorskie",
    )
    BASE = "https://www.gov.pl/api/data/proxy/rso"

    def __init__(
        self,
        voivodeship: str = "wszystkie",
        category: str = "wszystkie",
        name: str = "rso",
        timeout: float = 30.0,
    ) -> None:
        super().__init__(timeout=timeout)
        self.voivodeship = voivodeship
        self.category = category
        self.name = name

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        voivodeship = self.voivodeship
        category = self.category
        offset = 0
        while True:
            url = (
                f"{self.BASE}/komunikatyxml/{voivodeship}/{category}/{offset}"
                "?_format=json"
            )
            for attempt in range(5):
                try:
                    data = self.get_json(url)
                    break
                except requests.HTTPError as exc:
                    if exc.response is not None and exc.response.status_code == 429:
                        time.sleep(2 ** (attempt + 1))
                        continue
                    raise
            else:
                raise SourceError(f"RSO rate limit persisted for {url}")

            items = data.get("newses") or []
            for item in items:
                external_id = str(item.get("id", "")).strip()
                if not external_id or external_id in seen:
                    continue
                seen.add(external_id)
                detail_url = (
                    "https://www.gov.pl/web/gov/ostrzezenia"
                    f"#/_/szczgoly/{external_id}"
                )
                province_values = item.get("provinces") or {}
                if isinstance(province_values, dict):
                    provinces = [
                        province.get("name")
                        if isinstance(province, dict)
                        else str(province)
                        for province in province_values.values()
                    ]
                elif isinstance(province_values, list):
                    provinces = [
                        province.get("name")
                        if isinstance(province, dict)
                        else str(province)
                        for province in province_values
                    ]
                else:
                    provinces = [str(province_values)] if province_values else []

                content = item.get("content")
                category_value = item.get("category")
                if isinstance(category_value, dict):
                    category_name = category_value.get("name")
                else:
                    category_name = str(category_value) if category_value else None
                yield Record(
                    source=self.name,
                    source_url=(
                        "https://www.gov.pl/web/gov/ostrzezenia"
                        f"#/_/{voivodeship}/{category}"
                    ),
                    detail_url=detail_url,
                    external_id=external_id,
                    title=unescape(str(item.get("title") or "").strip()),
                    published_at=item.get("created_at"),
                    updated_at=item.get("updated_at"),
                    valid_from=item.get("valid_from"),
                    valid_to=item.get("valid_to"),
                    content=unescape(str(content or "").strip()),
                    summary=unescape(str(item.get("shortcut") or "").strip()),
                    category=category_name or category,
                    location=provinces,
                    raw={"list": item},
                )

            pagination = data.get("pagination") or {}
            total = int(pagination.get("totalitems") or 0)
            page_size = int(pagination.get("itemsperpage") or 20)
            offset += page_size
            if not items or offset >= total:
                break

            time.sleep(0.5)


class RcbReportSource(HttpSource):
    name = "rcb_report"

    def fetch(self) -> Iterable[Record]:
        url = "https://www.gov.pl/web/rcb/raport-dobowy3"
        response = self.get(url)
        soup = BeautifulSoup(response.text, "html.parser")
        article = soup.select_one("article") or soup
        title_node = soup.select_one("article h1, main h1")
        title = (
            title_node.get_text(" ", strip=True)
            if title_node
            else "Raport dobowy RCB"
        )

        date_node = article.select_one("h2, h3")
        report_date = date_node.get_text(" ", strip=True) if date_node else None
        content = article.get_text("\n", strip=True)
        external_id = report_date or response.url

        yield Record(
            source=self.name,
            source_url=url,
            external_id=external_id,
            title=title,
            published_at=report_date,
            content=content,
            raw={"html_sha256": __import__("hashlib").sha256(response.content).hexdigest()},
        )


class KgPspNewsSource(HttpSource):
    name = "kgpsp"
    BASE_URL = "https://www.gov.pl/web/kgpsp/aktualnosci"

    def fetch(self) -> Iterable[Record]:
        seen_links: set[str] = set()
        page = 1
        while page <= 20:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            response = self.get(url)
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one(".article-area__article")
            if article is None:
                break

            page_links: list[tuple[str, str, str | None, str | None]] = []
            for item in article.select(".art-prev li"):
                link_node = item.select_one(".title a[href]")
                if link_node is None:
                    continue
                detail_url = urljoin(response.url, str(link_node.get("href")))
                if detail_url in seen_links:
                    continue
                seen_links.add(detail_url)
                title = link_node.get_text(" ", strip=True)
                date_node = item.select_one(".event .date")
                location_node = item.select_one(".event .location")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                location = (
                    location_node.get_text(" ", strip=True)
                    if location_node
                    else None
                )
                page_links.append((detail_url, title, published_at, location))

            if not page_links:
                break

            for detail_url, title, published_at, location in page_links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail_article = detail_soup.select_one("article") or detail_soup
                heading = detail_article.select_one("h2")
                if heading:
                    title = heading.get_text(" ", strip=True)
                date_node = detail_article.select_one(".event-date")
                if date_node:
                    published_at = date_node.get_text(" ", strip=True)
                content_node = detail_article.select_one(".editor-content")
                content = (
                    content_node.get_text("\n", strip=True)
                    if content_node
                    else detail_article.get_text("\n", strip=True)
                )
                if len(content) < 40:
                    continue

                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    content=content,
                    location=[location] if location else [],
                    category="aktualnosci",
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest(),
                    },
                )

            page += 1
            time.sleep(0.5)


class PolicjaNewsSource(HttpSource):
    name = "policja"
    BASE_URL = "https://policja.pl/pol/aktualnosci"
    RSS_URL = "https://policja.pl/dokumenty/rss/1-rss-1.rss"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        article_urls: list[str] = []

        try:
            rss_response = self.get(self.RSS_URL)
            root = ElementTree.fromstring(rss_response.content)
            for item in root.findall(".//item"):
                title = item.findtext("title", "").strip()
                link = item.findtext("link", "").strip()
                description = item.findtext("description", "").strip()
                pub_date = item.findtext("pubDate", "").strip()
                if link and link not in seen:
                    seen.add(link)
                    article_urls.append(link)
                    yield from self._fetch_detail(
                        link,
                        title,
                        description,
                        pub_date,
                    )
        except (ElementTree.ParseError, requests.RequestException):
            pass

        page = 1
        while page <= 25:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            page_urls: list[str] = []
            for anchor in soup.select("a[href]"):
                href = str(anchor.get("href", "")).strip()
                if "/pol/aktualnosci/" not in href:
                    continue
                detail_url = urljoin(response.url, href)
                if "/pol/aktualnosci/" not in detail_url:
                    continue
                if detail_url not in seen:
                    seen.add(detail_url)
                    page_urls.append(detail_url)

            if not page_urls:
                break
            for detail_url in page_urls:
                yield from self._fetch_detail(detail_url)
            page += 1
            time.sleep(0.25)

    def _fetch_detail(
        self,
        detail_url: str,
        title: str = "",
        summary: str = "",
        published_at: str = "",
    ) -> Iterable[Record]:
        try:
            response = self.get(detail_url)
        except requests.RequestException:
            return
        soup = BeautifulSoup(response.text, "html.parser")
        article = soup.select_one("article.txt") or soup.select_one("article") or soup
        heading = article.select_one(".head-title h2") or article.select_one("h2")
        if heading:
            title = heading.get_text(" ", strip=True)
        date_node = article.select_one(".data")
        if date_node:
            published_at = date_node.get_text(" ", strip=True).replace(
                "Data publikacji ", ""
            )
        intro = article.select_one(".intro")
        if intro and not summary:
            summary = intro.get_text(" ", strip=True)
        content = article.get_text("\n", strip=True)
        if len(content) < 40:
            return

        yield Record(
            source=self.name,
            source_url=self.BASE_URL,
            detail_url=detail_url,
            external_id=detail_url,
            title=title or detail_url,
            published_at=published_at or None,
            summary=summary or None,
            content=content,
            category="aktualnosci",
            raw={"html_sha256": sha256(response.content).hexdigest()},
        )


class MazowieckaPolicjaNewsSource(HttpSource):
    name = "mazowiecka_policja"
    RSS_URL = (
        "https://mazowiecka.policja.gov.pl/dokumenty/rss/"
        "271-rss-o-1488.rss"
    )
    SOURCE_URL = (
        "https://mazowiecka.policja.gov.pl/ra/aktualnosci/aktualnosci"
    )

    def fetch(self) -> Iterable[Record]:
        response = self.get(self.RSS_URL)
        root = ElementTree.fromstring(response.content)
        for item in root.findall(".//item"):
            title = item.findtext("title", "").strip()
            detail_url = item.findtext("link", "").strip()
            summary = item.findtext("description", "").strip()
            published_at = item.findtext("pubDate", "").strip()
            if not detail_url:
                continue
            yield from self._fetch_detail(
                detail_url,
                title,
                summary,
                published_at,
            )

    def _fetch_detail(
        self,
        detail_url: str,
        title: str,
        summary: str,
        published_at: str,
    ) -> Iterable[Record]:
        try:
            response = self.get(detail_url)
        except requests.RequestException:
            return
        soup = BeautifulSoup(response.text, "html.parser")
        article = soup.select_one("article.txt") or soup.select_one("article") or soup
        heading = article.select_one(".head-title h2") or article.select_one("h2")
        if heading:
            title = heading.get_text(" ", strip=True)
        date_node = article.select_one(".data")
        if date_node:
            published_at = date_node.get_text(" ", strip=True).replace(
                "Data publikacji ", ""
            )
        intro = article.select_one(".intro")
        if intro:
            summary = intro.get_text(" ", strip=True)
        content = article.get_text("\n", strip=True)
        if len(content) < 40:
            return
        yield Record(
            source=self.name,
            source_url=self.SOURCE_URL,
            detail_url=detail_url,
            external_id=detail_url,
            title=title or detail_url,
            published_at=published_at or None,
            summary=summary or None,
            content=content,
            category="aktualnosci",
            raw={"html_sha256": sha256(response.content).hexdigest()},
        )


class MonNewsSource(HttpSource):
    name = "mon"
    BASE_URL = "https://www.gov.pl/web/obrona-narodowa/aktualnosci5"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        page = 1
        while page <= 20:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article")
            if article is None:
                break
            page_links: list[tuple[str, str, str | None, str | None]] = []
            for item in article.select(".art-prev li"):
                link_node = item.select_one(".title a[href]")
                if link_node is None:
                    continue
                detail_url = urljoin(response.url, str(link_node.get("href")))
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                title = link_node.get_text(" ", strip=True)
                date_node = item.select_one(".event .date")
                intro_node = item.select_one(".intro")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                summary = intro_node.get_text(" ", strip=True) if intro_node else None
                page_links.append((detail_url, title, published_at, summary))
            if not page_links:
                break
            for detail_url, title, published_at, summary in page_links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail_article = (
                    detail_soup.select_one("article") or detail_soup
                )
                heading = detail_article.select_one("h2")
                if heading:
                    title = heading.get_text(" ", strip=True)
                date_node = detail_article.select_one(".event-date")
                if date_node:
                    published_at = date_node.get_text(" ", strip=True)
                intro = detail_article.select_one(".intro")
                if intro:
                    summary = intro.get_text(" ", strip=True)
                content_node = detail_article.select_one(".editor-content")
                content = (
                    content_node.get_text("\n", strip=True)
                    if content_node
                    else detail_article.get_text("\n", strip=True)
                )
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    summary=summary,
                    content=content,
                    category="aktualnosci",
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest()
                    },
                )
            page += 1
            time.sleep(0.25)


class GisWarningsSource(HttpSource):
    name = "gis"
    BASE_URL = "https://www.gov.pl/web/gis/ostrzezenia"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        page = 1
        while page <= 20:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article")
            if article is None:
                break
            page_links: list[tuple[str, str, str | None]] = []
            for item in article.select(".art-prev li"):
                link_node = item.select_one(".title a[href]")
                if link_node is None:
                    continue
                detail_url = urljoin(response.url, str(link_node.get("href")))
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                title = link_node.get_text(" ", strip=True)
                date_node = item.select_one(".event .date")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                page_links.append((detail_url, title, published_at))
            if not page_links:
                break
            for detail_url, title, published_at in page_links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail_article = (
                    detail_soup.select_one("article") or detail_soup
                )
                heading = detail_article.select_one("h2")
                if heading:
                    title = heading.get_text(" ", strip=True)
                date_node = detail_article.select_one(".event-date")
                if date_node:
                    published_at = date_node.get_text(" ", strip=True)
                content_node = detail_article.select_one(".editor-content")
                content = (
                    content_node.get_text("\n", strip=True)
                    if content_node
                    else detail_article.get_text("\n", strip=True)
                )
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    content=content,
                    category="ostrzezenia",
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest()
                    },
                )
            page += 1
            time.sleep(0.25)


class PaaNewsSource(HttpSource):
    name = "paa"
    BASE_URL = "https://www.gov.pl/web/paa/aktualnosci2"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        page = 1
        while page <= 20:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article")
            if article is None:
                break
            page_links: list[tuple[str, str, str | None, str | None]] = []
            for item in article.select(".art-prev li"):
                link_node = item.select_one(".title a[href]")
                if link_node is None:
                    continue
                detail_url = urljoin(response.url, str(link_node.get("href")))
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                title = link_node.get_text(" ", strip=True)
                date_node = item.select_one(".event .date")
                intro_node = item.select_one(".intro")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                summary = intro_node.get_text(" ", strip=True) if intro_node else None
                page_links.append((detail_url, title, published_at, summary))
            if not page_links:
                break
            for detail_url, title, published_at, summary in page_links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail_article = (
                    detail_soup.select_one("article") or detail_soup
                )
                heading = detail_article.select_one("h2")
                if heading:
                    title = heading.get_text(" ", strip=True)
                date_node = detail_article.select_one(".event-date")
                if date_node:
                    published_at = date_node.get_text(" ", strip=True)
                intro = detail_article.select_one(".intro")
                if intro:
                    summary = intro.get_text(" ", strip=True)
                content_node = detail_article.select_one(".editor-content")
                content = (
                    content_node.get_text("\n", strip=True)
                    if content_node
                    else detail_article.get_text("\n", strip=True)
                )
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    summary=summary,
                    content=content,
                    category="aktualnosci",
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest()
                    },
                )
            page += 1
            time.sleep(0.25)


class MswiaRsoSource(HttpSource):
    name = "mswia_rso"
    BASE_URL = (
        "https://www.gov.pl/web/mswia/regionalny-system-ostrzegania"
    )

    def fetch(self) -> Iterable[Record]:
        response = self.get(self.BASE_URL)
        soup = BeautifulSoup(response.text, "html.parser")
        article = soup.select_one("article") or soup
        heading = article.select_one("h1, h2")
        title = (
            heading.get_text(" ", strip=True)
            if heading
            else "Regionalny System Ostrzegania"
        )
        content = article.get_text("\n", strip=True)
        if len(content) < 40:
            return
        yield Record(
            source=self.name,
            source_url=self.BASE_URL,
            external_id=self.BASE_URL,
            title=title,
            content=content,
            category="rso",
            raw={"html_sha256": sha256(response.content).hexdigest()},
        )


class PaaMonitoringSource(HttpSource):
    name = "paa_monitoring"
    BASE_URL = "https://monitoring.paa.gov.pl/maps-portal/"
    INITIAL_DATE_URL = "https://monitoring.paa.gov.pl/_api/maps/Menu/InitialDate"
    WFS_URL = "https://monitoring.paa.gov.pl/geoserver/ows"
    LAYERS = (
        ("pms", "paa:kcad_siec_pms_moc_dawki_mapa"),
        ("imgw", "paa:kcad_siec_imgw_auto_moc_dawki_mapa"),
    )

    def __init__(self, timeout: float = 30.0) -> None:
        super().__init__(timeout=timeout)
        self.session.headers.update(
            {
                "Accept": "application/json,text/plain,*/*",
                "Referer": self.BASE_URL,
                "Origin": "https://monitoring.paa.gov.pl",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
            }
        )

    def fetch(self) -> Iterable[Record]:
        response = self.session.get(
            self.INITIAL_DATE_URL,
            timeout=self.timeout,
        )
        response.raise_for_status()
        date_range = response.json()
        date_from = str(date_range[0]).replace("Z", ".000Z")
        date_to = str(date_range[1]).replace("Z", ".000Z")

        for network, layer in self.LAYERS:
            params = {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": layer,
                "outputFormat": "application/json",
                "viewparams": f"date_from:{date_from};date_to:{date_to}",
            }
            response = self.session.get(
                self.WFS_URL,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
            for feature in payload.get("features") or []:
                properties = feature.get("properties") or {}
                station_id = str(properties.get("id") or feature.get("id") or "")
                station_name = str(
                    properties.get("stacja")
                    or properties.get("tip_name")
                    or ""
                ).strip()
                if not station_id or not station_name:
                    continue
                tip_value = str(properties.get("tip_value") or "").strip()
                tip_date = str(properties.get("tip_date") or "").strip()
                color = str(properties.get("color") or "").strip() or None
                coordinates = (feature.get("geometry") or {}).get("coordinates") or []
                longitude = coordinates[0] if len(coordinates) > 0 else None
                latitude = coordinates[1] if len(coordinates) > 1 else None
                location = []
                if station_name:
                    location.append(station_name)
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    external_id=f"{network}:{station_id}",
                    title=f"{station_name} - moc dawki",
                    published_at=tip_date or None,
                    summary=tip_value or None,
                    content=(
                        f"Sieć: {network.upper()}\n"
                        f"Stacja: {station_name}\n"
                        f"Moc dawki: {tip_value}"
                    ),
                    category=network,
                    location=location,
                    raw={
                        "network": network,
                        "station_id": station_id,
                        "tip_value": tip_value,
                        "tip_date": tip_date,
                        "color": color,
                        "longitude": longitude,
                        "latitude": latitude,
                        "feature": feature,
                    },
                )


class GiosSource(HttpSource):
    name = "gios"
    CURRENT_URL = "https://powietrze.gios.gov.pl/pjp/current"
    WARNINGS_URL = "https://powietrze.gios.gov.pl/pjp/warnings"

    def fetch(self) -> Iterable[Record]:
        for category, source_url in (
            ("stanowiska", self.CURRENT_URL),
            ("ostrzezenia", self.WARNINGS_URL),
        ):
            try:
                response = self.get(source_url)
            except requests.RequestException:
                continue
            soup = BeautifulSoup(response.text, "html.parser")
            links = set()
            for anchor in soup.select("a[href]"):
                href = str(anchor.get("href", "")).strip()
                if category == "stanowiska" and "/station_details/info/" in href:
                    links.add(urljoin(response.url, href))
                if category == "ostrzezenia" and "/warnings/details_alarm/" in href:
                    links.add(urljoin(response.url, href))
            for detail_url in sorted(links):
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                if category == "stanowiska":
                    info_table = detail_soup.find(
                        "caption",
                        string=lambda value: value and "Informacje podstawowe" in value,
                    )
                    table = info_table.find_parent("table") if info_table else None
                    title = "Stanowisko pomiarowe GIOŚ"
                    content = ""
                    if table:
                        for row in table.select("tr"):
                            cells = row.find_all(["th", "td"])
                            if len(cells) == 2:
                                label = cells[0].get_text(" ", strip=True)
                                value = cells[1].get_text(" ", strip=True)
                                content += f"{label}: {value}\n"
                        station_name = table.find(
                            "th",
                            string=lambda value: value and "Nazwa stacji" in value,
                        )
                        if station_name:
                            name_cell = station_name.find_next("td")
                            if name_cell:
                                title = (
                                    f"Stanowisko pomiarowe GIOŚ: "
                                    f"{name_cell.get_text(' ', strip=True)}"
                                )
                else:
                    title = "Ostrzeżenie jakości powietrza GIOŚ"
                    content = ""
                    fields: dict[str, str] = {}
                    info_rows = detail_soup.select(".container .row")
                    for row in info_rows:
                        label_node = row.select_one("label")
                        if label_node is None:
                            continue
                        label = " ".join(
                            label_node.get_text(" ", strip=True).split()
                        ).rstrip(":")
                        value_node = row.select_one(".col-md-5")
                        if value_node is None:
                            continue
                        value = " ".join(
                            value_node.get_text(" ", strip=True).split()
                        )
                        if value:
                            content += f"{label}: {value}\n"
                            fields[label] = value
                    pollutant = fields.get("Zanieczyszczenie")
                    location = fields.get(
                        "Miejscowość, w której zlokalizowane jest stanowisko pomiarowe"
                    )
                    if pollutant or location:
                        title = "GIOŚ: "
                        title += pollutant or "ostrzeżenie jakości powietrza"
                        if location:
                            title += f" - {location}"
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=source_url,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    content=content,
                    category=category,
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest()
                    },
                )


class CertPlNewsSource(HttpSource):
    name = "cert_pl"
    BASE_URL = "https://moje.cert.pl/komunikaty/"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        page = 1
        while page <= 29:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            links: list[str] = []
            for anchor in soup.select('a[href*="/komunikaty/"]'):
                href = str(anchor.get("href", "")).strip()
                if not href or "/komunikaty/" not in href:
                    continue
                detail_url = urljoin(response.url, href)
                if detail_url.rstrip("/") == self.BASE_URL.rstrip("/"):
                    continue
                if detail_url not in seen:
                    seen.add(detail_url)
                    links.append(detail_url)
            if not links:
                break
            for detail_url in links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                main = detail_soup.select_one("#main-content") or detail_soup
                title_node = main.select_one("h1")
                title = (
                    title_node.get_text(" ", strip=True)
                    if title_node
                    else detail_url
                )
                badge = main.select_one(".advisory-dla-uzytkownikow, .advisory-dla-administratorow")
                category = badge.get_text(" ", strip=True) if badge else None
                date_node = main.select_one(".subtitle div")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                for modal in main.select(".modal, .modal-backdrop, script, nav"):
                    modal.decompose()
                content = main.get_text("\n", strip=True)
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    content=content,
                    category=category,
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest()
                    },
                )
            page += 1
            time.sleep(0.25)


class InfrastrukturaNewsSource(HttpSource):
    name = "infrastruktura"
    BASE_URL = "https://www.gov.pl/web/infrastruktura/aktualnosci"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        page = 1
        while page <= 20:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article")
            if article is None:
                break
            page_links: list[tuple[str, str, str | None, str | None]] = []
            for item in article.select(".art-prev li"):
                link_node = item.select_one(".title a[href]")
                if link_node is None:
                    continue
                detail_url = urljoin(response.url, str(link_node.get("href")))
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                title = link_node.get_text(" ", strip=True)
                date_node = item.select_one(".event .date")
                intro_node = item.select_one(".intro")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                summary = intro_node.get_text(" ", strip=True) if intro_node else None
                page_links.append((detail_url, title, published_at, summary))
            if not page_links:
                break
            for detail_url, title, published_at, summary in page_links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail_article = (
                    detail_soup.select_one("article") or detail_soup
                )
                heading = detail_article.select_one("h2")
                if heading:
                    title = heading.get_text(" ", strip=True)
                date_node = detail_article.select_one(".event-date")
                if date_node:
                    published_at = date_node.get_text(" ", strip=True)
                intro = detail_article.select_one(".intro")
                if intro:
                    summary = intro.get_text(" ", strip=True)
                content_node = detail_article.select_one(".editor-content")
                content = (
                    content_node.get_text("\n", strip=True)
                    if content_node
                    else detail_article.get_text("\n", strip=True)
                )
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    summary=summary,
                    content=content,
                    category="aktualnosci",
                    raw={
                        "html_sha256": sha256(detail_response.content).hexdigest()
                    },
                )
            page += 1
            time.sleep(0.25)


class InfrastrukturaInfoSource(HttpSource):
    name = "infrastruktura_info"
    PAGES = (
        (
            "prawa_pasazera",
            "https://www.gov.pl/web/infrastruktura/prawa-pasazerow",
        ),
        (
            "infolinia",
            "https://www.gov.pl/web/infrastruktura/infolinia-dla-obywatela",
        ),
        (
            "dane_kontaktowe",
            "https://www.gov.pl/web/infrastruktura/dane-kontaktowe",
        ),
    )

    def fetch(self) -> Iterable[Record]:
        for category, url in self.PAGES:
            response = self.get(url)
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article") or soup
            heading = article.select_one("h1, h2")
            title = (
                heading.get_text(" ", strip=True)
                if heading
                else url.rsplit("/", 1)[-1]
            )
            content = article.get_text("\n", strip=True)
            if len(content) < 40:
                continue
            yield Record(
                source=self.name,
                source_url=url,
                external_id=url,
                title=title,
                content=content,
                category=category,
                raw={"html_sha256": sha256(response.content).hexdigest()},
            )


class GddkiaNewsSource(HttpSource):
    name = "gddkia"
    BASE_URL = "https://www.gov.pl/web/gddkia/aktualnosci-2026"

    def fetch(self) -> Iterable[Record]:
        seen: set[str] = set()
        page = 1
        while page <= 20:
            url = self.BASE_URL if page == 1 else f"{self.BASE_URL}?page={page}"
            try:
                response = self.get(url)
            except requests.RequestException:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article")
            if article is None:
                break
            page_links: list[tuple[str, str, str | None, str | None]] = []
            for item in article.select(".art-prev li"):
                link_node = item.select_one(".title a[href]")
                if link_node is None:
                    continue
                detail_url = urljoin(response.url, str(link_node.get("href")))
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                date_node = item.select_one(".event")
                published_at = (
                    date_node.get_text(" ", strip=True) if date_node else None
                )
                intro_node = item.select_one(".intro")
                summary = intro_node.get_text(" ", strip=True) if intro_node else None
                page_links.append(
                    (
                        detail_url,
                        link_node.get_text(" ", strip=True),
                        published_at,
                        summary,
                    )
                )
            if not page_links:
                break
            for detail_url, title, published_at, summary in page_links:
                try:
                    detail_response = self.get(detail_url)
                except requests.RequestException:
                    continue
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail_article = detail_soup.select_one("article") or detail_soup
                heading = detail_article.select_one("h2")
                if heading:
                    title = heading.get_text(" ", strip=True)
                date_node = detail_article.select_one(".event-date")
                if date_node:
                    published_at = date_node.get_text(" ", strip=True)
                intro = detail_article.select_one(".intro")
                if intro:
                    summary = intro.get_text(" ", strip=True)
                content_node = detail_article.select_one(".editor-content")
                content = (
                    content_node.get_text("\n", strip=True)
                    if content_node
                    else detail_article.get_text("\n", strip=True)
                )
                if len(content) < 40:
                    continue
                yield Record(
                    source=self.name,
                    source_url=self.BASE_URL,
                    detail_url=detail_url,
                    external_id=detail_url,
                    title=title,
                    published_at=published_at,
                    summary=summary,
                    content=content,
                    category="aktualnosci",
                    raw={"html_sha256": sha256(detail_response.content).hexdigest()},
                )
            page += 1
            time.sleep(0.25)


class GddkiaInfoSource(HttpSource):
    name = "gddkia_info"
    PAGES = (
        (
            "informacja_drogowa",
            "https://www.gov.pl/web/gddkia/informacja-drogowa---19-111",
        ),
    )

    def fetch(self) -> Iterable[Record]:
        for category, url in self.PAGES:
            response = self.get(url)
            soup = BeautifulSoup(response.text, "html.parser")
            article = soup.select_one("article") or soup
            heading = article.select_one("h1, h2")
            title = heading.get_text(" ", strip=True) if heading else "GDDKiA"
            content = article.get_text("\n", strip=True)
            if len(content) < 40:
                continue
            yield Record(
                source=self.name,
                source_url=url,
                external_id=url,
                title=title,
                content=content,
                category=category,
                raw={"html_sha256": sha256(response.content).hexdigest()},
            )


class GddkiaMapSource(HttpSource):
    name = "gddkia_map"
    BASE_URL = "https://kpd.gddkia.gov.pl/amp/api/waypoints"
    SOURCE_URL = "https://drogi.gddkia.gov.pl/mapy/mapa-informacji-drogowej"
    LAYERS = (
        ("situations", "situations.json"),
        ("mops", "mops.json"),
        ("pids", "pids.json"),
        ("vms", "vms.json"),
    )

    @staticmethod
    def _timestamp(value) -> str | None:
        if value in (None, "", 0):
            return None
        try:
            return datetime.fromtimestamp(
                float(value) / 1000,
                tz=timezone.utc,
            ).isoformat()
        except (TypeError, ValueError, OverflowError):
            return None

    def fetch(self) -> Iterable[Record]:
        for category, filename in self.LAYERS:
            url = f"{self.BASE_URL}/{filename}"
            payload = self.get_json(url)
            items = payload.get("response") or []
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or "").strip()
                if not item_id:
                    continue
                latitude = item.get("latitude")
                longitude = item.get("longitude")
                road_number = str(item.get("road_number") or "").strip()
                road_name = str(item.get("road_name") or "").strip()
                name = str(
                    item.get("name")
                    or item.get("road_name")
                    or road_number
                    or item_id
                ).strip()
                if category == "situations":
                    title = (
                        f"{road_number or 'Droga'} - "
                        f"{item.get('situation_class') or 'utrudnienie'}"
                    )
                    content = str(item.get("description") or "").strip()
                    if item.get("hints_for_drivers"):
                        content = (
                            f"{content}\nWskazówki: "
                            f"{item['hints_for_drivers']}"
                        ).strip()
                elif category == "mops":
                    title = f"MOP {name}"
                    content = (
                        f"Miejsce: {item.get('city') or name}\n"
                        f"Kat. drogi: {item.get('technical_road_class') or ''}\n"
                        f"Administrator: {item.get('administrator') or ''}"
                    ).strip()
                elif category == "pids":
                    title = f"Punkt Informacji Drogowej: {name}"
                    phones = item.get("phones") or []
                    content = (
                        f"Adres: {item.get('address') or ''}\n"
                        f"Telefon: {', '.join(str(phone) for phone in phones)}"
                    ).strip()
                else:
                    title = f"Tablica zmiennej treści: {name}"
                    messages = item.get("messages") or []
                    content = (
                        f"Droga: {road_number or 'brak'}\n"
                        f"Kierunek: {item.get('direction') or 'brak'}\n"
                        f"Wiadomości: {len(messages)}"
                    )
                yield Record(
                    source=self.name,
                    source_url=self.SOURCE_URL,
                    external_id=f"{category}:{item_id}",
                    title=title,
                    published_at=self._timestamp(
                        item.get("create_date")
                        or item.get("start_date")
                    ),
                    valid_from=self._timestamp(item.get("start_date")),
                    valid_to=self._timestamp(item.get("end_date")),
                    content=content,
                    category=category,
                    location=([item.get("voivodeship")] if item.get("voivodeship") else []),
                    raw={
                        "layer": category,
                        "item_id": item_id,
                        "latitude": latitude,
                        "longitude": longitude,
                        "road_number": road_number or None,
                        "road_name": road_name or None,
                    },
                )


class GddkiaObstaclesSource:
    name = "gddkia_obstacles"
    SOURCE_URL = (
        "https://drogi.gddkia.gov.pl/informacje-drogowe/lista-utrudnien"
    )

    def __init__(self, snapshot_path: str | Path = "data/gddkia_utrudnienia_raw.json") -> None:
        self.snapshot_path = Path(snapshot_path)

    def fetch(self) -> Iterable[Record]:
        if not self.snapshot_path.exists():
            raise SourceError(
                f"Missing GDDKiA snapshot: {self.snapshot_path}"
            )
        rows = json.loads(
            self.snapshot_path.read_text(encoding="utf-8")
        )
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            road = str(row.get("road") or "").strip()
            section = str(row.get("section") or "").strip()
            if not road or road == "Droga":
                continue
            voivodeship = str(row.get("voivodeship") or "").strip()
            obstacle_type = str(row.get("type") or "").strip()
            effect = str(row.get("effect") or "").strip()
            start = str(row.get("start") or "").strip()
            end = str(row.get("end") or "").strip()
            info = str(row.get("info") or "").strip()
            title = f"{road} - {section}" if section else road
            content_parts = [
                f"Droga: {road}",
                f"Odcinek: {section}" if section else None,
                f"Województwo: {voivodeship}" if voivodeship else None,
                f"Rodzaj: {obstacle_type}" if obstacle_type else None,
                f"Skutek: {effect}" if effect else None,
                f"Rozpoczęcie: {start}" if start else None,
                f"Zakończenie: {end}" if end else None,
                info or None,
            ]
            content = "\n".join(part for part in content_parts if part)
            external_id = "|".join(
                (road, section, voivodeship, start, end, str(index))
            )
            yield Record(
                source=self.name,
                source_url=self.SOURCE_URL,
                external_id=sha256(external_id.encode()).hexdigest(),
                title=title,
                published_at=start or None,
                valid_from=start or None,
                valid_to=end or None,
                content=content,
                category=obstacle_type or "utrudnienie",
                location=[voivodeship] if voivodeship else [],
                raw={"snapshot": row},
            )


class GovHtmlSource(HttpSource):
    name = "gov_html"

    def __init__(self, url: str, name: str | None = None) -> None:
        super().__init__()
        self.url = url
        self.name = name or "gov_html"

    def fetch(self) -> Iterable[Record]:
        response = self.get(self.url)
        soup = BeautifulSoup(response.text, "html.parser")

        article_links: list[str] = []
        for anchor in soup.select("article a[href], .list-item a[href], .news a[href]"):
            href = anchor.get("href")
            if href:
                article_links.append(urljoin(response.url, href))

        # Keep only unique, canonical gov.pl URLs.
        for link in dict.fromkeys(article_links):
            if "/web/" not in link:
                continue
            try:
                article_response = self.get(link)
            except requests.RequestException:
                continue

            article_soup = BeautifulSoup(article_response.text, "html.parser")
            article = article_soup.select_one("article") or article_soup
            heading = article_soup.select_one("h1")
            title = heading.get_text(" ", strip=True) if heading else link
            text = article.get_text("\n", strip=True)
            if len(text) < 40:
                continue

            yield Record(
                source=self.name,
                source_url=link,
                external_id=link,
                title=title,
                content=text,
                raw={
                    "html_sha256": __import__("hashlib")
                    .sha256(article_response.content)
                    .hexdigest()
                },
            )


class OdyseuszSource(HttpSource):
    name = "odyseusz"
    BASE = "https://odyseusz.gov.pl"

    ENDPOINTS = (
        ("main", "informacje/strona-glowna/mini"),
        ("banner", "informacje/strona-glowna/baner-sytuacje-kryzysowe"),
        ("useful_information", "informacje/strona-glowna/kafelki"),
        ("footers", "informacje/strona-glowna/stopki"),
        ("theme_pages", "informacje/strony-tematyczne"),
        ("theme_pages_mini", "informacje/strony-tematyczne/mini"),
        ("country_profiles", "informacje/profile-panstw"),
        ("country_profiles_mini", "informacje/profile-panstw/mini"),
        ("poland_warnings", "informacje/pl/ostrzezenia"),
    )

    def fetch(self) -> Iterable[Record]:
        for category, path in self.ENDPOINTS:
            endpoint = f"{self.BASE}/api/v1/{path}"
            response = self.get(endpoint)
            if "application/json" not in response.headers.get("content-type", "").lower():
                continue

            payload = response.json()

            if category == "main":
                yield Record(
                    source=self.name,
                    source_url=self.BASE,
                    external_id="main",
                    title="Odyseusz - dlaczego warto zglosic podroz",
                    content=str(payload.get("trescDlaczegoWarto") or ""),
                    category=category,
                    raw={"endpoint": endpoint, "payload": payload},
                )
            elif category == "banner":
                yield Record(
                    source=self.name,
                    source_url=self.BASE,
                    external_id="banner",
                    title="Odyseusz - sytuacja kryzysowa",
                    summary=str(payload.get("tresc") or ""),
                    content=str(payload.get("tresc") or ""),
                    category=category,
                    raw={"endpoint": endpoint, "payload": payload},
                )
            elif category in {"useful_information", "footers", "theme_pages_mini",
                              "country_profiles_mini"}:
                for index, item in enumerate(payload if isinstance(payload, list) else []):
                    title = str(
                        item.get("naglowek")
                        or item.get("tekst")
                        or item.get("nazwa")
                        or item.get("kod")
                        or f"{category}-{index}"
                    )
                    external_id = str(
                        item.get("kod")
                        or item.get("kodIso")
                        or item.get("url")
                        or f"{category}-{index}"
                    )
                    yield Record(
                        source=self.name,
                        source_url=endpoint,
                        external_id=f"{category}:{external_id}",
                        title=title,
                        summary=str(item.get("tresc") or "").strip() or None,
                        content=str(item.get("tresc") or "").strip() or None,
                        category=category,
                        location=[item.get("nazwa")] if item.get("nazwa") else [],
                        raw={"endpoint": endpoint, "payload": item},
                    )
            elif category == "theme_pages":
                for index, item in enumerate(payload if isinstance(payload, list) else []):
                    title = str(item.get("nazwa") or item.get("kod") or f"theme-{index}")
                    external_id = str(item.get("kod") or f"theme-{index}")
                    yield Record(
                        source=self.name,
                        source_url=f"{self.BASE}/strona-tematyczna/{external_id}",
                        external_id=f"theme:{external_id}",
                        title=title,
                        category=category,
                        raw={"endpoint": endpoint, "payload": item},
                    )
            elif category == "country_profiles":
                for index, item in enumerate(payload if isinstance(payload, list) else []):
                    code = str(item.get("kodIso") or f"country-{index}")
                    title = str(item.get("nazwa") or code)
                    text_fields = (
                        "kontaktyAlarmowePodsumowanie",
                        "trescPowiadomieniaDluga",
                        "trescOstrzezenia",
                    )
                    content_parts = [
                        str(item.get(field)).strip()
                        for field in text_fields
                        if item.get(field)
                    ]
                    yield Record(
                        source=self.name,
                        source_url=f"{self.BASE}/kraje/{code}",
                        external_id=f"country:{code}",
                        title=title,
                        published_at=item.get("dataZatwierdzenia"),
                        content="\n\n".join(content_parts) or None,
                        category=str(item.get("bazowyKodPoziomuZagrozenia") or category),
                        location=[title],
                        raw={"endpoint": endpoint, "payload": item},
                    )
            elif category == "poland_warnings":
                yield Record(
                    source=self.name,
                    source_url=f"{self.BASE}/kraje/PL",
                    external_id="poland-warnings",
                    title="Odyseusz - ostrzezenia dla Polski",
                    published_at=payload.get("dataObowiazywaniaOd"),
                    summary=str(payload.get("trescOstrzezeniaDlaKraju") or ""),
                    content=str(payload.get("trescOstrzezeniaDlaKraju") or ""),
                    category=str(payload.get("bazowyKodOstrzezenia") or category),
                    location=["Polska"],
                    raw={"endpoint": endpoint, "payload": payload},
                )


class GoogleFactCheckSource(HttpSource):
    name = "google_fact_check"

    def fetch(self) -> Iterable[Record]:
        api_key = os.getenv("GOOGLE_FACT_CHECK_API_KEY")
        if not api_key:
            raise SourceError(
                "Set GOOGLE_FACT_CHECK_API_KEY to use the official Fact Check Tools API"
            )

        page_token: str | None = None
        seen: set[str] = set()
        while True:
            params = {
                "key": api_key,
                "languageCode": "pl",
                "pageSize": 100,
            }
            if page_token:
                params["pageToken"] = page_token

            url = "https://factchecktools.googleapis.com/v1alpha1/claims:search"
            response = self.session.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()

            for claim in data.get("claims") or []:
                claim_text = str(claim.get("text") or "").strip()
                claim_review = claim.get("claimReview") or []
                for review in claim_review:
                    url_review = str(review.get("url") or "").strip()
                    publisher = review.get("publisher") or {}
                    external_id = url_review or sha256(
                        f"{claim_text}|{publisher.get('name')}|{review.get('title')}".encode()
                    ).hexdigest()
                    if external_id in seen:
                        continue
                    seen.add(external_id)

                    yield Record(
                        source=self.name,
                        source_url=url_review or "https://toolbox.google.com/factcheck/explorer",
                        external_id=external_id,
                        title=str(review.get("title") or claim_text).strip(),
                        summary=claim_text,
                        published_at=review.get("reviewDate"),
                        language=str(claim.get("languageCode") or "pl"),
                        category=str(publisher.get("name") or "").strip() or None,
                        raw={"claim": claim, "review": review},
                    )

            page_token = data.get("nextPageToken")
            if not page_token:
                break
