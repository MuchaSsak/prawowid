export * from "./types.ts";
export { type Config, DEFAULT_MODELS, type Env, LIMITS, loadConfig } from "./config.ts";
export { type CoreDeps, runCheck } from "./pipeline/check.ts";
export { isPrivateIp, type ResolveHost } from "./intake/url.ts";
export { isMediaType, MEDIA_MIME, mediaInputError, type MediaType } from "./intake/media.ts";
export { MemoryCheckStore, MemoryCorpusStore } from "./store/memory.ts";
export { IndexedCorpusStore, type RecordFilter } from "./store/indexed-corpus.ts";
export { AUDIT_EVENT, type AuditLine, auditLine, LoggingCheckStore } from "./store/logging.ts";
export type { CheckLogRow, CheckStore, CorpusStore } from "./store/types.ts";
export { CONNECTORS } from "./connectors/mod.ts";
// Everything a new evidence route or known-incident matcher needs (architecture/extensibility.md).
export type { ClaimQuery, Connector, ConnectorContext, SourceRecord } from "./connectors/types.ts";
export { ConnectorError, fetchJson, fetchText } from "./connectors/types.ts";
export type { NarrativeContext, NarrativeMatcher } from "./narratives/types.ts";
export {
  articleToIncident,
  caseToIncident,
  findContextMatches,
  type KnownIncident,
  type KnownIncidentStore,
  listArticles,
  listCases,
  MemoryKnownIncidentStore,
  NARRATIVE_MATCHERS,
  searchEuvsdisinfo,
} from "./narratives/mod.ts";
export { CheckRequestSchema, CheckResponseSchema, contractJsonSchema } from "./contract.ts";
export { MOCK_SCENARIO_DESCRIPTIONS, MOCK_SCENARIOS, type MockScenario, mockResponse, pickScenario } from "./mock/fixtures.ts";
export { publicCatalog, type TrustedSource, TRUSTED_SOURCES, trustedSourceFor } from "./sources/catalog.ts";
export * from "./sources/controls.ts";
export * from "./analytics/mod.ts";
export { INDICATORS } from "./connectors/stats-catalog.ts";
