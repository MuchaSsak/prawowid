# Cost sheet: keep it current, real numbers only
The user's rule (2026-11-21): the cost sheet must always be up to date and hold real numbers. It is the deliverable "cost of 1,000 queries, channel maintenance cost, behaviour under load" ([deliverables.md](../hackathon/deliverables.md)) and is shown on `/admin/dokumenty` ([decision 011](../decisions/011-admin-analytics.md)).

**Where:** Google Sheet https://docs.google.com/spreadsheets/d/1D6go2MeyFnhprEzkjBkmr-XGPP7ujAMxQzEeebbAml0/edit?gid=2131606200, tab `Koszty`. Edit it in place with the Google Sheets connector (same file, same link). If the connector is missing, tell the user and ask; never make a new file or a local copy instead.

## When to update it (same turn as the change)
- A full benchmark run (`bun run eval`, `eval:organizer`): new cost per 100 checks and median latency from `eval/results/latest*.md`. Quick runs (6 cases) are too small; don't use them.
- A model, provider or price change ([model-selection.md](../architecture/model-selection.md)).
- A hosting plan, channel or operator fee change (new channel, WhatsApp/SMS live, Vercel/Deno/Supabase plan).
- A rate limit or quota change in `apps/api/main.ts` or the bot (e.g. the bot's daily quota, or the API limits in `apps/api/rate-limit.ts` / `main.ts`).
- Any time you edit the sheet: refresh the USD/PLN rate from NBP (`https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json`) and put its date in the source cell.

## Real numbers
- Measured beats estimated: cost and latency come from benchmark results, prices from the provider's live page or API, the rate from NBP. Never type a number you can't point to.
- Every input's source is in column C (`benchmark, 50 przypadków`, `NBP, 20.11.2026`). An estimate says `szacunek`, an unverified price says `do potwierdzenia`; replace them with measured or verified values as soon as they exist (e.g. measure the image add-on from a run with screenshots).
- Derived cells stay formulas over the inputs; never overwrite one with a typed result.
- After writing, read the sheet back (`get_values`) and check the displayed numbers.

## Keep it small
The user wants it minimal: costs table, inputs with sources, three load lines, one footnote. Update values in place; add a row only when the brief needs it (e.g. a new channel's operator fee). No long notes.

Cell map: B4 text/link per 1,000 · B5 with an image · B6 monthly maintenance (input) · B7 WhatsApp per 1,000 replies · B8 free channels · B11 USD/PLN · B12 measured cost per 100 · B13 buffer · B14 image add-on · B15 WhatsApp fee per reply · B18-B20 load lines (median latency, limit, failure behaviour) · A22 footnote (what maintenance covers, no SMS).

After any update, sync the numbers in [deliverables.md](../hackathon/deliverables.md) and add a line to `log.md`.
