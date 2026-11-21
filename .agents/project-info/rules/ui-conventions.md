# UI conventions
Style rules from the user for every screen we build (web app, admin panel, decks, PDFs).

## No uppercase eyebrows
- **Don't put a small, uppercase, letter-spaced label above a title** (e.g. "ARKUSZ" over "Koszt 1000 sprawdzeń"). The user rejected it on 2026-11-21 and the one on `/admin/dokumenty` was removed.
- If a type or category matters, say it in the title, the description or the link text ("Pobierz .xlsx"), not as an extra label.
- Existing exception, not removed by the user: the answer card's "Zdanie 1 z 3" line in the web app ([codebase](../architecture/codebase.md)). Don't copy that pattern elsewhere.

## Supported widths
- **320 px is the narrowest width we support; ultrawide (2560 and 3440 px) must work too** (user, 2026-11-21). Check every screen across that range: no horizontal scroll, nothing stretched across an ultrawide screen.

## Less text
- Cut copy the user doesn't need (same rule as the web app UI copy rule in [codebase](../architecture/codebase.md)).
