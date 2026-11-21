/**
 * Indicator catalog: which official series answers which kind of numeric claim. Claim extraction
 * picks a key from here (a classification task), and code fetches the exact value. The model never
 * searches for or writes numbers. This is a source catalog, not test data (rule 16).
 * Every Eurostat entry below was verified live on 2026-11-21 (dataset + filters → one value per year).
 */

export interface EurostatSeries {
  dataset: string;
  filters: Record<string, string>;
}

export interface Indicator {
  key: string;
  /** Shown to the extraction model and in the record. */
  label_pl: string;
  unit: string;
  /** "percent": a rate in % (small absolute tolerance floor); "number": a count or level. */
  kind: "percent" | "number";
  /** Definition note rendered in the record, so differences in method are visible. */
  definition: string;
  eurostat?: EurostatSeries;
  nbp?: "exchange_rate" | "gold_price" | "reference_rate";
  /** Verified GUS BDL variable id (national level). Only verified ids: a wrong series is worse than none. */
  gus_var?: number;
  /** Compare absolute values: a deficit is stored as a negative number but said as a positive one. */
  compare_abs?: boolean;
}

export const INDICATORS: Indicator[] = [
  { key: "unemployment_rate", label_pl: "Stopa bezrobocia (BAEL, 15-74 lata)", unit: "%", kind: "percent", definition: "Eurostat, badanie aktywności ekonomicznej ludności (definicja MOP); stopa bezrobocia rejestrowanego GUS jest wyższa", eurostat: { dataset: "une_rt_a", filters: { age: "Y15-74", unit: "PC_ACT", sex: "T" } } },
  { key: "inflation", label_pl: "Inflacja HICP (średnioroczna zmiana cen)", unit: "%", kind: "percent", definition: "Eurostat, zharmonizowany wskaźnik cen konsumpcyjnych HICP; wskaźnik CPI GUS może się nieznacznie różnić", eurostat: { dataset: "prc_hicp_aind", filters: { unit: "RCH_A_AVG", coicop: "CP00" } } },
  { key: "gdp_growth", label_pl: "Realny wzrost PKB", unit: "%", kind: "percent", definition: "Eurostat, zmiana PKB w cenach stałych rok do roku", eurostat: { dataset: "tec00115", filters: { unit: "CLV_PCH_PRE", na_item: "B1GQ" } } },
  { key: "gdp_per_capita_pps", label_pl: "PKB na mieszkańca wg parytetu siły nabywczej (UE = 100)", unit: "UE=100", kind: "number", definition: "Eurostat, PKB per capita w PPS, średnia UE = 100", eurostat: { dataset: "tec00114", filters: {} } },
  { key: "government_debt", label_pl: "Dług sektora instytucji rządowych i samorządowych", unit: "% PKB", kind: "percent", definition: "Eurostat, dług wg definicji UE (EDP), % PKB", eurostat: { dataset: "gov_10dd_edpt1", filters: { unit: "PC_GDP", sector: "S13", na_item: "GD" } } },
  { key: "government_deficit", label_pl: "Deficyt (-) / nadwyżka (+) sektora finansów publicznych", unit: "% PKB", kind: "percent", definition: "Eurostat, wynik sektora instytucji rządowych i samorządowych (EDP), % PKB; wartość ujemna to deficyt", eurostat: { dataset: "gov_10dd_edpt1", filters: { unit: "PC_GDP", sector: "S13", na_item: "B9" } }, compare_abs: true },
  { key: "population", label_pl: "Liczba ludności", unit: "osób", kind: "number", definition: "Eurostat: ludność stała na 1 stycznia; GUS: ludność faktycznie zamieszkała na 31 grudnia. Definicje się różnią", eurostat: { dataset: "tps00001", filters: {} }, gus_var: 72305 },
  { key: "employment_rate", label_pl: "Wskaźnik zatrudnienia (20-64 lata)", unit: "%", kind: "percent", definition: "Eurostat, BAEL, odsetek osób pracujących w wieku 20-64 lat", eurostat: { dataset: "lfsi_emp_a", filters: { age: "Y20-64", unit: "PC_POP", sex: "T", indic_em: "EMP_LFS" } } },
  { key: "life_expectancy", label_pl: "Przeciętne dalsze trwanie życia noworodka", unit: "lat", kind: "number", definition: "Eurostat, oczekiwana długość życia w chwili urodzenia, obie płcie", eurostat: { dataset: "demo_mlexpec", filters: { sex: "T", age: "Y_LT1", unit: "YR" } } },
  { key: "fertility_rate", label_pl: "Współczynnik dzietności", unit: "dzieci na kobietę", kind: "number", definition: "Eurostat, całkowity współczynnik dzietności", eurostat: { dataset: "demo_find", filters: { indic_de: "TOTFERRT" } } },
  { key: "minimum_wage", label_pl: "Płaca minimalna (miesięczna, brutto)", unit: "EUR", kind: "number", definition: "Eurostat, w euro, dane półroczne (S1 = styczeń, S2 = lipiec); kwota w złotych zależy od kursu", eurostat: { dataset: "earn_mw_cur", filters: { currency: "EUR" } } },
  { key: "poverty_risk", label_pl: "Zagrożenie ubóstwem lub wykluczeniem społecznym (AROPE)", unit: "%", kind: "percent", definition: "Eurostat, odsetek ludności (wskaźnik AROPE)", eurostat: { dataset: "ilc_peps01n", filters: { unit: "PC", age: "TOTAL", sex: "T" } } },
  { key: "house_prices", label_pl: "Zmiana cen mieszkań (średniorocznie)", unit: "%", kind: "percent", definition: "Eurostat, indeks cen nieruchomości mieszkalnych, zmiana średnioroczna", eurostat: { dataset: "prc_hpi_a", filters: { purchase: "TOTAL", unit: "RCH_A_AVG" } } },
  { key: "exchange_rate", label_pl: "Średni kurs waluty NBP (w złotych)", unit: "PLN", kind: "number", definition: "NBP, tabela A kursów średnich", nbp: "exchange_rate" },
  { key: "gold_price", label_pl: "Cena złota NBP (zł za 1 g)", unit: "PLN/g", kind: "number", definition: "NBP, cena 1 g złota (próby 1000)", nbp: "gold_price" },
  { key: "nbp_reference_rate", label_pl: "Stopa referencyjna NBP", unit: "%", kind: "percent", definition: "NBP, obecnie obowiązująca stopa referencyjna (archiwum stóp nie jest jeszcze podłączone)", nbp: "reference_rate" },
];

