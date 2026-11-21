/**
 * Trusted-source catalog: the allowlist of publishers whose material may become evidence.
 * Records from anywhere else are dropped before the model sees them (we never search the open web).
 * The tier decides how much one record counts (pipeline/verdict.ts):
 *   official   public authority or official statistics: enough alone
 *   factcheck  IFCN/EFCSN-verified fact-checker: enough alone (interim policy, open-questions.md)
 *   media      trusted newsroom without fact-checker certification: needs a second independent origin
 * Researched 2026-11-21: architecture/data-sources-research.md#trusted-source-catalog.
 * Credentials come from public registers; re-check them before submission (open-questions.md).
 */
import type { SourceTier } from "../types.ts";

export type SourceKind = "official" | "fact_checker" | "news_agency" | "public_media";
/** How the source reaches the pipeline today. */
export type SourceAccess = "live_api" | "google_factcheck" | "not_connected";

export interface TrustedSource {
  id: string;
  name: string;
  /** Matched against the citation URL host (exact or subdomain). */
  domains: string[];
  kind: SourceKind;
  tier: SourceTier;
  country: string;
  credentials: string;
  access: SourceAccess;
  access_note: string;
  terms: string;
}

const VIA_GFC = "Weryfikacje z oznaczeniem ClaimReview, pobierane przez Google Fact Check Tools API.";

