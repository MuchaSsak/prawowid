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

export const sejmEli: Connector = {
  id: "sejm_eli",
  label: "Sejm ELI (akty prawne)",
  required: true,
  appliesTo: (c) => c.type === "legal",
  unavailableReason: () => null,

  async search(claim, ctx) {
    const queries = claim.search_queries_pl.slice(0, 3);
    const settled = await Promise.allSettled(
      queries.map((q) => {
        const u = new URL("https://api.sejm.gov.pl/eli/acts/search");
        u.searchParams.set("title", q);
        u.searchParams.set("limit", "5");
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
    for (const { value } of ok) {
      for (const a of value.items ?? []) {
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
