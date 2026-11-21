---
name: wiki-lint
description: "Health-check the .agents/project-info wiki (the project's permanent memory): contradictions, stale claims, sources never ingested, orphan pages, a broken routing table in AGENTS.md, index drift, leftover placeholders, answered open questions. Fixes trivial drift in place, lists the rest in open-questions.md, logs the pass. Use after any task that changed wiki files, after ingesting new sources, or when asked to 'lint/check the wiki'."
---

# wiki-lint

Keep `.agents/project-info/` trustworthy, so that any agent can work from it alone.
A stale, contradictory or unrouted wiki is worse than none. This pass is the guard.
The wiki's conventions are in `.agents/project-info/README.md`. Lint against them.

## Use when

- After any task that created, changed or deleted wiki pages.
- After ingesting new files into `sources/`.
- On request ("lint the wiki", "is the wiki up to date?").

## Context to read

- The request or arguments, if any (may narrow the scope to the files just changed; still run the structural checks 1-3 on the whole wiki).
- `AGENTS.md`: the routing table.
- `.agents/project-info/README.md`, `index.md`, `open-questions.md`, and the last 5 entries of `log.md`.
- Every `.md` page in the topic folders. List them with `find .agents/project-info -type f`.
- `sources/`: list the files. Open a source only when a check needs it (read PDFs with whatever PDF or file tool you have).

## Checks

1. **Routing table**: every path in the AGENTS.md routing table exists. Every top-level folder in `project-info/` has a row. A missing row means agents can't find that knowledge.
2. **Index drift**: every page and source file appears in `index.md`, and every index entry points to a file that exists. Summaries match what the pages contain.
3. **Un-ingested sources**: every file in `sources/` (except its README) is cited by at least one topic page. If one isn't, ingest it per README.md if it can be read, or list it in `open-questions.md`.
4. **Contradictions**: the same fact (date, name, number, scope, stack choice) stated differently on two pages. The owning page wins. Fix the copy, or replace it with a link. If the owner is unclear, add it to `open-questions.md`.
5. **Decision drift**: a page that contradicts a record in `decisions/`, or a decision superseded without its status updated.
6. **Code drift** (only once code exists): architecture or stack claims the repo visibly contradicts (dependencies, folder layout, frameworks). Code wins for facts about the code.
7. **Leftovers**: `TODO`, `TBD`, `lorem`, empty sections, or facts with no source or certainty marker that look invented.
8. **Answered open questions**: an entry in `open-questions.md` that a page or source now answers. Move the answer into the owning page and delete the entry.
9. **Broken links**: relative links between wiki pages that point to files that don't exist.
10. **Misplaced knowledge**: content in the wrong folder, or a large topic crammed into an unrelated page. If it can be moved surgically, move it. If not, report it.

## Operating rules

1. Never ask questions. Never invent facts to fill a gap. An unknown goes to `open-questions.md`.
2. Fix trivial drift directly: one-line corrections, index entries, routing rows for existing folders, link fixes, deleting answered questions, moving an answer into its page.
3. Never modify or delete anything in `sources/`.
4. Report structural problems (a needed restructure, an unclear owner) instead of attempting a large rewrite.
5. Finish by appending to `log.md`: `## [YYYY-MM-DD] lint | <n> findings: <one-line summary>` (or `clean`).

## Output

- At most 15 lines: one per finding, `file: problem -> fixed | open-questions | needs restructure`, plus a final summary line.
- Edits are surgical. Never rewrite whole pages, reword prose, or change style.
- Touch only `.agents/project-info/` and the routing table in `AGENTS.md`.
- A folder that holds only its README (no knowledge yet) is not a finding.
