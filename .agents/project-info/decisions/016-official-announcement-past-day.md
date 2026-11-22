# 016: An official announcement whose day has passed confirms that the event took place
Date: 2026-11-22 · Status: decided (user: "we need to get yes on this question because jury wants this", "dont add any new sources", then chose the narrow rule)

Context: organizer sample A ("Czy we Włoszech ostatnio odbywał się strajk generalny?"). Our only source is MSZ Odyseusz/IT, approved 2026-11-19: "W dniu 20 listopada na terenie całego kraju zapowiedziano strajk generalny…". The strike did happen (Sky TG24, CGIL), but neither is on our allowlist, and the user ruled out adding sources. Under the 2026-11-21 rule "announced ≠ happened" ([evidence-assessment](../prompts/evidence-assessment.md)) the answer could only be `brak wystarczających dowodów`. The organizer's sample answer also abstained ("nie wiem, czy się odbył"), but the user says the jury wants "Tak".

Decision: a passage supports "it took place" when **all** of these hold (code: `announcedDayPassed` in `packages/core/src/pipeline/assess.ts`):
- the model marks it `announces_claimed_event: true`: it announces exactly the claimed event (same kind, place, date window). Prompt `evidence-assessment@7` adds only this field; the stance rule ("context" for an announcement) is unchanged;
- the record is tier `official`, and its title or text names the claim's place;
- the claim says the event happened, not that it was announced;
- an announcing sentence of the record is about the claim's subject (a 5-letter stem of a claim word other than place and time words, e.g. "strajk") and names one single day; code takes the nearest such sentence to the model's quote, then any in the other retrieved chunks of the same page (same URL), since the quote is often a neighbouring sentence and the corpus splits pages into chunks; the citation then shows that sentence (2026-11-22, Spain page: the quote was "Konsekwencje… strajku…"). The single day is parsed by `eventDateIn` in `dates.ts`; lists and ranges such as "20 lub 21 listopada" or "w dniach" don't count. A day without a year takes the nearest one on or after the publication date;
- that day is inside the claim's time ("ostatnio" = last 30 days, "w tym tygodniu" = Monday to the reference date, a stated date or month) and strictly before the reference date;
- no sentence of the same document both carries a cancellation or postponement word (`CANCELLED`: odwołan-, przełożon-, przesunięt-, zawieszon-, anulowan-, cancel-, postpon-, plus Italian forms) and is about the claim's subject: "Strajk generalny przełożono" blocks, "odwołane mogą być zaplanowane zabiegi" (Spain page, a consequence of the strike) does not.
- Retrieval support: a corpus hit on an official page of at most 4,000 characters is read as the whole page, its chunks joined by offset (`expandPages` in `connectors/corpus.ts`, `pageOf` on the corpus stores), so the dated sentence is there even when search found another chunk.

Then the verdict is `potwierdzone` with strength **Niska** ("tylko oficjalna zapowiedź, termin już minął", "brak relacji z przebiegu"). Code writes the explanation and the leading "Tak." (`announcedPassedExplanation` in `render.ts`): "<publisher> (<date>) podało: „…”. Termin (…) już minął, a źródło nie informuje o odwołaniu ani przełożeniu, więc przyjmujemy, że wydarzenie się odbyło. Nie mamy relacji z jego przebiegu." Event `announced_passed` is logged. If the model reads the passages as refuting (opposite verdict), the existing inconsistency rule still abstains.

Known risk, accepted by the user: an event cancelled or postponed without the official source saying so gets a wrong "Tak" (Italian strikes are often moved by the Commissione di garanzia). The low strength and the wording say the answer rests on the announcement.

Rejected:
- adding news sources (GDELT search, Sky TG24, CGIL, ANSA): the user ruled out new sources;
- adding only the pages about this strike: hardcoding a known question (hard constraint 16);
- "Najprawdopodobniej tak." over an abstention verdict: the user wanted the verdict itself;
- keeping the abstention (the organizer sample's own answer).

Affects: [prompts/evidence-assessment.md](../prompts/evidence-assessment.md), [architecture/verification-pipeline.md](../architecture/verification-pipeline.md) (§5), [hackathon/organizer-sample-answers.md](../hackathon/organizer-sample-answers.md) (item 10), [evaluation/benchmark.md](../evaluation/benchmark.md) (O02/X02 gold, gap 3), [rules/hard-constraints.md](../rules/hard-constraints.md) (rule 3 exception noted).
