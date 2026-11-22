# Stack direction (from the team)
What the team has said about technologies. **Decided so far:** the first build (Bun/Turbo monorepo, Deno + Hono API, runtime-agnostic core, Astro web app, mock DB) in [decision 004](../decisions/004-first-build-stack.md), and the Supabase workflow in [decision 005](../decisions/005-supabase-schema-workflow.md). The rest below is still direction, not decision. What is built: [codebase.md](codebase.md).

- **Repo:** a Turborepo monorepo holding everything about the project (apps + packages). (user, 2026-11-21)
- **API:** **Deno Deploy** hosts the API that accepts the user's text, URL or image input. (user, 2026-11-21: "our deno deploy api")
  - **Caution:** Deno Deploy will be **sunset in April 2027** (Deno joining Cloudflare), verified on docs.deno.com 2026-11-21. Keep `packages/core` runtime-agnostic, and name the migration path (Supabase Edge Functions / Cloudflare Workers / a container on an EU VPS).
- **LLM gateway:** very likely **OpenRouter**. A Claude model via OpenRouter is one option. (user, 2026-11-21)
- **Retrieval store:** local in-memory BM25 snapshot for the MVP (`IndexedCorpusStore`); a vector store is proposed only if eval shows BM25 is a narrow bottleneck.
- "jev": most likely **TypeSafe Jev** (a typed-decision model listed on OpenRouter as `typesafe/jev-router`, early access). **Assumption**: the team should confirm.

Research supporting these choices: [stack-research.md](stack-research.md), [technical-approach-research.md](technical-approach-research.md), [data-sources-research.md](data-sources-research.md).

## Our recommendations (Idea, 2026-11-21)
**Retrieval: yes to Supabase, but hybrid (keyword + vector), kept small.**
- Why vectors: the jury types its own wording. Polish inflection, paraphrase, and English or Russian EUvsDisinfo cases all defeat pure keyword search. Multilingual embeddings (bge-m3) match "Polska wysyła żołnierzy na Ukrainę" to an English EUvsDisinfo case. Keyword search (FTS + pg_trgm) still catches exact names and numbers, and RRF merges the two.
- Why Supabase: one EU (Frankfurt) Postgres for **everything**: the corpus + vectors, the source catalog, check logs, injection events and moderator cases. Free tier, SQL is auditable, and the code is portable to any Postgres (migration story).
- The brief scores quality, not technology ("using a vector DB scores nothing by itself"), so justify it with eval numbers.

**Cost: target ≤ $1-2 per 1,000 checks.**
1. A cheap model for every LLM step (Claude Haiku 5.5, Mistral Small or Gemini Flash-Lite via OpenRouter). The verdict is computed in code, so the LLM only does classification + stance + quoting, which small models handle well.
2. Exactly 2 LLM calls per check: (a) claims + types + search queries in one call, (b) stance + quotes for **all** claims × top passages in one call. The Polish answer is assembled from a template + short model text, with no third call.
3. Short context: the top 5 passages of about 150 words each, not whole documents.
4. Cache results by normalized input + embedding similarity. This also gives identical answers across channels (scenario G).
5. Embeddings via bge-m3 cost about $0.01 per 1M tokens (effectively free). Live official APIs are free.
6. Upgrade the verdict model **only if the eval shows macro-F1 < 0.75**, and only for low-confidence cases.
- Rough math: about 6k input + 0.8k output tokens per check on a $0.10/$0.50 model ≈ **$0.001 per check ≈ $1 per 1,000**. Re-check live prices on OpenRouter. Cost is also a scored metric ("cheaper wins when quality is equal").
