# 014: Proprietary license for now, open source maybe later
Date: 2026-11-22 · Status: decided (user: "forbids copying, modifying etc., it's just ours for now; maybe open source in the future")

Context: the repo had no license. Without one, the default is already "all rights reserved", but nothing said so. The jury still has to be able to run the code and reproduce the results ([deliverables](../hackathon/deliverables.md)). If we win, we must transfer the economic copyright to MSZ ([event-and-jury](../hackathon/event-and-jury.md)).

Decision:
- `LICENSE` at the repo root: all rights reserved. No copying, modifying, distributing, hosting for others or using it to train models without written permission.
- A narrow exception: the HackNation 2026 organizers and jury may view, download and run the code and reproduce test results, only to evaluate the submission.
- Third-party dependencies and data keep their own licenses. The notice allows us to relicense (for example as open source) or transfer the rights later.
- `package.json` already has `"private": true`; the README links to `LICENSE`.

Rejected:
- **An open source license now:** the user wants to keep it closed for now; that can change later.
- **No license file:** legally the same, but the jury and visitors would not see our terms or the evaluation permission.
