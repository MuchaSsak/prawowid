/**
 * The conversation, the same for every platform and for the console channel:
 *   intake → (quota, from M1b) → API client → validate → sanitize + render
 * Every platform handler calls `converse`, so one input gives one answer on every channel
 * (scenario G). It never throws and always returns a reply: one 45 s deadline per request covers
 * the image download and the API call, and any failure becomes the system message "Nie mogliśmy
 * wykonać sprawdzenia. To nie jest ocena treści." (messaging-bot.md, steps 2 and 8).
 */
import { type BotConfig, LIMITS, type Surface } from "./config.js";
import type { PrawdowidClient } from "./client.js";
import { type IncomingMessage, toIntent } from "./intake.js";
import { pseudonym } from "./pseudonym.js";
import { renderDeleted, renderFailure, renderHelp, renderLocal, renderResponse } from "./render.js";

export type Outcome = "ok" | "system_state" | "technical_error" | "timeout" | "quota";

export interface Turn {
  surface: Surface;
  /** Platform user id (Discord id, WhatsApp wa_id, Messenger PSID). Only its HMAC leaves the bot. */
  userId: string;
  message: IncomingMessage;
  /** `help` and `delete_data` come straight from Discord's /pomoc and /usun-dane. */
  command?: "help" | "delete_data";
}

export interface Reply {
  /** Native platform text; `null` = send nothing (a sticker). */
  text: string | null;
  outcome: Outcome;
  checkId: string | null;
}

export interface ConversationDeps {
  config: BotConfig;
  client: PrawdowidClient;
  /** The HMAC key for pseudonyms (pseudonym.ts resolveIdSecret). */
  idSecret: string;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}

class DeadlineError extends Error {}

async function run(turn: Turn, deps: ConversationDeps, signal: AbortSignal): Promise<Reply> {
  const { config, client } = deps;
  const o = { surface: turn.surface, webUrl: config.webUrl };
  const intent = turn.command ? { kind: turn.command } as const : await toIntent(turn.message, signal, deps.fetchImpl);

  switch (intent.kind) {
    case "ignore":
      return { text: null, outcome: "ok", checkId: null };
    case "help": {
      const mode = await client.mode(signal);
      return { text: renderHelp({ ...o, mode, controller: config.controller }), outcome: "ok", checkId: null };
    }
    case "local":
      return { text: renderLocal(intent.reason, o), outcome: "ok", checkId: null };
    case "delete_data": {
      const id = await pseudonym(deps.idSecret, turn.surface, turn.userId);
      const r = await client.deleteSession(id, signal);
      return { text: renderDeleted(r, o), outcome: r.ok ? "ok" : "technical_error", checkId: null };
    }
    case "check": {
      // `demo:<scenario>` only while the API answers this bot in mock mode; otherwise a live check
      // would run on a synthetic prompt (runbook test A7).
      if (intent.demo && (await client.mode(signal)) !== "mock") {
        return { text: renderLocal("demo_unavailable", o), outcome: "ok", checkId: null };
      }
      const id = await pseudonym(deps.idSecret, turn.surface, turn.userId);
      const result = await client.check(
        // The chat app, for the admin channel split; the console is not one.
        { ...intent.request, session_id: id, ...(turn.surface === "console" ? {} : { platform: turn.surface }) },
        id,
        signal,
      );
      if (result.kind === "failure") {
        if (signal.aborted) throw new DeadlineError();
        return { text: renderFailure(o), outcome: result.reason === "timeout" ? "timeout" : "technical_error", checkId: null };
      }
      const res = result.response;
      return {
        text: renderResponse(res, o),
        outcome: res.status === "ok" || res.status === "partial" ? "ok" : "system_state",
        checkId: res.check_id,
      };
    }
  }
}

/** Never throws. Always resolves within the deadline (plus a few ms). */
export async function converse(turn: Turn, deps: ConversationDeps): Promise<Reply> {
  const o = { surface: turn.surface, webUrl: deps.config.webUrl };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new DeadlineError());
      reject(new DeadlineError());
    }, deps.deadlineMs ?? LIMITS.requestDeadlineMs);
  });
  try {
    return await Promise.race([run(turn, deps, controller.signal), deadline]);
  } catch (e) {
    return { text: renderFailure(o), outcome: e instanceof DeadlineError ? "timeout" : "technical_error", checkId: null };
  } finally {
    clearTimeout(timer);
  }
}
