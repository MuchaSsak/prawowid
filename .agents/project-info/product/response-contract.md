# Response contract: what the user gets back
The response types (verdicts, system states, warnings, escalation), the answer language and tone, and the JSON shape every channel renders. **Contract v1 is decided and frozen ([decision 006](../decisions/006-api-contract-v1-and-mock.md)); it is implemented in `packages/core/src/types.ts` + `contract.ts`.** Endpoints, headers and mock mode: [architecture/api-reference.md](../architecture/api-reference.md). Verdict logic: [architecture/verification-pipeline.md](../architecture/verification-pipeline.md). Prompts: [prompts/](../prompts/README.md).

## Language policy
The brief makes **"odpowiedź po polsku, prostym i zrozumiałym językiem"** an MVP requirement, lists "multilingual search with an answer in Polish" as a bonus, and allows new languages in the pilot only "after regression validation" (source: sources/2026-11-21-msz-pelna-tresc-zadania.pdf, sec. 3 and 9). So (Idea, the team asked for multilingual answers, user 2026-11-21):
- **The answer language follows the user, not the material.** A Polish user who pastes a Russian article or an English screenshot gets a Polish answer. That is exactly the bonus feature.
- **Polish is the default** whenever the user hasn't written anything of their own (a bare URL, image or pasted article) or the language can't be detected confidently.
- **Switch to another language only when** the user's own message (`user_message`) is clearly in it, or the user picked it in the UI. Detection runs in code (e.g. a language-ID library), not inside the model.
- Demo languages: **pl** (validated), **en** and **uk** (marked "experimental" in the UI; Ukrainian matters for refugees living in Poland). Other languages get the answer in Polish with a short note.
- The verdict label stays canonical: in en/uk, show the translation with the Polish label alongside it, e.g. "False (fałszywe)", so the web and the second channel stay comparable (scenario G).
- Templates (labels, system messages, warnings) are translated files in code. Only `explanation`, `missing`, `why_not_verifiable` and `clarification_question` come from the model in `{{answer_language}}`.

