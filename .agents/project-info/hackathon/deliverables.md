# Submission deliverables
A checklist of everything we must submit. (source: sources/2026-11-21-msz-pelna-tresc-zadania.pdf, sec. 4-5)

- [ ] Team name, solution title, and a **description of at most 4,000 characters**
- [ ] **PDF presentation, at most 12 slides**: problem, users, architecture, demo, test results, risks, next steps. **Drafted (2026-11-21)** as a 10-slide Google Slides deck with speaker notes ([pitch/deck.md](../pitch/deck.md)); still to do: fill the video frames and team name, then export to PDF
- [ ] **Demo video, at most 3 minutes**, available via a link
- [ ] A **link to the code repo** with run instructions (the jury must be able to run it themselves)
- [ ] A short description of the architecture, data flow, models used, vendors and main limitations
- [ ] A description of the sources used: their **licenses**, how they qualify and how they are updated
- [ ] **Test results per sec. 6, with the data needed to reproduce them** (see [judging-and-metrics.md](judging-and-metrics.md))
- [ ] A short list of the main risks, covering at least **hallucinations, source bias, privacy, prompt injection, availability and abuse**
- [ ] Estimates: cost of 1,000 queries, channel maintenance cost, behaviour under load. **Drafted (2026-11-21)** as one short Google Sheet (https://docs.google.com/spreadsheets/d/1D6go2MeyFnhprEzkjBkmr-XGPP7ujAMxQzEeebbAml0/edit?gid=2131606200), card on `/admin/dokumenty`. Kept deliberately small (user: "way less text"): 1,000 text/link checks ≈ $1.18 (measured $0.098 per 100 + 20% buffer), with an image ≈ $2.28 (image add-on estimated), channels ≈ $65 a month on paid tiers (Deno Deploy Pro 20 + Supabase Pro 25 + Vercel Pro 20; $0 on free tiers), WhatsApp ≈ $9 per 1,000 replies (Meta price unverified), web/Discord/Messenger $0, no SMS channel; under load: median 6.4 s, per user 12/min, 150/h, 600/day, service cap 4,000 live checks/day, a hit limit or outage = system message, not a verdict. USD/PLN 4.0613 (NBP, 2026-11-20). Still to do: summarise in the README
- [ ] A disclosed list of the cases the system does not support

This can all go in the README or in short separate files.
**Optional extras that earn credit:** a public demo, a Docker container, an OpenAPI spec, mockups of further channels, a quality dashboard, research materials.
**Never in the repo or the demo materials:** API keys, personal data, secrets.
