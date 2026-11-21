# 003: Settings are defaults in code; `.env` holds only secrets
Date: 2026-11-21 · Status: decided

Context: `.env.example` listed about 30 variables (models, routing, limits, URLs, retention). The user wants `.env` to hold only what is secret or truly per-deployment, with no required trivial values.

Decision:
- `.env` holds secrets only. For now that is `OPENROUTER_API_KEY` and `EUVSDISINFO_TOKEN`. Add more when a feature needs a new secret (e.g. Supabase, Discord, Google Fact Check).
- Everything else (model IDs per step, OpenRouter provider routing, limits, retention, fetch user agent, base URLs) lives in one config module in code, with sensible defaults.
- Model IDs can still be overridden with optional `MODEL_<STEP>` env vars that the config module reads if set. This keeps hard constraint 19 ("model swappable through configuration, with no rebuild") without making those vars required.
- Provider routing is set per pipeline step in code, not globally: `mistral/eu` pinning only on Mistral text steps, so video (Gemini), embeddings (bge-m3) and the fallback model are not blocked.

Rejected:
- Every setting as an env var: too many required trivial values, and harder for the jury to run from the README (constraint 20).
- Models hardcoded with no override: breaks constraint 19.

Affects: [.env.example](../../../.env.example), [architecture/model-selection.md](../architecture/model-selection.md)
