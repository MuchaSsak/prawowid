# Response contract: what the user gets back
The response types (verdicts, system states, warnings, escalation), the answer language and tone, and the JSON shape every channel renders. **Idea, draft v1 (2026-11-21)**. Verdict logic: [architecture/verification-pipeline.md](../architecture/verification-pipeline.md). Prompts: [prompts/](../prompts/README.md).

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
| `not_verifiable` | nie podlega weryfikacji | opinion, value judgment, intent, prediction |

**B. System states (never verdicts; shown as a different-looking banner, not as a verdict card):**
| State | Level | Message idea (pl) |
|---|---|---|
| `needs_clarification` | request | "Doprecyzuj, o co pytasz: …" + the clarifying question |
| `out_of_scope` | request | "Sprawdzamy twierdzenia o faktach. To pytanie wykracza poza zakres." |
| `not_a_claim` | request | a joke, greeting or nonsense: a friendly short reply plus what we can do |
| `input_rejected` | request | too large, unsupported file, or an unsupported platform for video |
| `rate_limited` | request | "Zbyt wiele zapytań, spróbuj za chwilę." |
| `technical_error` | request or claim | "Nie mogliśmy wykonać sprawdzenia (awaria: …). To nie jest ocena treści." |
| `source_unavailable` | claim | a source API is down or a key is missing: "Nie mogliśmy sprawdzić w {source}." |
| `media_not_analyzed` | claim or part | an image or video couldn't be read, or video is still processing |

Rule: a missing key, a hit limit or an outage **never** produces `insufficient_evidence`. It produces a system state (scenario J).

**C. Warnings (alongside a verdict; never decide it):** `archival_material` (a source or the material is old relative to the claim), `sources_conflict`, `known_narrative` (an EUvsDisinfo match, as context), `source_status` (e.g. an EU-sanctioned outlet: neutral, current, verifiable), `implied_claim` (from `implied_warnings`), `paraphrase` (the quote attributed in the material isn't verbatim), `injection_detected`, `partial_analysis`.

**D. Evidence strength:** `high | medium | low` (Wysoka / Średnia / Niska) + `reasons[]` (tier, recency, match, number of independent sources). It is computed in code.

**E. Escalation:** `none | recommended | queued`. `queued` only when a moderator case row was actually created or updated (the text says "Zgłoszenie trafiło do kolejki moderatora"). `recommended` says "Rekomendujemy przekazanie do weryfikacji przez człowieka". We never say a human reviewed it unless the case status says so.

## Tone of the answer
- Plain Polish, short sentences, no jargon ("źródło pierwotne" → "oficjalne dane GUS"). One verdict and 1-2 sentences per claim.
- **Objective, not suspicious:** when good sources confirm something, say so clearly. Abstain because evidence is missing, not to look careful.
- Neutral: no mocking of the user or the author, no moralising, no "100% prawda".
- **Invite the user to check for themselves:** every claim ends with links to the sources ("Sprawdź sam: …"). Separate "Co mówią źródła" (quotes) from "Nasza ocena" (interpretation).
- Always state the limits (what we didn't check, e.g. "nie oceniamy opinii", "nie wykrywamy deepfake'ów").

## JSON shape (`POST /api/check` → 200)
```jsonc
{
  "check_id": "uuid",
  "status": "ok|partial|needs_clarification|out_of_scope|not_a_claim|input_rejected|rate_limited|technical_error",
  "answer_language": "pl",
  "summary": { "fact_claims": 3, "opinions": 6, "text": "Tekst to głównie publicystyka: 3 twierdzenia sprawdzalne, 6 to oceny." },
  "claims": [{
    "id": "c1", "text": "…", "provenance": "article|image#1|video@01:23",
    "verdict": "confirmed|false|misleading|insufficient_evidence|not_verifiable|null",
    "verdict_label": "potwierdzone",
    "system_state": "source_unavailable|media_not_analyzed|technical_error|null",   // exactly one of verdict / system_state
    "strength": { "level": "high|medium|low", "reasons": ["oficjalne dane GUS", "dane z 2024"] },
    "explanation": "…", "missing": "…|null",
    "citations": [{ "source_id": "…", "title": "…", "publisher": "GUS", "published_at": "…", "retrieved_at": "…",
                    "url": "…", "excerpt": "verified quote", "stance": "supports", "tier": "official" }],
    "warnings": [{ "type": "archival_material", "text": "…" }]
  }],
  "limitations": ["…"],
  "escalation": { "state": "none|recommended|queued", "case_id": "…|null" },
  "meta": { "latency_ms": 8400, "models": ["mistral-small-2603"], "prompt_versions": ["claim-extraction@1"], "cost_usd": 0.0014 }
}
```
The second channel (a messaging bot, WhatsApp or similar, [decision 004](../decisions/004-first-build-stack.md); Discord was the earlier plan) renders the same object in a short form (verdict, strength, up to 3 citations, and a link to the full web result), so both channels show the same verdict and evidence.
