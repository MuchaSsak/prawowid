/**
 * Sejm ELI API: Polish legal acts (title, status, dates). Keyless, verified 2026-11-21.
 * The passage is a labelled data record built from API fields only.
 */
import { LIMITS } from "../config.ts";
import { type Connector, ConnectorError, fetchJson, type SourceRecord } from "./types.ts";

interface EliAct {
  address: string;
  displayAddress?: string;
  title?: string;
  type?: string;
  status?: string;
  announcementDate?: string;
  promulgation?: string;
  entryIntoForce?: string;
  inForce?: string;
  year?: number;
  pos?: number;
  publisher?: string;
}

const IN_FORCE: Record<string, string> = {
  IN_FORCE: "tak",
  NOT_IN_FORCE: "nie",
  UNKNOWN: "nieznane",
};

const STOP = new Set([
  "ustawa", "ustawy", "ustawę", "ustawie", "ustawą", "akt", "aktu", "z", "dnia", "roku", "rok", "r", "w", "od", "do",
  "weszła", "wchodzi", "życie", "obowiązuje", "obowiązywała", "została", "zostało", "został", "uchwalona", "uchwalono",
  "uchwalenie", "przyjęta", "przyjęto", "pochodzi", "nadal", "data", "wejście", "wejścia", "obecna", "nowa", "stara",
]);

/**
 * ELI's `title` search is a literal substring match: inflected forms ("Konstytucji"), the word
 * "ustawa" or a year in the query return nothing. Build literal title fragments in code:
 * named acts from the claim, then "o …" subject phrases, then the model's queries without noise.
 */
