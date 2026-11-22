from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceSpec:
    name: str
    url: str
    enabled: bool = False
    type: str = "gov_html"


SOURCES = (
    SourceSpec("rso", "https://www.gov.pl/web/gov/ostrzezenia", True, "rso"),
    SourceSpec(
        "rso_mazowieckie",
        "https://www.gov.pl/web/gov/ostrzezenia#/_/mazowieckie/wszystkie",
        True,
        "rso_mazowieckie",
    ),
    SourceSpec("odyseusz", "https://odyseusz.gov.pl/", True, "odyseusz"),
    SourceSpec(
        "rcb_report",
        "https://www.gov.pl/web/rcb/raport-dobowy3",
        True,
        "rcb_report",
    ),
    SourceSpec(
        "google_fact_check",
        "https://toolbox.google.com/factcheck/explorer",
        True,
        "google_fact_check",
    ),
    SourceSpec(
        "kgpsp",
        "https://www.gov.pl/web/kgpsp/aktualnosci",
        True,
        "kgpsp",
    ),
    SourceSpec(
        "policja",
        "https://policja.pl/pol/aktualnosci",
        True,
        "policja",
    ),
    SourceSpec(
        "mazowiecka_policja",
        "https://mazowiecka.policja.gov.pl/ra/aktualnosci/aktualnosci",
        True,
        "mazowiecka_policja",
    ),
    SourceSpec(
        "mon",
        "https://www.gov.pl/web/obrona-narodowa/aktualnosci5",
        True,
        "mon",
    ),
    SourceSpec(
        "gis",
        "https://www.gov.pl/web/gis/ostrzezenia",
        True,
        "gis",
    ),
    SourceSpec(
        "paa",
        "https://www.gov.pl/web/paa/panstwowa-agencja-atomistyki",
        True,
        "paa",
    ),
    SourceSpec(
        "paa_monitoring",
        "https://monitoring.paa.gov.pl/maps-portal/",
        True,
        "paa_monitoring",
    ),
    SourceSpec(
        "mswia_rso",
        "https://www.gov.pl/web/mswia/regionalny-system-ostrzegania",
        True,
        "mswia_rso",
    ),
    SourceSpec(
        "gios",
        "https://powietrze.gios.gov.pl/pjp/",
        True,
        "gios",
    ),
    SourceSpec(
        "cert_pl",
        "https://moje.cert.pl/komunikaty/",
        True,
        "cert_pl",
    ),
    SourceSpec(
        "infrastruktura",
        "https://www.gov.pl/web/infrastruktura/aktualnosci",
        True,
        "infrastruktura",
    ),
    SourceSpec(
        "infrastruktura_info",
        "https://www.gov.pl/web/infrastruktura/prawa-pasazerow",
        True,
        "infrastruktura_info",
    ),
    SourceSpec("infrastruktura", "https://www.gov.pl/web/infrastruktura", True, "gov_html"),
    SourceSpec(
        "infrastruktura_news",
        "https://www.gov.pl/web/infrastruktura/aktualnosci",
        True,
        "gov_html",
    ),
    SourceSpec(
        "gddkia",
        "https://drogi.gddkia.gov.pl/informacje-drogowe",
        True,
        "gddkia",
    ),
    SourceSpec(
        "gddkia_info",
        "https://www.gov.pl/web/gddkia/informacja-drogowa---19-111",
        True,
        "gddkia_info",
    ),
    SourceSpec(
        "gddkia_obstacles",
        "https://drogi.gddkia.gov.pl/informacje-drogowe/lista-utrudnien",
        True,
        "gddkia_obstacles",
    ),
    SourceSpec(
        "gddkia_map",
        "https://drogi.gddkia.gov.pl/mapy/mapa-informacji-drogowej",
        True,
        "gddkia_map",
    ),
    SourceSpec("ulc", "https://ulc.gov.pl/", True, "ulc"),
    SourceSpec(
        "ulc_prawa_pasazera",
        "https://ulc.gov.pl/prawa-pasazera",
        True,
        "ulc_passenger",
    ),
    SourceSpec(
        "ulc_poradnik_pasazera",
        "https://ulc.gov.pl/prawa-pasazera/poradnik-dla-pasazerow",
        True,
        "ulc_passenger",
    ),
    SourceSpec(
        "portal_pasazera",
        "https://portalpasazera.pl/",
        True,
        "portal_pasazera",
    ),
    SourceSpec(
        "utk",
        "https://utk.gov.pl/pl/pasazerowie",
        True,
        "utk",
    ),
    SourceSpec("kgsok", "https://kgsok.pl/", True, "kgsok"),
    SourceSpec("sar", "https://www.sar.gov.pl/", True, "sar"),
    SourceSpec("umgdy", "https://www.umgdy.gov.pl/", True, "umgdy"),
    SourceSpec(
        "ums_navigation",
        "https://www.ums.gov.pl/bezpieczenstwo-morskie/warunki-zeglugi",
        True,
        "ums_navigation",
    ),
    SourceSpec(
        "wody_polskie_navigation",
        "https://www.gov.pl/web/wody-polskie/komunikaty-nawigacyjne",
        True,
        "wody_polskie_navigation",
    ),
    SourceSpec("imgw_meteo", "https://meteo.imgw.pl/", True, "gov_html"),
    SourceSpec("imgw_hydro", "https://hydro.imgw.pl/", True, "gov_html"),
    SourceSpec("imgw_baltyk", "https://baltyk.imgw.pl/", True, "gov_html"),
    SourceSpec("demagog", "https://demagog.org.pl/", True, "demagog"),
    SourceSpec("kprm", "https://www.gov.pl/web/premier/wydarzenia", True, "govpl"),
)