export const TRUSTED_SOURCES: TrustedSource[] = [
  // ── Official: live APIs ────────────────────────────────────────────────────
  { id: "sejm_eli", name: "Sejm RP: Internetowy System Aktów Prawnych (ELI)", domains: ["sejm.gov.pl"], kind: "official", tier: "official", country: "PL", credentials: "organ władzy publicznej", access: "live_api", access_note: "api.sejm.gov.pl/eli, bez klucza", terms: "akty prawne nie podlegają prawu autorskiemu (art. 4 pr. aut.)" },
  { id: "eurostat", name: "Eurostat", domains: ["ec.europa.eu"], kind: "official", tier: "official", country: "EU", credentials: "urząd statystyczny UE", access: "live_api", access_note: "Eurostat dissemination API (JSON-stat), bez klucza", terms: "ponowne wykorzystanie z podaniem źródła (decyzja Komisji 2011/833/UE)" },
  { id: "nbp", name: "Narodowy Bank Polski", domains: ["nbp.pl"], kind: "official", tier: "official", country: "PL", credentials: "bank centralny", access: "live_api", access_note: "api.nbp.pl (kursy, złoto) i static.nbp.pl (stopy procentowe), bez klucza", terms: "dane publiczne, z podaniem źródła" },
  { id: "gus", name: "Główny Urząd Statystyczny (Bank Danych Lokalnych)", domains: ["stat.gov.pl"], kind: "official", tier: "official", country: "PL", credentials: "urząd statystyczny", access: "live_api", access_note: "bdl.stat.gov.pl/api/v1, bez klucza; trasa opcjonalna (serwis bywa niedostępny)", terms: "dane publiczne, z podaniem źródła" },
  { id: "gov_pl", name: "Serwis Rzeczypospolitej Polskiej (gov.pl)", domains: ["gov.pl"], kind: "official", tier: "official", country: "PL", credentials: "administracja publiczna", access: "not_connected", access_note: "komunikaty RCB, GIS, ministerstw: do zaindeksowania w korpusie", terms: "tekst na licencji CC BY-SA 4.0" },
  { id: "policja", name: "Policja.pl", domains: ["policja.pl"], kind: "official", tier: "official", country: "PL", credentials: "publiczny serwis Policji", access: "not_connected", access_note: "artykuły zasilane do lokalnego korpusu; zakres i retencja wymagają sprawdzenia", terms: "cytat z podaniem źródła; pełny korpus ma status conditional" },

  // ── Fact-checkers (IFCN / EFCSN) via Google Fact Check ────────────────────
  { id: "demagog", name: "Demagog", domains: ["demagog.org.pl"], kind: "fact_checker", tier: "factcheck", country: "PL", credentials: "IFCN, EFCSN", access: "google_factcheck", access_note: `${VIA_GFC} Bezpośrednie pobieranie zablokowane (robots.txt blokuje boty AI).`, terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "afp", name: "AFP Sprawdzam / AFP Fact Check", domains: ["afp.com"], kind: "fact_checker", tier: "factcheck", country: "INT", credentials: "IFCN, EFCSN", access: "google_factcheck", access_note: VIA_GFC, terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "oko_press", name: "OKO.press (Prawda czy fałsz)", domains: ["oko.press"], kind: "fact_checker", tier: "factcheck", country: "PL", credentials: "deklaruje kodeks IFCN (status do potwierdzenia)", access: "google_factcheck", access_note: VIA_GFC, terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "konkret24", name: "Konkret24 (TVN24)", domains: ["konkret24.tvn24.pl"], kind: "fact_checker", tier: "factcheck", country: "PL", credentials: "redakcja fact-checkingowa TVN24 (status IFCN do potwierdzenia)", access: "google_factcheck", access_note: VIA_GFC, terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "reuters", name: "Reuters Fact Check", domains: ["reuters.com"], kind: "news_agency", tier: "factcheck", country: "INT", credentials: "IFCN (dział Reuters Fact Check)", access: "google_factcheck", access_note: `${VIA_GFC} Strona zabrania automatycznego pobierania bez zgody (robots.txt); Reuters Connect API jest płatne.`, terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "ap", name: "AP Fact Check (Associated Press)", domains: ["apnews.com"], kind: "news_agency", tier: "factcheck", country: "INT", credentials: "IFCN (dział AP Fact Check)", access: "google_factcheck", access_note: `${VIA_GFC} Strona blokuje boty AI i ma ochronę antybotową; AP Media API jest płatne.`, terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "full_fact", name: "Full Fact", domains: ["fullfact.org"], kind: "fact_checker", tier: "factcheck", country: "GB", credentials: "IFCN", access: "google_factcheck", access_note: VIA_GFC, terms: "cytat z podaniem źródła" },
  { id: "factcheck_org", name: "FactCheck.org", domains: ["factcheck.org"], kind: "fact_checker", tier: "factcheck", country: "US", credentials: "IFCN", access: "google_factcheck", access_note: VIA_GFC, terms: "cytat z podaniem źródła" },
  { id: "politifact", name: "PolitiFact", domains: ["politifact.com"], kind: "fact_checker", tier: "factcheck", country: "US", credentials: "IFCN", access: "google_factcheck", access_note: VIA_GFC, terms: "cytat z podaniem źródła" },
  { id: "usa_today", name: "USA Today Fact Check", domains: ["usatoday.com"], kind: "fact_checker", tier: "factcheck", country: "US", credentials: "IFCN", access: "google_factcheck", access_note: VIA_GFC, terms: "cytat z podaniem źródła" },
  { id: "factcheckni", name: "FactCheckNI", domains: ["factcheckni.org"], kind: "fact_checker", tier: "factcheck", country: "GB", credentials: "IFCN", access: "google_factcheck", access_note: VIA_GFC, terms: "cytat z podaniem źródła" },
  { id: "lead_stories", name: "Lead Stories", domains: ["leadstories.com"], kind: "fact_checker", tier: "factcheck", country: "US", credentials: "IFCN", access: "google_factcheck", access_note: VIA_GFC, terms: "cytat z podaniem źródła" },

  // ── Trusted newsrooms without fact-checker certification: count as "media" ──
  { id: "pap", name: "Polska Agencja Prasowa (PAP)", domains: ["pap.pl"], kind: "news_agency", tier: "media", country: "PL", credentials: "państwowa agencja informacyjna; współtwórca Sprawdzam To", access: "google_factcheck", access_note: "Tylko jeśli publikuje ClaimReview (do sprawdzenia). Strona blokuje boty AI (robots.txt) i ma ochronę antybotową; serwis PAP dla klientów wymaga umowy.", terms: "wszelkie prawa zastrzeżone; cytat z podaniem źródła" },
  { id: "sprawdzam_to", name: "Sprawdzam To (TVP, PAP, Polskie Radio)", domains: ["sprawdzamto.pl"], kind: "public_media", tier: "media", country: "PL", credentials: "wspólny serwis fact-checkingowy mediów publicznych (od maja 2026); bez certyfikatu IFCN/EFCSN", access: "not_connected", access_note: "Brak API i oznaczeń ClaimReview. Regulamin (§6) zakazuje automatycznego pobierania bez zgody, więc czekamy na zgodę redakcji; do tego czasu artykuły można dodać ręcznie do korpusu.", terms: "regulamin §7: cytat, przedruk i streszczenie dozwolone z podaniem źródła „sprawdzamto.pl” i aktywnym linkiem" },
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The catalog entry a URL belongs to, or null when the publisher is not on the allowlist. */
export function trustedSourceFor(url: string, catalog: TrustedSource[] = TRUSTED_SOURCES): TrustedSource | null {
  const host = hostOf(url);
  if (!host) return null;
  return catalog.find((s) => s.domains.some((d) => host === d || host.endsWith(`.${d}`))) ?? null;
}

/** Public view for GET /api/v1/sources (open source catalog). */
export function publicCatalog(catalog: TrustedSource[] = TRUSTED_SOURCES) {
  return catalog.map(({ id, name, domains, kind, tier, country, credentials, access, access_note, terms }) => ({
    id, name, domains, kind, tier, country, credentials, access, access_note, terms,
  }));
}
