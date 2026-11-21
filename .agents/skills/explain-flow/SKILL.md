---
name: explain-flow
description: "Explain in Polish, briefly and simply, how Prawdowid would process a given input in practice (text, URL, image or video, including URLs with embedded images and videos): which claims it would extract and which it would skip, how each is classified and routed, which real sources and endpoints it would query, the verdict path, what the user would see, and the thinking behind it. Use when the user says /explain-flow, 'wyjaśnij flow', 'jak by to przeszło przez nasz system', 'jak zweryfikowalibyśmy ten tekst/link/obraz', or pastes material and asks how the app would handle it."
---

# explain-flow

Show the team, on real material, how our app would handle it: concretely, briefly and honestly. It is a walkthrough of **our design** applied to the input, not a free-form fact-check. Output in **Polish**.

## Use when
- `/explain-flow <text | URL | image path>`, one or several inputs.
- "Jak nasza aplikacja by to sprawdziła?", "rozpisz flow dla tego linku".

## Read first (the design is the spec; don't improvise)
All under `.agents/project-info/`:
- `architecture/verification-pipeline.md`: the steps, the two balancing principles, the verdict rules.
- `prompts/claim-extraction.md` and `prompts/evidence-assessment.md`: apply them **as written**. They define what counts as a claim, the classes, types, stances and edge cases.
- `product/response-contract.md`: verdicts vs system states, warnings, escalation, language, tone.
- `architecture/api-endpoints-verified.md`: which sources and endpoints really exist and were tested.
- `hackathon/compliance-matrix.md` → "Source coverage gaps": what we can't check yet.
- For images or video, also `prompts/media-extraction.md` and `architecture/multimodal-media.md`.

## Steps
1. **Take in the input.**
   - **Text:** use it as is.
   - **URL:** fetch the page the way our system would, legally: respect robots.txt, and never bypass a paywall, login or bot challenge. If you're blocked, say which system state the app would return. List what's on the page: the main text and publish date, meaningful images (skip logos and icons), and videos (YouTube, MP4 or another platform). Say what the app does with each (OCR, transcript via Gemini, or `media_not_analyzed` for unsupported platforms).
   - **Image:** read it yourself, the way the media-extraction prompt would.
   - **Language:** decide the answer language per the language policy (the user's own words, otherwise Polish).
2. **Split the input into claims** by applying the claim-extraction prompt:
   - `input_kind`;
   - each fact claim with its class, type, time, risk and ambiguities;
   - opinions, intents and predictions → `nie podlega weryfikacji` with the reason;
   - what you **skipped** as rhetoric, hyperbole or trivia, and why (one line);
   - `implied_warnings` and `injection_signals`, if any.
3. **Route each fact claim** to a concrete source and endpoint from `api-endpoints-verified.md`, and mark its availability today: ✅ we have it · 🔑 needs a key or token · ❌ not in the corpus yet (a gap).
   - Optionally, for free no-key official APIs (GUS BDL, NBP, Eurostat, Sejm ELI/votings, IMGW), make the real call and show the real result, labelled **"sprawdzone na żywo"**.
4. **Verdict path.** For each claim, say what the stance step would look for, and which verdict the code rules give in each case: "jeśli komunikat NBP mówi X → potwierdzone; jeśli mówi tylko o TK, a tekst sugeruje wszystkie płatności → wprowadzające w błąd; jeśli nie mamy źródła → brak wystarczających dowodów". Give a single outcome only when you actually verified it (step 3) or the source is in the material.
5. **What the user sees:** a short preview in the response-contract style. Per claim: the verdict label, strength, 1 sentence, "Sprawdź sam: …" links (real URLs only, or `[link do źródła]` placeholders). Add the text-level summary, warnings and the escalation state.
6. **Why it works this way:** 3-5 bullets of theory tied to this input (atomic claims, attribution, scope words, common sense vs literalism, fair not suspicious, the model labels and the code decides).
7. **Technical side:** 2-4 bullets: which calls run (2 LLM calls + which APIs), the models, a rough cost and latency, what runs async (video).
8. **Gaps and limits:** what our system could not do for this input today, honestly.

## Tone (non-negotiable)
- **Objective and fair.** This is a fact-checker, not a hunt for excuses to invalidate. If good sources would clearly confirm it, say so.
- **Common sense:** don't treat jokes, hyperbole or trivial rhetoric as claims.
- **No glazing, no filler.** If the design fails on this input (a missing source, a rule that gives a wrong result), say it plainly. That's the point of the exercise.
- **Never present a guess about real-world truth as a finding.** Use conditionals unless it was verified in step 3.
- Plain Polish, short. Aim for about one screen per input; tables over prose.

## Output
1. Write the walkthrough to a temporary Markdown file **outside the repo**: the session scratchpad if your tool has one, otherwise the OS temp dir. Name it `explain-flow-<short-slug>.md`. For several inputs, use one file with a section per input, then "Wnioski z porównania".
2. Reply in chat with a 3-5 line summary (claims checkable vs not, the main gap) and the **full absolute path** of the file.

File template:
```markdown
# Jak Prawdowid sprawdziłby: <krótki tytuł>
## Wejście
<typ (tekst/URL/obraz/wideo), język odpowiedzi, co znaleziono na stronie (obrazy, wideo i co z nimi robimy)>
## Podział na twierdzenia
| # | Twierdzenie / fragment | Klasa · typ | Ryzyko | Co dalej |
Pominięte (retoryka, oczywistości): …
## Źródła i werdykty
| # | Gdzie sprawdzamy (endpoint) | Dostępne? | Ścieżka werdyktu |
## Co zobaczy użytkownik
<krótki podgląd odpowiedzi>
## Dlaczego tak (teoria)
## Technicznie
## Luki i ograniczenia
```

## After
If the walkthrough exposed a new gap, a wrong rule or a prompt edge case, update the owning wiki page (usually `prompts/…`, `architecture/verification-pipeline.md` or `hackathon/compliance-matrix.md`), add a line to `log.md`, and say so in the reply. Don't copy the walkthrough itself into the wiki.
