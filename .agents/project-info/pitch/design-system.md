# Design system for PDFs and decks
What the Prawdomat Design System contains, where its values come from and how to use it. The artifact's README is the full rulebook; this page only summarises it.

- **Where:** https://claude.ai/artifact/JoqhxzNKkfsTALddYMMckr (private to the owner until shared from the page's Share menu). Agents read it with the Artifact tool: `read` with `path: "project/README.md"`, then `project/tokens.json`, `project/components/bundle.css` and each `project/components/<Name>/README.md`. Built 2026-11-21 (user asked for it).
- **Source of the values:** the web app, exact. Colors and verdict tones from [apps/web/src/styles/global.css](../../../apps/web/src/styles/global.css), fonts Newsreader + Inter Tight (latin + latin-ext woff2 from `@fontsource-variable`), the guilloche rosette generated with the same geometry as [apps/web/src/lib/rosette.ts](../../../apps/web/src/lib/rosette.ts), the share card [og.png](../../../apps/web/public/og.png) as the reference for the dark title slide.
- **Themes:** Paper (light) for every PDF and content slide; Navy (dark) for title and closing slides, set by `data-theme="dark"` on the slide.
- **Components (14):** Brand: Logo. Document A4 (794 × 1123 px, 20 mm margins): DocCover, DocPage, KeyPoints ("W skrócie"), StatRow, DataTable, SourceLine. Verdicts: VerdictBadge (the five verdicts only), SystemState (dashed amber, never a verdict). Slides 1920 × 1080: SlideTitle, SlideStatement, SlideStat, SlidePoints, SlideEvidence. All are plain HTML + `bundle.css` classes (`pd-*`), no JS.

## The rules that keep documents short
- One idea per slide, one section per page. Every number, chart, table and factual sentence gets a Źródło line (same rule as the product, [hard constraints](../rules/hard-constraints.md) 1-2).
- Slide: title ≤ 6 words, ≤ 40 words in total, ≤ 3 points, 1 number or 1 chart. A4 page: ≤ 3 short paragraphs, ≤ 3 stats, ≤ 6 × 5 table. A 5-minute pitch is 8-10 slides.
- Navy is the only accent. Verdict colors appear only on verdicts; amber only on system states ([hard constraint 8](../rules/hard-constraints.md)).
- Headlines state the finding. Polish number format (0,71; 6,4 s; 88%), non-breaking space after single-letter words.

## Not yet on the system
- The explain-flow PDF template ([.agents/skills/explain-flow/assets/template.html](../../skills/explain-flow/assets/template.html)) still uses Segoe UI and its own palette. Moving it onto the tokens and `pd-*` components is the next step.
- No chart component yet: chart rules are in the README (navy for the series that matters, direct labels, a source line), but there is no ready-made chart.
