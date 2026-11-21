/**
 * Initial registry contents, built from today's allowlist (sources/catalog.ts) and deployment profile
 * (connectors/mod.ts). Used only when no registry exists yet; a configured deployment never falls back
 * to it (architecture/source-platform.md).
 */
import { TRUSTED_SOURCES } from "../sources/catalog.ts";
import type { AggregatorLink, Binding, Publisher, RegistryContent } from "./types.ts";

/** Builtin binding ids equal today's connector ids, so route ids and citations stay the same. */
const LIVE = {
  aggregator: false,
  adapter: "builtin",
  mode: "live",
  doc_kind: "dated_statement",
  freshness_days: null,
  active: true,
} as const;

export function seedRegistry(): RegistryContent {
  const publishers: Publisher[] = TRUSTED_SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    tier: s.tier,
    role: "evidence",
    country: s.country,
    scopes: s.domains.map((host) => ({ host })),
    credentials: s.credentials,
    terms: s.terms,
    active: true,
  }));
  const bindings: Binding[] = [
    {
      ...LIVE,
      id: "google_factcheck",
      label: "Google Fact Check Tools",
      publisher_id: null,
      aggregator: true,
      config: { connector: "google_factcheck" },
      allowed_hosts: ["factchecktools.googleapis.com"],
      credential_env: "GOOGLE_FACT_CHECK_API_KEY",
      required: true,
      capabilities: ["fact_check"],
    },
    {
      ...LIVE,
      id: "sejm_eli",
      label: "Sejm RP: akty prawne (ELI)",
      publisher_id: "sejm_eli",
      config: { connector: "sejm_eli" },
      allowed_hosts: ["api.sejm.gov.pl"],
      credential_env: null,
      required: true,
      capabilities: ["legal"],
    },
    {
      ...LIVE,
      id: "eurostat",
      label: "Eurostat",
      publisher_id: "eurostat",
      config: { connector: "eurostat" },
      allowed_hosts: ["ec.europa.eu"],
      credential_env: null,
      required: true,
      capabilities: ["statistics"],
    },
    {
      ...LIVE,
      id: "nbp",
      label: "NBP: kursy, złoto, stopy",
      publisher_id: "nbp",
      config: { connector: "nbp" },
      allowed_hosts: ["api.nbp.pl", "static.nbp.pl"],
      credential_env: null,
      required: true,
      capabilities: ["exchange_rate"],
    },
    {
      ...LIVE,
      id: "gus_bdl",
      label: "GUS: Bank Danych Lokalnych",
      publisher_id: "gus",
      config: { connector: "gus_bdl" },
      allowed_hosts: ["bdl.stat.gov.pl"],
      credential_env: null,
      required: false,
      capabilities: ["population"],
    },
    {
      id: "policja_upload",
      label: "Policja.pl: dokumenty w korpusie",
      publisher_id: "policja",
      aggregator: false,
      adapter: "upload",
      mode: "corpus",
      config: {},
      allowed_hosts: [],
      credential_env: null,
      required: false,
      capabilities: ["documents"],
      doc_kind: "dated_statement",
      freshness_days: null,
      active: true,
    },
  ];
  const links: AggregatorLink[] = TRUSTED_SOURCES.filter((s) => s.access === "google_factcheck")
    .map((s) => ({ binding_id: "google_factcheck", publisher_id: s.id, active: true }));
  return { publishers, bindings, links };
}
