# The problem
Why Prawdomat exists: the disinformation and verification problem as MSZ frames it. (source: sources/2026-11-21-msz-pelna-tresc-zadania.pdf, sec. 1-2)

- **FIMI:** foreign information manipulation and interference in Poland's information space. MSZ counters it publicly and must also give citizens reliable, understandable and current information about the international situation.
- **Citizens lack an easy way to check a rumour.** Verification methods take skill, and fact-checker sites require going and searching. The challenge asks for a check that is **as easy as sending a message**, through a channel people already use, free of charge.
- **The problem is wider than "fake or not":**
  - true but **outdated** content
  - correct data leading to a **wrong conclusion**
  - **old material recirculated** in a new time or place (out of context)
  - mixes of fact and opinion
  - fast-moving events **where evidence doesn't exist yet**
  - multi-thread questions; screenshots, photos and recordings
- **The generative-AI trap:** a fluent answer isn't a correct one. So the model must not be the source of truth. It understands the question, retrieves and compares material, and writes the answer, while the truth comes from a declared source set.
- **Honest uncertainty is a feature:** the system must say "we don't know" rather than invent one, and show the limits of its knowledge.
- **The service itself is a target:** adversaries may plant instructions in content (prompt injection) or abuse the service.

Who we build for: [audience/overview.md](../audience/overview.md). Requirements: [hackathon/task-brief.md](../hackathon/task-brief.md).

## Statistics that show the problem (for the submission and pitch)
- **77%** of Poles say they have met false information; **91%** believed at least one of 30 tested fake news items (up from 55% in 2024); an average fake reached **34%**. (Digital Poland, "Dezinformacja oczami Polaków", 3rd ed., June 2026, with NASK and Demagog: https://digitalpoland.org/assets/publications/dezinformacja_oczami_polakow_edycja_2026_.pdf)
- In 2025 NASK reported **46,000+** disinformation items to social platforms; platforms removed **12%** and ignored **20%**. (gov.pl, NASK report: https://www.gov.pl/web/cyfryzacja/platformy-spolecznosciowe-a-dezinformacja-w-2025-roku--nowy-raport-nask)
- About **44%** of Polish adults have at least basic digital skills vs ~56% EU average (Eurostat/DESI 2023; from memory, re-check before quoting on slides).
