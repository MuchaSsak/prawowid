# 002: Images go through the vision model, and each step uses one LLM pass
Date: 2026-11-21 · Status: decided (user)

Context: PR #1 (Fabian, merged 2026-11-21) changed two things in the [verification pipeline](../architecture/verification-pipeline.md): image OCR was moved to a local OCR engine, and a second, independent verifier model was added to re-check every stance the assessment model proposed.

Decision:
- **OCR stays as planned before PR #1:** one vision-model call per image through OpenRouter (mistral-small-2603 on the EU path), using the [media-extraction prompt](../prompts/media-extraction.md). It returns OCR text, a short description and visible dates. No local OCR engine.
- **PII redaction stays:** the OCR text, like every other input, is masked locally (rules + local recognizer) before the next model call, search or storage. The raw image is not stored.
- **No second verifier model.** Running two models for the same job adds waiting time and cost. One assessment call per claim; code then checks the quote is verbatim in the stored source and compares the structured scope fields (time, place, unit, attribution).

Rejected: local OCR (weaker on screenshots, slow on serverless CPU, and not what the team planned); a separate verifier model (doubles assessment latency and spend).

Affects: [architecture/verification-pipeline.md](../architecture/verification-pipeline.md) (sections 1 and 4, release cases F and quote integrity), [architecture/multimodal-media.md](../architecture/multimodal-media.md), [architecture/model-selection.md](../architecture/model-selection.md), [architecture/stack-research.md](../architecture/stack-research.md), [architecture/technical-approach-research.md](../architecture/technical-approach-research.md), [architecture/api-endpoints-verified.md](../architecture/api-endpoints-verified.md).
