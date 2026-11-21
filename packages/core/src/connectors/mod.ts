import { corpusSearch } from "./corpus.ts";
import { eurostat } from "./eurostat.ts";
import { googleFactCheck } from "./google-factcheck.ts";
import { gus } from "./gus.ts";
import { nbp } from "./nbp.ts";
import { sejmEli } from "./sejm-eli.ts";
import type { Connector } from "./types.ts";

/**
 * The deployment profile: which routes exist. Only implemented routes are listed; scope we do not
 * cover yet (Sejm votings, institutions' press releases, regional statistics) is disclosed in
 * `limitations`, not faked. Source allowlist: sources/catalog.ts.
 */
export const CONNECTORS: Connector[] = [googleFactCheck, sejmEli, eurostat, nbp, gus, corpusSearch];

export const NOT_YET_COVERED =
  "Szukamy tylko w zaufanych źródłach: weryfikacje certyfikowanych fact-checkerów (m.in. Demagog, AFP Sprawdzam, Reuters, AP) przez Google Fact Check, akty prawne Sejmu (ELI) oraz dane Eurostatu, NBP i GUS dla wybranych wskaźników. Głosowań Sejmu, komunikatów instytucji i danych regionalnych jeszcze nie sprawdzamy.";

export * from "./types.ts";
