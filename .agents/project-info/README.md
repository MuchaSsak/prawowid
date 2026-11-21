# Project wiki: conventions

This folder is the project's permanent memory. Agents maintain it; people feed it sources and answers.
`AGENTS.md` holds the routing table. This file holds the rules for writing the wiki.

## Layers

- `sources/`: raw material exactly as the user gave it (PDFs, images, slides, transcripts, exports). **Never edit or delete it.** Name files `YYYY-MM-DD-short-slug.ext`.
- Topic folders (`hackathon/`, `problem/`, `audience/`, `product/`, `architecture/`, `team/`, `decisions/`, `evaluation/`, `pitch/`, `rules/`): pages agents write, summarizing and connecting what is known.
- `index.md`: a catalog of every page and source, one line each. `log.md`: an append-only history. `open-questions.md`: unknowns.

## Page format

- One topic per page, kebab-case file name, e.g. `product/core-features.md`. Each folder's `README.md` states what belongs in it.
- Start the page with `# Title`, then one line saying what the page covers, then the content. Keep pages short and factual, with bullets and tables over prose.
- One fact lives in one place. Every other page links to it (`[name](../folder/page.md)`) rather than copying it.
- Cite where a fact came from: `(source: sources/2026-11-21-brief.pdf, p.3)`, `(user, 2026-11-21)` or `(decision: decisions/stack.md)`.
- Mark how sure a fact is when it isn't confirmed: **Idea** (proposed), **Assumption** (unconfirmed), and **Decided** (agreed, so link to `decisions/`).
- Unknowns go to `open-questions.md`, never invented. When one is answered, move the answer into the owning page and delete the question.

## Operations

**Ingest** (the user provides a file or information):
1. Save the file to `sources/` without changing it.
2. Read it fully. Update or create the topic pages it touches, citing it.
3. Note any contradictions with existing pages, and resolve them or add them to `open-questions.md`.
4. Add the source and any new pages to `index.md`, and append a line to `log.md`.

**Query** (any task or question): routing table, then the pages, then the answer. If the answer is worth keeping (a comparison, an analysis, a conclusion), save it as a page.

**Decide**: when the team settles something, add `decisions/NNN-slug.md` with the context, the decision, the alternatives rejected and the date. Then update the affected pages.

**Lint**: run the `wiki-lint` skill (`.agents/skills/wiki-lint/SKILL.md`) after changes. It checks for contradictions, orphans, stale claims, broken routing and sources that were never ingested.

## log.md format

Append only, newest last: `## [YYYY-MM-DD] <ingest|update|decision|lint|restructure> | <one-line summary>`
