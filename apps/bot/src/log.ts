/**
 * Logging without content (messaging-bot.md, step 9 and "Logging"):
 *   - one structured line per event: platform, hashed event id, check_id, latency, outcome;
 *     never message text, never user ids;
 *   - a Chat SDK logger that drops every payload argument and debug/info noise, so webhook bodies
 *     and message text never reach the Vercel logs (runbook test A11).
 */
import type { Logger } from "chat";
import type { Outcome } from "./conversation.js";
import { shortHash } from "./pseudonym.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventLine {
  platform: string;
  event: string;
  check_id: string | null;
  latency_ms: number;
  outcome: Outcome;
}

export type LineSink = (line: string) => void;
let sink: LineSink = (line) => console.log(line);
/** Tests capture lines here. */
export function setLogSink(s: LineSink) {
  sink = s;
}

export async function logEvent(e: { platform: string; eventId: string; checkId: string | null; startedAt: number; outcome: Outcome }) {
  const line: EventLine = {
    platform: e.platform,
    event: await shortHash(e.eventId),
    // The id comes from the API response, so only a UUID is logged; anything else is upstream text.
    check_id: e.checkId && UUID.test(e.checkId) ? e.checkId : null,
    latency_ms: Date.now() - e.startedAt,
    outcome: e.outcome,
  };
  sink(JSON.stringify({ msg: "bot_event", ...line }));
}

/**
 * From a platform API error body, only the machine fields: Discord `{ code, message, errors }` and
 * Meta `{ error: { code } }`: only the numeric code. Messages and field keys are upstream text.
 */
function platformError(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const j = JSON.parse(raw) as { code?: unknown; error?: { code?: unknown } };
    const code = j.code ?? j.error?.code;
    return typeof code === "number" ? { code } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Logs the SDK's own message string (a constant), an error's name, and from a details object only
 * `status`, `method` and the platform's numeric error code. Never payloads, text, ids or tokens.
 */
export function quietLogger(prefix = "chat"): Logger {
  const details = (args: unknown[]) => {
    const out: Record<string, unknown> = {};
    const e = args.find((a) => a instanceof Error) as Error | undefined;
    if (e) out.error_name = e.name;
    const obj = args.find((a) => a && typeof a === "object" && !(a instanceof Error)) as Record<string, unknown> | undefined;
    if (obj) {
      if (typeof obj.status === "number") out.status = obj.status;
      if (typeof obj.method === "string") out.method = obj.method;
      const pe = platformError(obj.error);
      if (pe) out.platform_error = pe;
    }
    return out;
  };
  const line = (msg: string, message: string, args: unknown[]) =>
    sink(JSON.stringify({ msg, at: prefix, text: message, ...details(args) }));
  return {
    child: (p: string) => quietLogger(`${prefix}:${p}`),
    debug: () => {},
    info: () => {},
    warn: (message: string, ...args: unknown[]) => line("sdk_warn", message, args),
    error: (message: string, ...args: unknown[]) => line("sdk_error", message, args),
  };
}
