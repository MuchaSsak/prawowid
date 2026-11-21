# Stack direction (from the team)
What the team has said so far about technologies. **Nothing here is decided yet.** The final vision is coming from the user later. When it is decided, record it in `decisions/`.

- **Repo:** a Turborepo monorepo holding everything about the project (apps + packages). (user, 2026-11-21)
- **API:** **Deno Deploy** hosts the API that accepts the user's text, URL or image input. (user, 2026-11-21: "our deno deploy api")
- **LLM gateway:** very likely **OpenRouter**. A Claude model via OpenRouter is one option. (user, 2026-11-21)
- **Retrieval store:** undecided. Possibly a **vector DB in Supabase** (pgvector). (user, 2026-11-21)
- "jev" was mentioned as a possible model or tool. **Unclear what it refers to** (see [open-questions.md](../open-questions.md)).

Research supporting these choices: [stack-research.md](stack-research.md), [technical-approach-research.md](technical-approach-research.md), [data-sources-research.md](data-sources-research.md).
