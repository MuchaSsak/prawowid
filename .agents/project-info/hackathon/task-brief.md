# PRAWDOWID: the task brief
Our challenge at HackNation 2026, set by MSZ (the Ministry of Foreign Affairs): what we must build and what is required. (source: sources/2026-11-21-msz-pelna-tresc-zadania.pdf)

## One-liner
"Szybka i łatwa weryfikacja informacji oparta na wiarygodnych źródłach": a simple, multichannel tool that lets a citizen check a claim as easily as sending a message. It uses trusted sources, shows the basis for each answer, and honestly abstains when the evidence is insufficient.

## Context (sec. 1)
- MSZ counters FIMI (Foreign Information Manipulation and Interference) and informs citizens about the international situation.
- **Primary user: the citizen**, including people with low digital skills. They shouldn't need to learn verification methods or install software.
- The input may be text, a link, a screenshot, a photo, a recording or a multi-part question. Content may be true but outdated, built from correct data that leads to a wrong conclusion, or still lacking evidence.
- The LLM is used to understand the question, search and compare materials, and write the answer. **It is not the source of truth.** Every key finding must lead to a concrete source. Preferred sources: official documents, public data, and fact-checker corpora.
- Polish first, extensible to other languages and topics. Reference standards: IFCN, EFCSN, EDMO, NASK practice. Must respect privacy, copyright, infosec and AI transparency.
- The system supports the user's own judgment and encourages them to read the evidence. It is **not an automatic "judge of truth"** (sec. 9).

## Core behaviour (sec. 2)
- Accept at least text or a URL. Detect check-worthy claims, search a described source set, assess recency and relevance, and return a concise result with a justification.
- **Verdict per claim, exactly one of:** `potwierdzone` (confirmed) · `fałszywe` (false) · `wprowadzające w błąd` (misleading) · `brak wystarczających dowodów` (insufficient evidence) · `nie podlega weryfikacji` (not verifiable).
- **Not verdicts, and communicated separately:** technical failure, inability to perform the check, the need to clarify the question, and out-of-scope requests.
- Separate the source material from the model's interpretation. Cite at least the **title, publisher, date and link**, plus the excerpt used where possible.
- Verdict strength comes from explicit factors: source quality and recency, how well the material matches the claim, and the number of independent confirmations.
- When evidence is insufficient: abstain and explain what couldn't be established. **High-risk or repeated unanswered questions notify a designated user** (moderator or analyst, set by the admin).
- Instructions found in analysed materials must never change the system's behaviour. The system must resist prompt injection.

## MVP: mandatory (sec. 3)
- [ ] Text or URL input via a **responsive web UI** + **at least one more channel or demo adapter** (SMS, WhatsApp, Messenger, Instagram, Discord or an equivalent; **not Telegram, WeChat or niche platforms**)
- [ ] Detect one or more check-worthy claims
- [ ] Search a clearly described set with **at least 2 source types**, and show the materials used
- [ ] Verdict + short justification + strength-of-evidence rating + clear limitations
- [ ] The answer is in **Polish, in plain language**
- [ ] A log of every check: question, time, sources used, verdict
- [ ] Abstain when evidence is lacking, without a fake answer
- [ ] A **full end-to-end path with no manual intervention**, from intake to answer to log

## Bonus features (scored only if the MVP passes)
- Image/audio verification: OCR, transcription, metadata, image comparison, earlier occurrences
- Source comparison and an **evidence chain** from claim to supporting, refuting or context materials
- Multilingual retrieval with Polish answers
- An open or swappable **source catalog** with rules for qualifying, updating and excluding sources
- Pluggable channels, models and sources with no rebuild
- Matching content, URLs or images to a **known-incidents catalog or verified corpus**. A domain or channel appearing in the catalog is never the basis for a verdict, but may trigger a warning in explicitly defined cases.
- Export (CSV, JSON), plus OpenCTI and DISARM integration
- Controlled archiving of user-indicated material (legal basis, ToS, retention, data minimization)
- Less dependence on non-EEA vendors, auditability or self-hosting, and transparency about where data is processed
- **Closed loop:** create moderator cases for unresolved reports, and group similar reports

## Technical requirements (sec. 5)
| Area | Requirement |
|---|---|
| Architecture | Our choice, but **channel handling is separate from verification logic**, and the model or provider is swappable without a rebuild |
| Facts | Every factual finding leads to evidence. When it doesn't, abstain and explain. Failure, unclear question and out-of-scope are each reported separately |
| Sources | Demo corpus of **at least 100 docs or records, 10+ domains, 2+ source types** (primary/official + credible secondary, unless justified). The source list must be auditable |
| Recency | Store the **publication and retrieval timestamps**. Prefer current data and warn about archival material |
| Security | Input validation, system instructions separated from source content, tool limits, secret protection, rate limiting, event logging |
| Privacy | Data minimization, **automatic masking of obvious PII**, a defined retention period, and the ability to delete a demo session |
| Observability | Log response time, model usage, retrieval errors, abstentions, and **estimated cost per answer** |
| Accessibility | Responsive UI, readable contrast, and language a non-technical person understands |
| Channels | Web and the second channel use **the same verification logic**. Same query, sources and conditions give a consistent result |
| Moderator loop | If built, an unresolved report can create a moderator case. **"Escalation recommended" must be distinguished from "escalated"** |
| External deps | Describe the keys, limits, costs, data location and failure behaviour. **A missing key, a hit limit or an outage is never shown as a verdict** |
| Multimodal | Optional. If an external image or audio API is used, disclose its cost, scope, retention and limits |

Any lawful technology is allowed. Justify the main choices, costs, vendor dependencies and the migration path. **Using a technology (e.g. a vector DB) scores nothing by itself; quality is what counts.** No accounts or keys are provided, so a demo adapter is acceptable where justified, but processing from message intake to reply must be automatic. For reverse image search: Google Vision Web Detection, TinEye or a local perceptual-hash index. Disclose the limits.

Prohibitions: see [rules/hard-constraints.md](../rules/hard-constraints.md).

## Deployment assumptions
- A 24h MVP that the **jury can run from our instructions**. The demo works end-to-end with no help from us.
- Estimate the **cost of 1,000 queries**, the cost of maintaining the channel, and behaviour under load. Free for the user on the service side. Operator fees (e.g. SMS) must be stated.

## After the hackathon (sec. 9)
The winner may be invited to a short **MSZ pilot**: a narrow, low-risk domain in decision-support mode, where a human approves any answer that gets published. Path: reproduce results and review licenses, security and architecture → a 4-6 week pilot on a closed corpus with an expert queue → red-teaming, data protection, accessibility and user consultations → a limited public rollout with quality monitoring, a corrections procedure and a reporting channel → new channels, languages and sources only after regression validation. **Showing that we have thought through this path is part of "deployment potential".**

See also: [judging-and-metrics.md](judging-and-metrics.md), [deliverables.md](deliverables.md), [resources.md](resources.md).
