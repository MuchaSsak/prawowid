/**
 * Logging without content (messaging-bot.md, step 9 and "Logging"):
 *   - one structured line per event: platform, hashed event id, check_id, latency, outcome;
 *     never message text, never user ids;
 *   - a Chat SDK logger that drops every payload argument and debug/info noise, so webhook bodies
 *     and message text never reach the Vercel logs (runbook test A11).
 */
import type { Logger } from "chat";
import type { Outcome } from "./conversation.ts";
import { shortHash } from "./pseudonym.ts";

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
    check_id: e.checkId,
    latency_ms: Date.now() - e.startedAt,
    outcome: e.outcome,
  };
  sink(JSON.stringify({ msg: "bot_event", ...line }));
}

/**
 * From a platform API error body, only the machine fields: Discord `{ code, message, errors }` and
 * Meta `{ error: { code, message } }` carry error codes and field paths, never the message we sent.
 */
function platformError(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const j = JSON.parse(raw) as { code?: unknown; message?: unknown; errors?: unknown; error?: { code?: unknown; message?: unknown } };
    const codes: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (!v || typeof v !== "object") return;
      for (const [k, val] of Object.entries(v)) {
        if (k === "_errors" && Array.isArray(val)) {
          for (const e of val) codes.push(`${path}:${(e as { code?: string }).code}`);
        } else walk(val, path ? `${path}.${k}` : k);
      }
    };
    walk(j.errors, "");
    const code = j.code ?? j.error?.code;
    const message = j.message ?? j.error?.message;
    return {
      ...(typeof code === "number" || typeof code === "string" ? { code } : {}),
      ...(typeof message === "string" ? { message: message.slice(0, 120) } : {}),
      ...(codes.length ? { fields: codes.slice(0, 5) } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Logs the SDK's own message string (a constant), an error's name, and from a details object only
 * `status`, `method` and the platform's error code/message. Never payloads, text, ids or tokens.
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
