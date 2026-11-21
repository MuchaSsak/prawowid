# Verification pipeline: how a check works
How we separate facts from opinions and reach a verdict. **Idea**: our recommended design, synthesized from [technical-approach-research.md](technical-approach-research.md), [data-sources-research.md](data-sources-research.md) and the brief. It is not decided until the team confirms it. Constraints: [rules/hard-constraints.md](../rules/hard-constraints.md).

**Core principle:** the LLM *reads and classifies*. **Code decides the verdict** from explicit rules, and only real stored sources can be cited.

## 1. Intake (no LLM judgment)
- Text is used as-is. A URL is fetched (SSRF-safe) and its main text extracted, along with its publish date. An image goes through OCR (bonus).
- Mask PII. Scan for injection: suspected instructions are **flagged + logged**. All user and source content is wrapped as untrusted data, and the model reading it has no tools.

## 2. Claim extraction and classification (LLM, JSON schema)
Split the input into **atomic claims**, and tag each one:

| Class | Example | Handling |
|---|---|---|
| **Fact** (checkable) | "Inflacja w Polsce wynosi 20%" | → retrieval |
| **Opinion / value judgment** | "Rząd jest beznadziejny" | → `nie podlega weryfikacji` + why |
| **Prediction / future** | "Jutro zabraknie paliwa" | → `nie podlega weryfikacji`, or check its factual premise |
| **Unclear / too vague** | "Słyszałem, że coś się stało" | → system state `needs_clarification` (not a verdict) |
| **Out of scope** | a recipe question | → system state `out_of_scope` |

- **Mixed sentences get split:** in "Rząd kłamie, bo inflacja to 20%", the opinion is not verifiable, *and* the inflation claim gets checked.
- For each fact we also extract its **time, place and numbers**, which the missing-context check (scenario B) needs, plus a **type**: numeric · legal · parliamentary · event/news · known narrative.

## 3. Evidence retrieval (routed by claim type)
- **Numeric** → live official APIs: GUS BDL, dane.gov.pl, NBP, Eurostat
- **Legal** → Sejm ELI / ISAP, EUR-Lex
- **Parliamentary** ("X voted for…") → Sejm API
- **Event, news or rumour** → the indexed corpus: Google Fact Check (IFCN/EFCSN fact-checkers), gov.pl (RCB, GIS, MSZ), CERT, police, IMGW. Hybrid search (keywords + embeddings), with multilingual queries.
- **Known narrative** → an EUvsDisinfo match, **shown only as context or a warning, never as the verdict**.
- Every source record stores the title, publisher, published_at, retrieved_at, URL, license and excerpt.

## 4. Evidence assessment (LLM per evidence piece, verified by code)
- For each claim × source, the LLM returns a **stance** (supports / refutes / adds context / irrelevant) + **an exact quote**.
- **Code checks the quote appears verbatim in the stored source.** A quote that doesn't is dropped. That drives citation correctness toward 100%.
- Citation metadata comes from the DB by ID. **The model never writes a URL or title.**

## 5. Verdict (code rules, not the model's free choice)
| Situation | Verdict |
|---|---|
| Opinion, prediction, value judgment | `nie podlega weryfikacji` |
| No relevant verified evidence, or strength below the threshold | `brak wystarczających dowodów` + what we couldn't establish |
| Credible sources **contradict** each other | `brak wystarczających dowodów`, flagged **"źródła są sprzeczne"**, with both sides shown (no arbitrary certainty) |
| Supported by a primary source or ≥2 independent sources | `potwierdzone` |
| Refuted the same way | `fałszywe` |
| The facts are true but the time or place differs, or correct data leads to a wrong conclusion | `wprowadzające w błąd` |

**Evidence strength (shown to the user):** computed from explicit factors: source tier (official/primary > IFCN/EFCSN fact-checker > other), recency versus the claim's date, how closely the quote matches, and the number of **independent** confirmations. It is shown as Wysoka / Średnia / Niska, with the reasons.

## 6. Answer (Polish, plain language)
- One verdict per claim + a 1-2 sentence explanation.
- **"Co mówią źródła"** (the quotes + citations) is kept separate from **"Nasza ocena"** (the model's interpretation).
- Limitations, an **archival-material warning**, and a separate, neutral **source-status warning** (e.g. a sanctioned outlet) that never decides the verdict.
- System states (`technical_error`, `needs_clarification`, `out_of_scope`) look visibly different from verdicts. A missing key or an outage never looks like a result.

## 7. Log and the moderator loop
- Every check is logged: the masked question, time, sources, verdicts, latency, model, cost, and injection events.
- Abstentions that are high-risk or repeat a similar unanswered question create or update **one** moderator case. The answer says "rekomendujemy przekazanie" until a human actually takes the case.
