# Pitch deck (Google Slides)
The jury deck: where it lives, the one message it carries, the slide outline with the source of every number, what is still a placeholder, and how it was built. Built 2026-11-21 on request (user).

- **File:** https://docs.google.com/presentation/d/1uC4f8bR6BtkHHww_MXOA5SvWwWdSlTkVEySPFjCXwfc/edit (shared "anyone with the link can view"). Edit this one file in place; never copy or fork it (user, 2026-11-21). Card on `/admin/dokumenty` ([apps/web/src/lib/admin/documents.ts](../../../apps/web/src/lib/admin/documents.ts)).
- **Same deck for both stages:** the Stage I PDF (≤ 12 slides covering problem, users, architecture, demo, test results, risks, next steps; [deliverables](../hackathon/deliverables.md)) and the Stage II 5-minute pitch ([event-and-jury](../hackathon/event-and-jury.md)). Export: File → Download → PDF, named `prawdomat-prezentacja-RRRR-MM-DD.pdf`.
- **Speaker notes** on every slide hold the timed 5-minute script (0:00–5:00) and, on slide 10, one-line answers to the expected jury questions ([jury-insights](jury-insights.md)).

## The message
"Model czyta, kod decyduje": every answer carries a verbatim source, or an honest "nie wiemy". It answers the task's own warning that fluent AI is not correct AI (task sec. 1), and it targets the 30% evidence criterion and the gate condition (no fabricated sources, correct abstention) in [judging-and-metrics](../hackathon/judging-and-metrics.md). Closing line: „Nie mówimy, co myśleć. Pokazujemy dowody.” (task sec. 9: not an automatic judge of truth).

## Outline
| # | Slide | Covers | Numbers and their source |
|---|---|---|---|
| 1 | Sprawdź, zanim udostępnisz (navy) | title | none |
| 2 | 91% | problem | 91% / 55% in 2024: Digital Poland, NASK, Demagog 2026 ([problem](../problem/overview.md)) |
| 3 | Płynna odpowiedź AI to jeszcze nie dowód. | the turn | task sec. 1 quote |
| 4 | Pytasz tam, gdzie już piszesz | users, channels | channel consistency 3 of 3 ([benchmark](../evaluation/benchmark.md), run 3) |
| 5 | „Dług publiczny Polski wynosi 276 proc. PKB.” → fałszywe | demo | real response, case R01 of the organizer-style set, 7,8 s, Eurostat 59,6% (2025) + Demagog 57,3% quotes (`eval/results/organizer-2026-11-21T19-17-44.json`) |
| 6 | Model czyta, kod decyduje | architecture | none |
| 7 | Cztery progi MSZ przekroczone | test results | 27/27, 7/8, 4/4, 6,4 s; gap stated: macro-F1 0,71 vs 0,75 ([benchmark](../evaluation/benchmark.md), run 3) |
| 8 | Najgroźniejsze ryzyka blokuje kod | risks | 4/4 injection; full risk list points to the README |
| 9 | Gotowi na pilotaż z MSZ | next steps, deployment | 4,78 zł per 1000 ([cost sheet](../rules/cost-sheet.md)); Mistral pinned to `mistral/eu` (`packages/core/src/config.ts`); pilot path from task sec. 9 |
| 10 | Nie mówimy, co myśleć. Pokazujemy dowody. (navy) | close, links | none |

Choices: 10 slides, not 12, because the design system caps a 5-minute pitch at 8–10. Macro-F1 is disclosed on slide 7 rather than headlined, since hiding it would contradict the README (hard constraint 17). No "all data in the EEA" claim: OpenRouter is a US gateway and video goes to Gemini ([model-selection](../architecture/model-selection.md)).

## Placeholders to fill
- Slide 4: two "Miejsce na wideo" frames (web app; the same text in Discord or Messenger). Insert screen recordings or screenshots.
- Slide 10: "Zespół [nazwa] · stolik [nr]"; slide 1 notes: team name.
- Rerun the numbers before submission if a newer full benchmark run lands (slides 4, 7, 8, 9 and the notes).

## How it is built
- [Design system](design-system.md) tokens mapped to a 720 × 405 pt page (1920 px = 720 pt): Newsreader 400 for titles and figures, Inter Tight for text, navy only as accent, verdict colors only on the badge, no uppercase eyebrows ([ui-conventions](../rules/ui-conventions.md)). 45 pt margins, source line and slide number at the bottom.
- The Slides API cannot draw the rosette's freeform path, and images need a public PNG URL, so the watermark and the small mark are built from rotated ellipse outlines (navy-light, 32% opacity). It reads like the og card but is not the exact mark. To swap in the real mark, export a PNG from `favicon.svg` and place it by hand.
- API notes for later edits: object IDs need ≥ 5 characters (slides are `s01pg`…`s10pg`, elements `s05_claim` etc.); the API stores every shape as a 3 000 000 EMU square and folds the size into the transform, so an absolute transform on a copied shape must include the size; rounded rectangles get an automatic radius (about 17% of the short side) that the API cannot change.

## Research behind the shape
Practitioner advice agrees: one message per slide, a story the titles alone can carry, a live demo of one concrete case over slides, a recorded fallback for the demo, timed rehearsal, and knowing what the judges care about (JetBrains judging notes 2026, Kawasaki 10/20/30, Solvro on HackNation 2025, AI Action Summit hackathon criteria). Jury specifics: [jury-insights](jury-insights.md).
