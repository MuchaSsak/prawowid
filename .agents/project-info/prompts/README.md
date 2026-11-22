# Prompts
The system prompts our pipeline sends to models, plus the rules for writing and changing them. **Idea / draft v1 (2026-11-21)**: no prompt here has been run against an eval yet. Pipeline: [architecture/verification-pipeline.md](../architecture/verification-pipeline.md). Output shape users see: [product/response-contract.md](../product/response-contract.md).

| File | Step | Model (default) | Output |
|---|---|---|---|
| [claim-extraction.md](claim-extraction.md) | LLM call #1: split the input into claims, classify, route | mistral-small (EU) | JSON: claims[] |
| [evidence-assessment.md](evidence-assessment.md) | LLM call #2: stance + exact quote per passage, proposed verdict, explanation | mistral-small → large if F1 < 0.75 | JSON: assessments[] |
| [media-extraction.md](media-extraction.md) | Before call #1: image → OCR + description; video/audio → transcript | mistral-small (images), Gemini Flash-Lite (video), Voxtral (audio) | JSON: text + provenance |

There is **no third call** for the final answer. The answer is assembled in code from templates + the `explanation` field of call #2 (cost and consistency).

## How prompts are used in code
- Files live in `packages/core/src/prompts/` as `<id>.v<N>.ts` (a function returning the prompt text; `.ts` so every runtime can import it). Every check logs `prompt_id@version` + model, so a result is reproducible.
- **Structure of every system prompt:** role (1-2 lines) → data boundary → task → rules → output. Nothing else.
- **Spotlighting:** user input and fetched content go only in the user message, as JSON (`{"user_message": …, "material": [{"provenance": "article", "text": …}]}`). Never interpolate them into the system prompt.
- **Structured outputs:** JSON schema (`response_format: json_schema, strict`) + validation in code (zod). Invalid output → retry once → system state `technical_error` (never a guessed verdict).
- `temperature: 0`. Same input + same sources ⇒ same output (channel consistency, scenario G), plus a cache keyed by the normalized input.
- `{{answer_language}}` is filled by code ([language policy](../product/response-contract.md#language-policy)). Instructions stay in English; models follow them more reliably, and the user-facing strings come out in the requested language.
- The model reading untrusted content **has no tools** and no URLs to fetch. It can only return JSON.

## Patterns (do)
- Tell the model **what it is for** in one line, then what to do. Rules with a reason ("…because code rejects quotes it can't find") are followed better than bare commands.
- **Model proposes, code disposes:** the model labels; the code checks quotes verbatim, applies verdict rules and builds citations from the DB.
- Ask for **verbatim spans** (`source_span`, `quote`) so code can verify that every claim and quote exists in the input.
- Common sense first: tell the model to read like a sensible editor (skip hyperbole, jokes, rhetoric) and to be **fair, not suspicious**.
- Keep each prompt short. Every rule must fix a failure we've seen or a requirement from the brief. When an eval shows a rule changes nothing, delete it.

## Anti-patterns (don't)
- **Test cases or jury examples in prompts** (forbidden by the brief, rule 16). Any few-shot example must be synthetic, and none should mirror the reference set.
- Asking the model for URLs, titles or dates of sources (it will invent them). Citations come from the DB by `source_id`.
- Letting the model's general knowledge act as evidence ("as is widely known…"). Only passages count.
- Wordy persona prompts, motivational filler, ALL-CAPS threats, long lists of rare edge cases. They cost tokens and blur what matters.
- Asking for a verdict and the evidence in one free-text answer. Separate fields, separate checks.
- Over-skepticism instructions ("doubt everything"). They push the model toward abstaining on everything, which kills macro-F1 as surely as hallucination does.

## Changing a prompt
1. Edit the file here (the draft) and in `packages/core/src/prompts/` (bump the version).
2. Rerun the eval set (our own ≥30 cases, scenarios A-J). Record macro-F1, citation correctness, abstention and injection resistance in the change log below.
3. Keep the change only if the metrics don't drop.

## Change log
- code v6 / v6 (2026-11-22): claim extraction stops asking about details a named-subject claim does not state, asks only open questions, reads a joined clarification reply as one input; claim spans match case-insensitively; evidence assessment treats another claim about the same person as irrelevant. Full run: macro-F1 0.71 (= run 3), abstention 89%, robustness 100%, $0.189 per 100; the misleading class and K05 fail the same way on v5 (checked on 8 cases). See [evaluation/benchmark.md](../evaluation/benchmark.md).
- code v1, eval round 1 (2026-11-21): extraction lists opinions always and treats causal / "secretly contains" claims as facts; assessment treats official record fields as statements and older passages as context for later-period claims. General rules only, no case wording. Measured in [evaluation/benchmark.md](../evaluation/benchmark.md).
- code v1 (2026-11-21): first code versions in `packages/core/src/prompts/`. Claim extraction splits queries into `search_queries_pl` + `search_query_en`; evidence assessment gained the "different subject is never misleading", "year-only claims" and "a title alone supports nothing" rules after smoke runs. Not evaluated.
- v1 (2026-11-21): first drafts. Not evaluated.
