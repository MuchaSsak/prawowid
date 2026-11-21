# Verification pipeline: how a check works
How we separate facts from opinions and reach a verdict. **Idea**: our recommended design, synthesized from [technical-approach-research.md](technical-approach-research.md), [data-sources-research.md](data-sources-research.md) and the brief. It is not decided until the team confirms it. Constraints: [rules/hard-constraints.md](../rules/hard-constraints.md).

**Core principle:** the LLM *reads and classifies*. **Code decides the verdict** from explicit rules, and only real stored sources can be cited. The exact prompts are in [prompts/](../prompts/README.md), and the response types in [product/response-contract.md](../product/response-contract.md).

**Two balancing principles:**
- **Common sense, not literalism.** Hyperbole, rhetoric, jokes, trolling and trivial background are not claims. We check what a sensible reader would want checked (the core of the story, numbers, quotes, dates), at most 8 claims per input.
- **Fair, not suspicious.** We are a fact-checker, not a reason-finder for doubt. One clear official source or fact-check is enough. Rounding and wording differences are not refutation. Over-abstaining hurts macro-F1 (30% of the score) just as false certainty does. We abstain when evidence is actually missing.

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
- **Splitting philosophy:** one claim = one subject + one checkable predicate, self-contained (resolve "bank centralny" → NBP, fill the date/year, keep the attribution "X przekazał"). For reported speech we check **that the source said it**, not whether its reasoning is right (an institution's legal assessment is its opinion). Ambiguous scope words ("wszelkich", "wszyscy") get split out, because they are where a true story turns misleading.
- **Worked example** (NBP and the Constitutional Tribunal's payments, 2026-11-21): 3 claims: (1) NBP said its legal department concluded there are grounds to stop executing TK's payment orders; (2) it was published on 16 Nov; (3) the NBP spokesperson announced a halt of "all payments" (scope unclear: TK's or all?). The primary source is an NBP press release, so **nbp.pl must be in the corpus**, or the honest answer is `brak wystarczających dowodów`.
- **Worked example 2** (an opinion piece on Trump's Asia trip, 2026-11-21): 9 fragments, but only 3 can be checked (the trip took place, the "przełom" quote, the board headlines). The rest ("uległość", "napięcia", "Amerykanie zaczynają rozumieć", the intent "chciał przykryć") get `nie podlega weryfikacji`. We extract only what the text asserts: a board reading "Deklaracja pokojowa USA–Rosja–Chiny" is not a claim that the declaration exists, so we give a warning instead. The text-level summary ("3 checkable, 6 opinions") is useful output too. Gap: foreign-politics sources (whitehouse.gov transcripts, MSZ, ClaimReview).
- For each fact we also extract its **time, place and numbers**, which the missing-context check (scenario B) needs, plus a **type**: numeric · legal · parliamentary · official statement · event · known narrative, and a **risk** level (high = public safety, military, health, elections, disasters; used for moderator escalation).

## 3. Evidence retrieval (routed by claim type)
- **Numeric** → live official APIs: GUS BDL, dane.gov.pl, NBP, Eurostat
- **Legal** → Sejm ELI / ISAP, EUR-Lex
- **Parliamentary** ("X voted for…") → Sejm API
- **Official statement** ("NBP / ministry X announced…") → institutions' press releases in the corpus (gov.pl; **nbp.pl and other institutions' sites are not yet ingested**, see open-questions)
- **Event, news or rumour** → the indexed corpus: Google Fact Check (IFCN/EFCSN fact-checkers), gov.pl (RCB, GIS, MSZ), CERT, police, IMGW. Hybrid search (keywords + embeddings), with multilingual queries.
- **Known narrative** → an EUvsDisinfo match, **shown only as context or a warning, never as the verdict**.
- Every source record stores the title, publisher, published_at, retrieved_at, URL, license and excerpt.

## 4. Evidence assessment (LLM per evidence piece, verified by code)
- For each claim × source, the LLM returns a **stance** (supports / refutes / misleading + what differs / context / irrelevant) + **an exact quote**, plus a proposed verdict and a short explanation per claim. Prompt: [prompts/evidence-assessment.md](../prompts/evidence-assessment.md).
- **Code checks the quote appears verbatim in the stored source.** A quote that doesn't is dropped. That drives citation correctness toward 100%.
- Citation metadata comes from the DB by ID. **The model never writes a URL or title.**

## 5. Verdict (code rules, not the model's free choice)
| Situation | Verdict |
|---|---|
| Opinion, prediction, value judgment | `nie podlega weryfikacji` |
| No relevant verified evidence, or strength below the threshold | `brak wystarczających dowodów` + what we couldn't establish |
| Credible sources **contradict** each other | `brak wystarczających dowodów`, flagged **"źródła są sprzeczne"**, with both sides shown (no arbitrary certainty) |
| Supported by **one official/primary source**, or **one IFCN/EFCSN fact-check** about the same claim, or **≥2 independent** other credible sources; no credible refutation | `potwierdzone` |
| Refuted the same way | `fałszywe` |
| A verified quote is labelled "misleading" (the core fact is true but its time, place or scope differs, or the conclusion is wrong) and nothing credible refutes the core | `wprowadzające w błąd` |
| A source API is down or a key is missing | a **system state**, never a verdict |

Sources are **not** in conflict when they describe different periods (`data_period`): the one matching the claim's time wins, and the other may trigger the `archival_material` warning. When the code verdict differs from the model's `proposed_verdict`, the code wins and the disagreement is logged.

**Evidence strength (shown to the user):** computed from explicit factors: source tier (official/primary > IFCN/EFCSN fact-checker > other), recency versus the claim's date, how closely the quote matches, and the number of **independent** confirmations. It is shown as Wysoka / Średnia / Niska, with the reasons.

## 6. Answer (plain language; Polish by default, see the [language policy](../product/response-contract.md#language-policy))
- One verdict per claim + a 1-2 sentence explanation.
- **"Co mówią źródła"** (the quotes + citations) is kept separate from **"Nasza ocena"** (the model's interpretation).
- Limitations, an **archival-material warning**, and a separate, neutral **source-status warning** (e.g. a sanctioned outlet) that never decides the verdict.
- System states (`technical_error`, `needs_clarification`, `out_of_scope`) look visibly different from verdicts. A missing key or an outage never looks like a result.

## 7. Log and the moderator loop
- Every check is logged: the masked question, time, sources, verdicts, latency, model, cost, and injection events.
- Abstentions on `risk: high` claims, or repeats of a similar unanswered question (embedding similarity), create or update **one** moderator case and notify the moderator the admin configured (e.g. a Discord channel webhook). The answer says "trafiło do kolejki moderatora" only when the case row exists, and "rekomendujemy przekazanie" otherwise. Logs live in a non-public schema ([decisions/001](../decisions/001-private-logs-schema.md)).
