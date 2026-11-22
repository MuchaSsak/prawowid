# 008: Evidence only from an allowlist of trusted publishers, tiered by credentials
Date: 2026-11-21 · Status: decided (user asked for the list; tiers and origin rule are the agent's, revisit with the eval)

Context: the user said we won't search the open web: only sources on an allowed list count, and AP, Reuters, PAP and sprawdzamto.pl should be added, using their APIs where they exist. Until now the Google Fact Check route accepted any publisher in Google's index (Snopes, blogs). Research of the four sources: [data-sources-research.md](../architecture/data-sources-research.md#trusted-source-catalog-allowlist-2026-11-21).

Decision:
- **One allowlist in code**, `packages/core/src/sources/catalog.ts`, part of the deployment profile (`Config.trustedSources`). A record whose URL host is not on it (exact domain or subdomain) is dropped before the model sees it. The list is public at `GET /api/v1/sources`, with credentials, access route and terms for each source.
- **Tier comes from credentials, not from the route:** public authorities and official statistics → `official`; IFCN/EFCSN-certified fact-checkers and certified fact-check units of agencies (AP Fact Check, Reuters Fact Check) → `factcheck`; trusted newsrooms without certification (PAP, Sprawdzam To) → `media`, which needs a second independent origin.
- **One publisher is one origin** (`origin_key = publisher:<id>`): two articles by the same newsroom never count as independent confirmation.
- **No bypassing**: AP, Reuters and PAP block AI agents and automated collection, and sprawdzamto.pl's terms forbid scraping without consent. We reach AP and Reuters only through their ClaimReview in Google Fact Check, PAP only if it publishes ClaimReview, and Sprawdzam To not at all until its editors consent (then corpus ingestion with attribution and link, as its terms §7 allow). Paid APIs (AP Media API, Reuters Connect, PAP services) need a contract MSZ may already have.

Rejected: trusting any Google Fact Check publisher (no control over who decides a verdict); scraping the four sites with a browser-like user agent (violates robots/terms and the task's no-bypass rule); giving PAP or Sprawdzam To the `factcheck` tier (no IFCN/EFCSN certification found).

Affects: [architecture/codebase.md](../architecture/codebase.md), [architecture/api-reference.md](../architecture/api-reference.md), [architecture/verification-pipeline.md](../architecture/verification-pipeline.md) (source eligibility), [open-questions.md](../open-questions.md).

Update 2026-11-22: an operator can switch a publisher, a corpus collection or a whole route off at runtime ([decision 013](013-source-controls.md)); the allowlist in code stays the upper bound.
