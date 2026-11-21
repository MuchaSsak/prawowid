---
name: explain-flow
description: "Explain in Polish, briefly and simply, how Prawdowid would process a given input in practice (text, URL, image or video, including URLs with embedded images and videos): which claims it would extract and which it would skip, how each is classified and routed, which real sources and endpoints it would query, the verdict path, what the user would see, and the thinking behind it. Use when the user says /explain-flow, 'wyjaśnij flow', 'jak by to przeszło przez nasz system', 'jak zweryfikowalibyśmy ten tekst/link/obraz', or pastes material and asks how the app would handle it."
argument-hint: "<tekst | URL | ścieżka do obrazu>"
---

Shim for Claude Code. Read `.agents/skills/explain-flow/SKILL.md` and follow it exactly. It is the canonical, tool-agnostic version, and if it conflicts with this file, it wins.
