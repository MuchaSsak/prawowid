# AGENTS.md

## SECRETS

NEVER read, commit or try to get from a command any passwords, tokens, API keys, .env files, etc. You may acknoledge them, explain or write .env.example, but you do not leak our secrets okie baby?

## MANDATORY: work in context, keep the wiki current

`.agents/project-info/` is this project's permanent memory (an LLM-maintained wiki). It is the source of truth for everything about the project that is not code.

1. **Before acting, read.** Before any task, including answering a question, find the topic in the routing table below and read those pages first. If the topic isn't listed, read `.agents/project-info/index.md`. Always follow `rules/`. Never answer about the project from memory or guesswork when the wiki covers it.
2. **After acting, write back.** If the work produced or changed knowledge (a decision, a new idea, a fact from the user, a new asset, an answered question, a change to the architecture), update the owning page in the same turn. Then keep `index.md` in sync and add a line to `log.md`. One fact lives in one place; elsewhere, link to it.
3. **Ingest every new source.** A file the user drops in (PDF, image, notes, transcript) goes into `sources/`, untouched. Summarize it into the right topic pages, and cite it.
4. **Grow the structure, don't stuff it.** If knowledge fits no existing folder, create a folder for it and add a row to the routing table below and to `index.md`.
5. **Lint after edits.** After any task that changed wiki files, run the `wiki-lint` skill. If your tool has no skills, read `.agents/skills/wiki-lint/SKILL.md` and follow it.

Full conventions (page format, ingest steps, log format): [.agents/project-info/README.md](.agents/project-info/README.md).

## Context routing table

All paths are relative to `.agents/project-info/`.

| When the task touches…                                                 | Read first                        |
| ---------------------------------------------------------------------- | --------------------------------- |
| Anything, or a topic not listed here                                   | `index.md`                        |
| Rules and conventions for agents and the team (**always applies**)     | `rules/`                          |
| Hackathon: organizer, dates, deadlines, judging criteria, deliverables | `hackathon/`                      |
| The problem we solve, its context, the domain                          | `problem/`                        |
| Target audience, users, personas, stakeholders                         | `audience/`                       |
| Product: vision, features, scope, MVP, user flows, ideas               | `product/`                        |
| Architecture, tech stack, data, integrations, infrastructure           | `architecture/`                   |
| Team: members, roles, availability, contacts                           | `team/`                           |
| LLM system prompts, their patterns, anti-patterns and edge cases       | `prompts/`                        |
| Decisions already made, and why (don't re-argue these)                 | `decisions/`                      |
| Pitch, demo, presentation, submission materials                        | `pitch/`                          |
| Unresolved questions, unknowns, things waiting on the user             | `open-questions.md`               |
| Raw files (PDFs, images, docs) the user provided                       | `sources/` (read via topic pages) |
| What changed in the wiki and when                                      | `log.md`                          |

## Tool compatibility

This repo works the same in any coding agent (Codex, Claude Code, Cursor, Copilot, Gemini and others).

- `AGENTS.md` (this file) holds the instructions. `CLAUDE.md` only imports it. Never put content there.
- `.agents/project-info/` holds the wiki, and `.agents/skills/<name>/SKILL.md` holds the canonical skills (standard frontmatter: `name`, `description`).
- `.claude/skills/<name>/SKILL.md` contains thin shims for Claude Code that point to the canonical skill. **Both folders must always hold the same set of skills:** when you add, rename or delete a skill, do it in `.agents/skills/` (the full skill) and `.claude/skills/` (the shim) in the same change. The `wiki-lint` pass checks this.
- If your tool doesn't load skills, read the skill file when it's needed and follow it.
