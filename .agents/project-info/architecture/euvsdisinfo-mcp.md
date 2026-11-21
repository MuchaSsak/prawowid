# EUvsDisinfo MCP server
How to pull EUvsDisinfo articles and disinformation cases, our known-incidents corpus (scenario I, bonus "match to known incidents"). (source: sources/2026-11-21-euvsdisinfo-mcp-how-to.pdf)

- **Endpoint:** `https://euvsdisinfo-mcp-server.vercel.app/mcp`. MCP over **streamable HTTP (not SSE)**, JSON-RPC 2.0.
- **Auth:** `Authorization: Bearer <token>`. We need a token from the organizer (DM on Discord). **Never commit it.** Keep it in `.env`.
- **Headers on every call:** `Content-Type: application/json`, `Accept: application/json, text/event-stream`.

## Flow
1. **`initialize`** (POST): `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"prawdowid","version":"0.0.0"}}}`. Read the **`mcp-session-id` response header**. The body arrives as SSE (`event: message` / `data: {...}`).
2. Every later call sends the header `mcp-session-id: <id>`.
3. `tools/list` (optional) returns two tools: `articles` and `cases`, each taking `{offset ≥0, limit 1..100}` (both required).
4. `tools/call` with `{"name":"cases","arguments":{"offset":0,"limit":100}}`. Results are in `result.structuredContent` with `total, offset, limit, currentPage, totalPages, hasNextPage`. Since v1.1 an unstructured text copy is also in `content`.

Pagination: `offset = (page - 1) * limit`. Loop while `hasNextPage`.

## Data
- **Cases** (~19,248 when the doc was written; it is dated July 2025): `id` (uuid), `title`, `claim` (the disinformation claim), `fact` (EUvsDisinfo's debunk), `date` (unix seconds), `keywords[] {_id,title}`, `countries[] {_id,title}`, `linksToDisinformation[] {url, archiveUrl, snapShotURL, headLine, language{id,name}, type}`, `url` (the euvsdisinfo.eu/report/... page).
- **Articles** (~6,691): `id`, `title`, `content` (HTML), `dateGmt`, `keywords`, `categories`, `articleLanguage[] {slug,name}`, `thumbnailURL`, `url`. Multilingual (e.g. Romanian), so they suit multilingual retrieval.

## How we use it
- **Idea:** bulk-download all cases once into our local DB and index them (claim + fact, plus embeddings). Don't call the MCP at query time, to avoid latency and a dependency on their uptime. Store `retrieved_at`.
- Matching a case = "this narrative has appeared in pro-Kremlin disinformation, according to EUvsDisinfo" → **shown as context or a warning, never on its own as a verdict** ([rules/hard-constraints.md](../rules/hard-constraints.md)). The case's `fact` field plus its links can serve as secondary-source evidence, with the citation.
- The license and terms of reuse need checking (see [data-sources-research.md](data-sources-research.md)).
