# Cost sheet: keep it current, real numbers only
The user's rule (2026-11-21): the cost sheet must always be up to date and hold real numbers. It is one case of [documents-current.md](documents-current.md). It is the deliverable "cost of 1,000 queries, channel maintenance cost, behaviour under load" ([deliverables.md](../hackathon/deliverables.md)) and is shown on `/admin/dokumenty` ([decision 011](../decisions/011-admin-analytics.md)).

**Where:** Google Sheet https://docs.google.com/spreadsheets/d/1D6go2MeyFnhprEzkjBkmr-XGPP7ujAMxQzEeebbAml0/edit?gid=2131606200, tab `Koszty`. Edit it in place with the Google Sheets connector (same file, same link). If the connector is missing, tell the user and ask; never make a new file or a local copy instead.

## When to update it (same turn as the change)
- A full benchmark run (`bun run eval`, `eval:organizer`): new cost per 100 checks and median latency from `eval/results/latest*.md`. Quick runs (6 cases) are too small; don't use them.
- A model, provider or price change ([model-selection.md](../architecture/model-selection.md)).
- A hosting plan, channel or operator fee change (new channel, a paid operator such as SMS, Vercel/Deno/Supabase plan).
- A rate limit or quota change in `apps/api/main.ts` or the bot (e.g. the bot's daily quota, or the API limits in `apps/api/rate-limit.ts` / `main.ts`).
- Any time you edit the sheet: refresh the USD/PLN rate from NBP (`https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json`) and put its date in the source cell.

## Real numbers
- Measured beats estimated: cost and latency come from benchmark results, prices from the provider's live page or API, the rate from NBP. Never type a number you can't point to.
- Every input's source is in column C (`benchmark, 50 przypadków`, `NBP, 20.11.2026`). An estimate says `szacunek`, an unverified price says `do potwierdzenia`; replace them with measured or verified values as soon as they exist (the image cost was measured this way on 2026-11-22 from the screenshot cases F01/F02).
- Derived cells stay formulas over the inputs; never overwrite one with a typed result.
- After writing, read the sheet back (`get_values`) and check the displayed numbers.

## Keep it small
The user wants it minimal: costs table, inputs with sources, three load lines, one footnote. Update values in place; add a row only when the brief needs it (e.g. a new channel's operator fee). No long notes.

Cell map: B4 text/link per 1,000 · B5 with an image (`=B13*10*(1+B12)`) · B6 monthly maintenance (`=SUM(B23:B25)`) · B7 operator fee for web/Discord/Messenger ($0) · B10 USD/PLN · B11 measured cost per 100 text checks · B12 buffer · B13 measured cost per 100 image checks (benchmark screenshot cases; image cost includes the OCR call) · B16 median latency (`=B34`) · B17-B18 limit, failure behaviour · A20 footnote · A22:C25 maintenance plans (inputs, Deno/Supabase/Vercel Pro) · A27:D31 monthly cost at 4 volumes (A28:A31 inputs; A31 = service cap 4,000/day × 30, note on the cell) · A33:C36 latency median, p90, MVP target (inputs from the benchmark). Charts right of the tables, anchored at F2 and F17: stacked column 'Koszt miesięczny a liczba sprawdzeń' over A27:C31, bar 'Czas odpowiedzi a cel MVP' over A33:B36 (colors: reference palette blue #2a78d6 / orange #eb6834, target bar gray). After a full benchmark run also update B34:B35. WhatsApp rows removed 2026-11-22 ([decision 015](../decisions/015-no-whatsapp.md)).

After any update, sync the numbers in [deliverables.md](../hackathon/deliverables.md) and add a line to `log.md`.
