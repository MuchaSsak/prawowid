# HackNation 2026: event, past editions, jury

Scope: public facts about the HackNation event (both editions), the event-wide regulamin, the judging and pitch format, past MSZ and disinformation tasks, and the PRAWDOWID jury and mentors. Researched on 2026-11-21.

## 1. The event

- **Edition:** the 2nd edition, on 21-22 Nov 2026 at the Bydgoskie Centrum Targowo-Wystawiennicze (ul. Gdańska 187), Bydgoszcz. Organizers: Ministerstwo Cyfryzacji (GovTech Polska department) and Miasto Bydgoszcz. It bills itself as "the largest implementation hackathon in Poland" (hackathon wdrożeniowy). Sources: https://hacknation.pl/, https://www.chip.pl/2026/11/hacknation-wraca-do-bydgoszczy-w-dobe-powstana-pomysly-na-sprawniejsze-panstwo
- **Tasks:** 15 partner tasks, with a total pool of 370,000 PLN. PRAWDOWID (MSZ) has a main prize of **30,000 PLN gross** and only one prize. In June 2026, 30 institutions attended challenge-design workshops. Sources: https://hacknation.pl/, https://www.gov.pl/web/cyfryzacja/hacknation-2026-zaczyna-sie-od-dobrego-wyzwania-za-nami-warsztaty-dla-instytucji-publicznych
- **Related tasks running in parallel:** "Kolekcjoner fejków" (NASK, fake celebrity scam ads) and "#InvestWatch" (KNF). Other teams may build overlapping disinformation tooling, so our framing should stay citizen-facing and grounded in trusted sources.

### Timeline (from https://hacknation.pl/ and https://hacknation.pl/przewodnik-uczestnika)

| When | What |
|---|---|
| Sat 21.11, 11:00 | Full tasks published, coding starts, HackTribe submissions open |
| **Sat 21.11, 20:00** | **HackTribe draft deadline.** The project must exist by then with the task, team name, repo, table number and a preliminary description. After 20:00 no new projects can be created and the task can't be changed. |
| **Sun 22.11, 11:00** | **Final submission deadline ("Termin to termin").** Coding ends and Stage I judging starts. Changes made after the deadline are ignored (event regulamin §5.9). |
| Sun 22.11, 14:45 | Finalists announced on the HackNation Discord |
| Sun 22.11, 15:15 | Live pitches (Stage II) |
| Sun 22.11, 17:15 | Awards and closing ceremony |

### Judging format (event regulamin §5: https://hacknation.pl/api/public/dokumenty/28c74284-6390-4665-b8aa-bf4367db79c0/regulamin-hacknation_19.11.pdf)

