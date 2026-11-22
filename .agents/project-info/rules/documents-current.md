# Documents: always up to date
The user's rule (2026-11-22): our documents must always be up to date. A document is any hosted file we hand to the jury or show on `/admin/dokumenty` ([decision 011](../decisions/011-admin-analytics.md)); the list lives in `apps/web/src/lib/admin/documents.ts`. Today that is the cost Google Sheet and the jury deck (Google Slides).

## The rule
- **Same turn as the change.** When work changes a fact that a document shows (a number, a model, a price, a feature, a metric, a channel, a limit), update the document in that turn, not "later".
- **Edit in place.** Use the Google Sheets / Slides / Docs connector on the same file and link. Never make a new file or a local copy instead. If the connector is missing or not authorised, tell the user and ask.
- **Real numbers only.** Every number points to its source (benchmark result, provider page, NBP); derived cells stay formulas. Read the file back after writing and check what it displays.
- **Wiki and document agree.** The wiki page that owns the fact and the document say the same thing; fix both in the same turn and add a line to `log.md`.
- **New document = new entry.** A new hosted file gets an entry in `documents.ts` (shared "anyone with the link can view") and a row in the table below.

## Documents and their owning pages
| Document | Link | Update rules |
| --- | --- | --- |
| Cost sheet (Google Sheets, tab `Koszty`) | [sheet](https://docs.google.com/spreadsheets/d/1D6go2MeyFnhprEzkjBkmr-XGPP7ujAMxQzEeebbAml0/edit?gid=2131606200) | [cost-sheet.md](cost-sheet.md): triggers, sources, cell map |
| Jury deck (Google Slides) | [deck](https://docs.google.com/presentation/d/1uC4f8bR6BtkHHww_MXOA5SvWwWdSlTkVEySPFjCXwfc/edit?usp=sharing) | [pitch/deck.md](../pitch/deck.md): outline and the source of every number; update after a full benchmark run, a model/price change or a feature landing |
