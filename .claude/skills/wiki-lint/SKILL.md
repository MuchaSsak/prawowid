---
name: wiki-lint
description: "Health-check the .agents/project-info wiki (the project's permanent memory): contradictions, stale claims, sources never ingested, orphan pages, a broken routing table in AGENTS.md, index drift, leftover placeholders, answered open questions. Fixes trivial drift in place, lists the rest in open-questions.md, logs the pass. Use after any task that changed wiki files, after ingesting new sources, or when asked to 'lint/check the wiki'."
model: haiku
effort: medium
allowed-tools: [Read, Write, Edit, Glob, Grep, "Bash(find:*)", "Bash(ls:*)", "Bash(grep:*)", "Bash(date:*)"]
---

Shim for Claude Code. Read `.agents/skills/wiki-lint/SKILL.md` and follow it exactly. It is the canonical, tool-agnostic version, and if it conflicts with this file, it wins.