- **Stage I:** the task jury scores the HackTribe submissions against the task criteria. The **top 5 teams** per task go to Stage II.
- **Stage II:** a **live pitch of at most 5 minutes, then at most 5 minutes of jury Q&A**. Stage I scores **do not carry over** to the final (participant guide).
- The jury decides by simple majority, and the chair breaks ties. Decisions are final.
- The jury may award nothing if no solution reaches **50% of the maximum points**.
- The PRAWDOWID task regulamin overrides the event regulamin where they differ (task regulamin §5.2).
- In 2025, the format was 3 finalists per task. In 2026 it is 5 (https://www.gov.pl/web/cyfryzacja/tysiace-pomyslow-24-godziny-i-jeden-cel--usprawnic-panstwo-w-bydgoszczy-zakonczyl-sie-hacknation-2025).

### Event-wide rules

- **Team:** 1-6 people. A team can enter at most 2 tasks, with one project per task (FAQ: https://hacknation.pl/faq).
- **Submissions:** go to HackTribe, which requires a Discord account. Teams can submit unfinished work and keep editing until 11:00.
- **AI tools:** neither the event regulamin nor the FAQ has an explicit AI-tool policy. The FAQ says pre-existing or external resources, tools and repos are allowed **if cited or disclosed in the presentation or code**. **Assumption:** using AI coding assistants is fine, and disclosing them, along with any reused libraries, is the safe choice.
- **IP:** under the event regulamin §6, each participant declares authorship and that the work is free of third-party legal defects. Under PRAWDOWID regulamin §3-4, the **winners must sign a written transfer of economic copyright to MSZ within 7 days**, or they lose the prize. All co-authors must sign. The prize is paid within 7 days of signing and split equally unless the team declares otherwise. Third-party licenses need care, because the work must be "free of legal defects".
- **Eligibility:** adult EU citizens or EU residents only.
- **Prize payer:** MSZ (Biuro Transformacji Cyfrowej, director Joanna Kociankowska-Bożek), per the task regulamin §1.3.

### Task-specific formal requirements (already in hackathon/ files; repeated because Stage I is a paper review)

These come from the full task text, section 4. The submission needs:
- a description of up to 4,000 characters
- a **PDF of at most 12 slides** covering the problem, users, architecture, demo, test results, risks and next steps
- a **demo video of at most 3 minutes**
- a repo with run instructions
- architecture, sources and licenses, test results with reproduction data, and a risk list

The participant guide separately recommends a demo of about 2 minutes. **Assumption:** the 3-minute task limit wins, but aim for about 2 minutes.

## 2. Past editions and winners

- **HackNation 2025 (1st edition):** 6-7 Dec 2025, same venue. Over 1,500 participants, over 250 mentors, 437 solutions, 16 tasks, 25,000 PLN per winning team, and Deputy PM and Foreign Minister Radosław Sikorski presented awards. Sources: https://www.gov.pl/web/cyfryzacja/tysiace-pomyslow-24-godziny-i-jeden-cel--usprawnic-panstwo-w-bydgoszczy-zakonczyl-sie-hacknation-2025, https://www.chip.pl/2025/12/hacknation-2025-relacja
- **The 2025 MSZ task was "Scenariusze jutra"**, a geopolitical scenario forecasting tool using NLP, deep research and scenario modelling, tested on a fictional EU/NATO state "Atlantis". It was co-authored by the MSZ Department of Strategy, the **Biuro Transformacji Cyfrowej** and the IT and telecom bureau. **25 teams** took part, and the project **AIDA** won. Source: https://www.gov.pl/web/diplomacy/deputy-prime-minister-radoslaw-sikorski-attends-hacknation-2025. No public repo or technical writeup of AIDA was found.
- **The 2025 disinformation-adjacent task was "Prawda w sieci"** (COI), won by team "no signal". No description, repo or writeup was found.
- **What the 2025 juries rewarded:**
  - Official coverage says the jury picked the solution "with the greatest implementation potential" (https://wit.pwr.edu.pl/en/news/white-hats-win-hacknation-2025-370.html).
  - The winning MSiT team plugged into a tool officials already use (a Word add-in) and prioritised a simple UI.
  - A 2025 finalist's lessons (https://solvro.pwr.edu.pl/en/blog/hacknation-2025/):
    - The jury asked for a **live demo of a concrete use case** instead of the prepared Figma slides.
    - **Full automation** (no manual steps) was a differentiator.
    - Dashboards readable in about 3 seconds were appreciated.
- **2025 deployment outcomes:** no confirmed public deployments were found. Winners were offered continued work with the institution.

## 3. PRAWDOWID jury and mentors

- **Jury:** the task regulamin §2 says the jury has at least 3 MSZ-appointed subject experts, published "no later than the event start day". The event regulamin §5.3 says "no later than day 2". **As of this research the jury is not published** on hacknation.pl, /zadania, /mentorzy or in any indexed news. Check the Discord channel "Prawdowid" and the MSZ booth. **Assumption:** the jury overlaps with the MSZ mentor team (Biuro Transformacji Cyfrowej plus the strategic communication and disinformation department).
- **Mentor team** (task text section 10, plus public bios from https://hacknation.pl/mentorzy; professional info only):

| Mentor | Public role and field | What they will probe |
|---|---|---|
| Agnieszka Wonicka | Project manager, **MSZ Biuro Transformacji Cyfrowej**: AI adoption in public administration, responsible and secure use of new tech | Real admin need, deployability, responsible AI |
| Anna Tobor-Rupniak | Business analyst, **MSZ Biuro Transformacji Cyfrowej**: process analysis, requirements, backlog | Clear user flows, process diagrams, scope |
| Edyta Iwaniuk | **MSZ Departament Komunikacji Strategicznej i Przeciwdziałania Dezinformacji**. Former reporter and editor for about 20 years, NGO counter-disinformation projects | Journalistic sourcing quality, citizen language |
| Dr Piotr Sosnowski | Analyst at MSZ: international security, **FIMI research**, member of the EU Horizon project **SAUFEX** (FIMI detection and analysis systems, interoperability; https://cordis.europa.eu/project/id/101132494) | FIMI vocabulary, interoperability, data exchange |
| Konrad Gałczyński | Radca generalny at MSZ: **international cyber-security policy, cyber-diplomacy** (NATO, EU) | Security, abuse, prompt injection, data location |
| Patryk Grażewicz | OSINT analyst and fact-checker at **Stowarzyszenie Pravda (IFCN)**, investigation lead at Corsearch. Topics: Russian FIMI, radicalism | Professional fact-checking method, IFCN standards, evidence |
| Tomasz Szmidt (listed in the task as "Schmidt") | AI Product Engineering Lead at WithSecure. Background in cyber-security and data science; "data, not opinions"; turns ideas into MVPs | Working MVP, measured results, security |
| Aleksandra Wójtowicz | Not on the public mentor page. **No public professional info found.** | Unknown |
| Jarosław Karaś | Not on the public mentor page. **No public professional info found.** | Unknown |
| Rafał Mielańczuk | Not on the public mentor page. **No public professional info found.** | Unknown |

## 4. MSZ context: FIMI and disinformation

- **Departament Komunikacji Strategicznej i Przeciwdziałania Dezinformacji (DKS):** set up in Aug 2024. Director Magdalena Piecuch-Kęska. Tasks: "monitoring, analyzing, and countering disinformation and foreign information influence", building "resilience", and EU regulatory work (https://www.gov.pl/web/diplomacy/department-for-strategic-communications-and-countering-foreign-disinformation).
- **How MSZ frames it** (https://www.gov.pl/web/diplomacy/strategic-communication-and-countering-foreign-disinformation):
  - Disinformation is "false or manipulated content that could harm Poland and its international position".
  - The goal is long-term "societal resilience to information threats", not only reacting to incidents.
  - Embassies are "the first line of defence".
  - It takes part in the EU Rapid Alert System (RAS).
  - It coordinates the Interministerial Group for Counteracting FIMI.
- **Plenipotentiary for Countering International Disinformation:** Tomasz Chłoń. He chairs the **Advisory Council for Resilience to International Disinformation** (Rada Odporności), which first met on 3 Apr 2025. Its recommendations call for (https://www.gov.pl/web/diplomacy/recommendations-of-the-advisory-council-for-resilience-to-international-disinformation-to-the-minister-of-foreign-affairs-on-countering-disinformation-in-the-information-environment):
  - DSA and AI Act implementation
  - data sharing among institutions, fact-checkers, platforms and media
  - funding **domestic anti-disinformation technologies**
  - supporting fact-checkers and NGOs, with a focus on **seniors and vulnerable groups**
  - prebunking and media literacy
  - fast public warnings about dangerous campaigns
  - priority for EU and NATO cooperation
- **The MSZ Foreign Policy Strategy 2026-2030** names FIMI among its challenges (https://www.gov.pl/web/diplomacy/strategy).
- **Biuro Transformacji Cyfrowej** ran a 2025 market consultation on an **AI-supported tool for monitoring internet sources**. This is a sign of real procurement interest (search result pointing to gov.pl attachments; not read in full, so treat it as **Assumption-level detail**).

## Not found

- The PRAWDOWID jury composition.
- Public professional info for A. Wójtowicz, J. Karaś and R. Mielańczuk.
- Repos or writeups for the 2025 winners AIDA (MSZ) and "no signal" (COI).
- Any HackNation-wide AI-tool policy.
