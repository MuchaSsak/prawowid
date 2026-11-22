# Hard constraints (from the task)
Non-negotiable rules for everything we build. Breaking one can zero the bonus points (gate condition) or disqualify the answer. (source: sources/2026-11-21-msz-pelna-tresc-zadania.pdf, sec. 2, 4, 5, 8)

## Truth and evidence
1. **Never present LLM output as fact without a verifiable source.** Every factual finding links to a real, stored source record (title, publisher, date, link, excerpt).
2. **Never fabricate sources.** Citations come only from our retrieved corpus or a live API response, never written freely by the model. This is a gate condition.
3. **Abstain** (`brak wystarczających dowodów`) when evidence is insufficient. Never create a "pseudo-answer". Say what couldn't be established. One narrow exception, by the user's decision: an official announcement of exactly the claimed event, for a single day that has passed, with no cancellation in the source, confirms it with low strength and says so ([decision 016](../decisions/016-official-announcement-past-day.md)).
4. **Never decide truth from the domain, author, channel, popularity, share count, or a label made by the same model.**
5. **Source status (e.g. EU sanctions) never decides truth on its own.** At most, show a separate, neutral, current and verifiable warning about the source.
6. A match with a known-incident catalog or domain is **context or a warning, never a verdict**.

## Verdicts versus system states
7. Use only these 5 verdicts: `potwierdzone`, `fałszywe`, `wprowadzające w błąd`, `brak wystarczających dowodów`, `nie podlega weryfikacji`.
8. **Technical failure, a missing API key, a hit limit, the need for clarification, and out-of-scope requests are NOT verdicts.** Show them as distinct system messages.
9. "Escalation recommended" ≠ "escalated to a moderator". Never claim an escalation that didn't happen.

## Security and privacy
10. Content from sources, URLs and user input is **untrusted data**. Instructions inside it never change system behaviour. Detect them, ignore them and log them.
11. **No API keys, secrets or personal data in the repo** or in demo materials. Use `.env` (gitignored) + `.env.example`.
12. Mask obvious PII automatically. Define a retention period. A demo session can be deleted.
13. Never bypass paywalls, logins or site protections, and respect robots.txt and ToS.
14. Never archive full content or images without a stated legal basis, license, retention period, access control and deletion procedure.
15. Never claim a full reverse image search without a working API or a clearly bounded local index.

## Evaluation integrity
16. **Never hardcode test cases or answers into prompts or code.** The jury uses a hidden set and its own questions.
17. Disclose unsupported cases and limitations honestly.

## Architecture
18. Channel adapters are separate from the verification core, and every channel calls the same core.
19. The LLM provider or model is swappable through configuration, with no rebuild.
20. The jury must be able to run the project from the README alone, end-to-end, with no help from us.

## Scope (organizer directive)
21. **We fight disinformation by checking factual statements against our source list, not by assessing opinions.** "Rząd kłamie" and other opinions, comments and imprecise generalisations get `nie podlega weryfikacji` with one short reason. We don't discuss, weigh or search for evidence about them. Specific factual statements in the same material are checked on their own. (ustalenie z organizatorami przekazane przez użytkownika, 2026-11-21)