## Response types
**A. Verdicts (per claim, exactly one of five; never anything else):**
| Code | Polish label | When |
|---|---|---|
| `confirmed` | potwierdzone | rules in pipeline §5 |
| `false` | fałszywe | rules in pipeline §5 |
| `misleading` | wprowadzające w błąd | the core fact is true but its time, place or scope differs, or there is a wrong conclusion |
| `insufficient_evidence` | brak wystarczających dowodów | no or weak evidence, or sources conflict (with `sources_conflict`) |
| `not_verifiable` | nie podlega weryfikacji | opinion, value judgment, intent, prediction, sweeping generalisation ("rząd kłamie"). One short line after the fact claims, no commentary ([hard constraint 21](../rules/hard-constraints.md#scope-organizer-directive)) |

**B. System states (never verdicts; shown as a different-looking banner, not as a verdict card):**
| State | Level | Message idea (pl) |
|---|---|---|
| `needs_clarification` | request | "Doprecyzuj, o co pytasz: …" + the clarifying question. Only when nothing in the input is checkable; never about a date, scope or speaker the system can settle (user, 2026-11-21) |
| `out_of_scope` | request | "Sprawdzamy twierdzenia o faktach. To pytanie wykracza poza zakres." |
| `not_a_claim` | request | a joke, greeting or nonsense: a friendly short reply plus what we can do |
| `input_rejected` | request | too large, unsupported file, or an unsupported platform for video |
| `rate_limited` | request | "Zbyt wiele zapytań, spróbuj za chwilę." |
| `partial` | request | some claims have a verdict, others a claim-level system state (show both) |
| `technical_error` | request or claim | "Nie mogliśmy wykonać sprawdzenia (awaria: …). To nie jest ocena treści." |
| `source_unavailable` | claim | a source API is down or a key is missing: "Nie mogliśmy sprawdzić w {source}." |
| `not_processed` | claim | not checked because of a time or claim-count limit |

Not in v1 yet: `media_not_analyzed` (a failed image read is a request-level `technical_error` today). It can be added later as a new enum value (additive).

Rule: a missing key, a hit limit or an outage **never** produces `insufficient_evidence`. It produces a system state (scenario J).

**C. Warnings (alongside a verdict; never decide it):** `archival_material` (a source or the material is old relative to the claim), `sources_conflict`, `known_narrative` (an EUvsDisinfo match, as context), `source_status` (e.g. an EU-sanctioned outlet: neutral, current, verifiable), `implied_claim` (from `implied_warnings`), `paraphrase` (the quote attributed in the material isn't verbatim), `injection_detected`, `partial_analysis`, `assumed_period` (code filled a missing year or the claim has no date; names the reference date and its basis: publication, original text or submission), `assumed_scope` (a scope word was narrowed from the surrounding text; quotes that fragment: "Przyjęliśmy, że chodzi o …, na podstawie zdania: „…”"; at most 2 per claim; added 2026-11-21 as an additive v1 value, user), `illegible_media` (image only partly readable), `demo_data` (mock mode: the whole response is synthetic; always first in `warnings`).

**D. Evidence strength:** `high | medium | low` (Wysoka / Średnia / Niska) + `reasons[]` (tier, recency, match, number of independent sources). It is computed in code.

**E. Escalation:** v1 returns `none | recommended`; `queued` is reserved for when the moderator queue exists (additive). `queued` only when a moderator case row was actually created or updated (the text says "Zgłoszenie trafiło do kolejki moderatora"). `recommended` says "Rekomendujemy przekazanie do weryfikacji przez człowieka". We never say a human reviewed it unless the case status says so.

## Tone of the answer
- Plain Polish, short sentences, no jargon ("źródło pierwotne" → "oficjalne dane GUS"). One verdict and 1-2 sentences per claim.
- **Objective, not suspicious:** when good sources confirm something, say so clearly. Abstain because evidence is missing, not to look careful.
- Neutral: no mocking of the user or the author, no moralising, no "100% prawda".
- **Invite the user to check for themselves:** every claim ends with links to the sources ("Sprawdź sam: …"). Separate "Co mówią źródła" (quotes) from "Nasza ocena" (interpretation).
- Always state the limits (what we didn't check, e.g. "nie oceniamy opinii", "nie wykrywamy deepfake'ów").

## JSON shape (contract v1, `POST /api/v1/check` → 200)
Every field is always present (no optional fields in the response); `null` means "not applicable". Machine-readable: `GET /api/v1/schema`.
```jsonc
{
  "contract_version": "1.0",
  "check_id": "uuid",
  "status": "ok|partial|needs_clarification|out_of_scope|not_a_claim|input_rejected|rate_limited|technical_error",
  "answer_language": "pl",
  "system_message": { "title": "…", "text": "…" } | null,   // set for every status except ok/partial (and for an all-failed technical_error)
  "summary": { "fact_claims": 2, "opinions": 1, "text": "Znaleźliśmy 2 twierdzenia o faktach i 1 opinię lub prognozę." },
  "claims": [{                                    // empty unless status is ok or partial
    "id": "c1",
    "text": "self-contained claim",
    "provenance": "text|article|image#1|user_message",
    "class": "fact|opinion|prediction",
    "type": "numeric|legal|parliamentary|official_statement|event|narrative" | null,
    "time": "2025|2025-11-16|unknown",
    "risk": "high|normal",
    "verdict": "confirmed|false|misleading|insufficient_evidence|not_verifiable" | null,   // exactly one of
    "system_state": "source_unavailable|technical_error|not_processed" | null,          // these two is set
    "verdict_label": "potwierdzone" | null,      // Polish label of verdict
    "system_message": "…" | null,                // Polish text for system_state
    "strength": { "level": "high|medium|low", "reasons": ["…"] } | null,   // facts with a verdict only
    "explanation": "Nasza ocena: 1-2 plain sentences",
    "missing": "what could not be established" | null,
    "citations": [{                               // built by code from stored records, never by the model
      "source_id": "gfc:https://…", "title": "…", "publisher": "Demagog", "published_at": "2025-03-01" | null,
      "retrieved_at": "ISO", "url": "https://…", "excerpt": "verbatim verified quote",
      "stance": "supports|refutes|misleading|context", "tier": "official|factcheck|media|other",
      "route": "google_factcheck|sejm_eli|corpus|…"
    }],
    "warnings": [{ "type": "sources_conflict", "text": "…" }],
    "routes": [{ "route": "google_factcheck", "label": "…", "status": "hits|no_hits|unavailable|error|timeout|skipped", "required": true, "detail": "optional" }],
    "context_matches": [{                         // optional, absent when none; context only, never a citation or verdict input
      "kind": "known_incident", "catalog": "EUvsDisinfo", "record_type": "case|article", "title": "…", "url": "https://euvsdisinfo.eu/report/…",
      "published_at": "ISO" | null, "excerpt": "catalog text, truncated", "route": "euvsdisinfo_live|euvsdisinfo_corpus",
      "match": "keyword|semantic|hybrid", "score": 0.75
    }]
  }],
  "warnings": [{ "type": "injection_detected", "text": "…" }],   // request-level
  "limitations": ["…"],
  "escalation": { "state": "none|recommended", "reason": "…" | null },
  "input": { "type": "text|url|image|video|audio", "title": "…" | null, "url": "…" | null, "published_at": "…" | null, "description": "image or recording description" | null },
  "meta": { "latency_ms": 8400, "stages_ms": { "extract": 2900 }, "models": ["mistralai/…"], "prompt_versions": ["claim-extraction@2"],
            "cost_usd": 0.0009, "cached": false, "mode": "live|mock" }
}
```
`claims[].provenance` says where a claim came from: `text`, `article`, `image#1`, or a timestamp for recordings (`video@01:15`, `audio@00:18`); the web app shows it as a tag. The web app builds its own heading from `claims` ("Sprawdziliśmy N zdania") and does not show `summary.text`, which stays for short channels such as the messaging bot. Rendering rules for every channel: show `verdict_label` for a verdict and `system_message` for a system state, styled differently; when `warnings[0].type === "demo_data"`, show it prominently. Show `context_matches` apart from the sources, labelled as context (the web app: a collapsed "Podobne przekazy w bazach dezinformacji (kontekst, nie dowód)" disclosure under the sources); a claim with a match also carries one `known_narrative` warning, so a channel that renders only warnings still shows it. The messaging bot renders a short form (verdict, strength, up to 3 citations, a link to the web result) from the same object, so both channels show the same verdict and evidence.