export const INDICATOR_KEYS = INDICATORS.map((i) => i.key) as [string, ...string[]];
export const indicatorByKey = (key: string | null | undefined) => INDICATORS.find((i) => i.key === key);

export const EU_MEMBERS = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

/** ISO country code → Eurostat geo code (Greece is EL; "EU" is the EU-27 aggregate). */
export function eurostatGeo(geo: string | null | undefined): string {
  const g = (geo ?? "PL").toUpperCase();
  if (g === "GR") return "EL";
  if (g === "EU" || g === "UE" || g === "EU27") return "EU27_2020";
  return g;
}

export const GEO_NAMES_PL: Record<string, string> = {
  AT: "Austria", BE: "Belgia", BG: "Bułgaria", CY: "Cypr", CZ: "Czechy", DE: "Niemcy", DK: "Dania", EE: "Estonia",
  EL: "Grecja", ES: "Hiszpania", FI: "Finlandia", FR: "Francja", HR: "Chorwacja", HU: "Węgry", IE: "Irlandia",
  IT: "Włochy", LT: "Litwa", LU: "Luksemburg", LV: "Łotwa", MT: "Malta", NL: "Holandia", PL: "Polska",
  PT: "Portugalia", RO: "Rumunia", SE: "Szwecja", SI: "Słowenia", SK: "Słowacja", EU27_2020: "Unia Europejska (27 państw)",
};

export const geoName = (code: string) => GEO_NAMES_PL[code] ?? code;

/** Period the claim refers to, parsed from the extraction "time" field (ISO-like or free text). */
export interface ClaimPeriod {
  year: number | null;
  month: number | null;
  day: string | null;
}

export function parsePeriod(time: string | null | undefined): ClaimPeriod {
  const t = time ?? "";
  const d = t.match(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])(?!\d)/);
  if (d) return { year: +d[1], month: +d[2], day: d[0] };
  // "2025-06" is a month; "2020-2024" is a range of years (the lookahead rejects "2020-20…").
  const m = t.match(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])(?!\d)/);
  if (m) return { year: +m[1], month: +m[2], day: null };
  const years = [...t.matchAll(/\b((?:19|20)\d{2})(?!\d)/g)].map((x) => +x[1]);
  // "2023-2025" or "od 2020 do 2024": the end of the range is the period the number describes.
  return { year: years.length ? years[years.length - 1] : null, month: null, day: null };
}

/** Polish number format with plain spaces (a no-break space would break verbatim quote matching). */
export function formatNumber(v: number, unit: string, digits = 4): string {
  const s = v.toLocaleString("pl-PL", { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : digits }).replace(/[\u00a0\u202f]/g, " ");
  if (unit === "%") return `${s}%`;
  if (unit === "% PKB") return `${s}% PKB`;
  return `${s} ${unit}`;
}