export function titleCandidates(claimText: string, queries: string[]): string[] {
  const out: string[] = [];
  const add = (s: string | undefined) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    if (t.length >= 4 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  const text = `${claimText} ${queries.join(" ")}`;
  if (/konstytucj/i.test(text)) add("Konstytucja Rzeczypospolitej Polskiej");
  for (const m of text.matchAll(/\bkodeks\w*\s+(\p{L}+(?:\s+(?:karnego|karny|cywilnego|cywilny|wykonawczego|wykonawczy|postępowania|morski|wyborczy|rodzinny|pracy|drogowy|spółek|handlowych|celny|wodny|morski|skarbowy|administracyjnego)){0,2})/giu)) {
    add(`Kodeks ${m[1]}`);
  }
  for (const m of text.matchAll(/\b(?:ustaw\p{L}*|akt\p{L}*)\s+(?:z\s+dnia\s+[\p{L}\d\s.]+?\s+)?o\s+((?:\p{Ll}+\s*){1,8})/giu)) {
    const words: string[] = [];
    for (const w of m[1].trim().split(/\s+/)) {
      if (STOP.has(w.toLowerCase()) || /\d/.test(w)) break;
      words.push(w);
    }
    while (words.length && ["i", "oraz", "w", "z"].includes(words[words.length - 1])) words.pop();
    if (words.length) {
      add(words.join(" "));
      if (words.length > 2) add(words.slice(0, 2).join(" "));
    }
  }
  for (const q of queries) {
    add(q.split(/\s+/).filter((w) => !STOP.has(w.toLowerCase().replace(/\.$/, "")) && !/\d/.test(w)).join(" ").replace(/^o\s+/i, ""));
  }
  return out;
}

/** A claim that names a legal act is checked in ELI whatever type extraction gave it ("uchwalona" reads as an event). */
const NAMES_ACT = /\b(konstytucj\p{L}*|kodeks\p{L}*|ustaw(?:a|y|ę|ie|ą|ach|om)|rozporządzeni\p{L}*|dz\.\s?u\.)(?=\P{L}|$)/iu;

export const sejmEli: Connector = {
  id: "sejm_eli",
  label: "Sejm ELI (akty prawne)",
  required: true,
  appliesTo: (c) => c.type === "legal" || NAMES_ACT.test(c.text),
  unavailableReason: () => null,

  async search(claim, ctx) {
    const candidates = titleCandidates(claim.text, claim.search_queries_pl);
    // Amending acts are the evidence for a change, and against a claim that nothing changed.
    const aboutAmendment = /noweliz|zmian|zmieni|wyłącznie|nadal obowiązuj|bez zmian|niezmien/i.test(claim.text);
    // ELI returns the newest 50 matches, so an old base act (a code from 1974) is crowded out by its
    // amendments. The year the claim names narrows the search; the unfiltered search still runs, so a
    // wrong year in the claim cannot hide the real act.
    const year = Number(/^(\d{4})/.exec(claim.time ?? "")?.[1]);
    const withYear = year >= 1918 && year <= new Date().getUTCFullYear();
    const queries: { title: string; year?: number }[] = withYear
      ? [...candidates.slice(0, 2).map((title) => ({ title, year })), ...candidates.slice(0, 2).map((title) => ({ title }))]
      : candidates.slice(0, 3).map((title) => ({ title }));
    const settled = await Promise.allSettled(
      queries.map((q) => {
        const u = new URL("https://api.sejm.gov.pl/eli/acts/search");
        u.searchParams.set("title", q.title);
        if (q.year) u.searchParams.set("year", String(q.year));
        u.searchParams.set("limit", "50");
        return fetchJson(u.toString(), ctx.signal, LIMITS.connectorTimeoutMs) as Promise<{ items?: EliAct[] }>;
      }),
    );
    const ok = settled.filter((s): s is PromiseFulfilledResult<{ items?: EliAct[] }> => s.status === "fulfilled");
    if (ok.length === 0 && settled.length > 0) {
      const r = (settled[0] as PromiseRejectedResult).reason;
      throw r instanceof ConnectorError ? r : new ConnectorError("error", String(r));
    }
    const retrieved = new Date().toISOString();
    const seen = new Set<string>();
    const out: SourceRecord[] = [];
    // Base acts first (the act the claim is about); amending acts only if the claim is about a change;
    // announcements (tekst jednolity), corrections and regulations are not the act itself.
    let items = ok.flatMap(({ value }) => value.items ?? []);
    // A named act (Konstytucja, Kodeks …) found by its own title beats acts found by looser fragments.
    const named = candidates[0] && /^(Konstytucja|Kodeks)\b/.test(candidates[0]) ? candidates[0].toLowerCase() : null;
    if (named && items.some((a) => (a.title ?? "").toLowerCase().includes(named))) {
      items = items.filter((a) => (a.title ?? "").toLowerCase().includes(named));
    }
    const rank = (a: EliAct) => {
      const t = a.title ?? "";
      if (/Obwieszczenie|sprostowani|Rozporządzenie|Uchwała|Postanowienie|Wyrok/i.test(t)) return 9;
      if (/o zmianie|wprowadzające/i.test(t)) return aboutAmendment ? 1 : 5;
      return 0;
    };
    const picked = items
      .map((a, i) => ({ a, r: rank(a), i }))
      .filter((x) => x.r < 9 && (x.r < 5 || aboutAmendment))
      .sort((x, y) => x.r - y.r || x.i - y.i)
      .slice(0, 5)
      .map((x) => x.a);
    for (const a of picked) {
      {
        if (!a.address || seen.has(a.address)) continue;
        seen.add(a.address);
        // Amending acts ("o zmianie ustawy …") are different acts from the one they amend; say so
        // in the record, otherwise their dates get read as dates of the amended act.
        const amends = /\bo zmianie\b/i.test(a.title ?? "");
        const text = [
          `Akt: ${a.title ?? ""}`,
          amends
            ? "Uwaga: to jest akt zmieniający inną ustawę. Jego daty dotyczą tylko tej nowelizacji, nie ustawy zmienianej."
            : "",
          `Rodzaj: ${a.type ?? "nieznany"}. Publikacja: ${a.displayAddress ?? a.address}.`,
          `Status: ${a.status ?? "nieznany"}. Obowiązuje: ${IN_FORCE[a.inForce ?? "UNKNOWN"] ?? a.inForce}.`,
          a.announcementDate ? `Data aktu: ${a.announcementDate}.` : "",
          a.promulgation ? `Data ogłoszenia: ${a.promulgation}.` : "",
          a.entryIntoForce ? `Data wejścia w życie: ${a.entryIntoForce}.` : "",
        ].filter(Boolean).join("\n");
        out.push({
          source_id: `eli:${a.address}`,
          route: "sejm_eli",
          title: a.title ?? a.displayAddress ?? a.address,
          publisher: "Sejm RP (ELI)",
          url: `https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=${encodeURIComponent(a.address)}`,
          published_at: a.promulgation ?? a.announcementDate ?? null,
          retrieved_at: retrieved,
          tier: "official",
          origin_key: `eli:${a.address}`,
          text,
        });
      }
    }
    return out;
  },
};
