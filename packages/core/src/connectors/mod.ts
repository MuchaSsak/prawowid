import { corpusSearch } from "./corpus.ts";
import { googleFactCheck } from "./google-factcheck.ts";
import { sejmEli } from "./sejm-eli.ts";
import type { Connector } from "./types.ts";

/**
 * The deployment profile: which routes exist. Only implemented routes are listed; scope we do not
 * cover yet (GUS, NBP, Eurostat, Sejm votings, institutions' press releases) is disclosed in
 * `limitations`, not faked.
 */
export const CONNECTORS: Connector[] = [googleFactCheck, sejmEli, corpusSearch];

export const NOT_YET_COVERED =
  "Na razie szukamy w: Google Fact Check (weryfikacje Demagogu, AFP Sprawdzam, Konkret24 i innych) oraz w bazie aktów prawnych Sejmu (ELI). Danych GUS, NBP, Eurostatu, głosowań Sejmu i komunikatów instytucji jeszcze nie sprawdzamy.";

export * from "./types.ts";
