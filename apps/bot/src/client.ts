/**
 * The only place the bot talks to Prawdowid, over the HTTP contract v1 (hard constraint 18: the
 * bot never imports the verification core):
 *   POST   /api/v1/check         channel "messaging", X-Client-Key, X-End-User; never sends `mock`
 *   DELETE /api/v1/session/:id   "usuń dane"
 *   GET    /api/v1/health        the API's mode, for the `demo:` gate
 * Contract: .agents/project-info/architecture/api-reference.md
 */
import type { CheckRequest, CheckResponse } from "@prawdowid/core/types";
import { type BotConfig, LIMITS } from "./config.ts";
import { validateCheckResponse } from "./validate.ts";

export type CheckOutcome =
  | { kind: "response"; response: CheckResponse }
  /** No valid contract body: unreachable, timeout, non-JSON, or a structural mismatch. Never a verdict. */
  | { kind: "failure"; reason: "timeout" | "network" | "invalid_response"; detail: string };

export interface PrawdowidClient {
  check(req: CheckRequest, endUser: string, signal: AbortSignal): Promise<CheckOutcome>;
  deleteSession(sessionId: string, signal: AbortSignal): Promise<{ ok: boolean; checks: number }>;
  /** The mode this bot effectively gets, from `/health` (cached); `unknown` when it can't be read. */
  mode(signal: AbortSignal): Promise<"live" | "mock" | "unknown">;
}

export function createClient(config: BotConfig, fetchImpl: typeof fetch = fetch): PrawdowidClient {
  const headers = (endUser?: string): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(config.clientKey ? { "X-Client-Key": config.clientKey } : {}),
    ...(endUser ? { "X-End-User": endUser } : {}),
  });
  // `/health` with our key is the authority: it reports `client_mode`, which includes MOCK_CLIENTS.
  // A response's meta.mode is not used: a 429 is answered before the API's mock switch, so it says
  // "live" even for a bot held in mock, and one rate-limited user would turn /demo off for everyone.
  let mode: { value: "live" | "mock"; at: number } | null = null;

  return {
    async check(req, endUser, signal) {
      const body: CheckRequest = { ...req, channel: "messaging" };
      delete body.mock; // the API decides mock vs live, never the bot
      let res: Response;
      try {
        res = await fetchImpl(`${config.apiUrl}/api/v1/check`, {
          method: "POST",
          headers: headers(endUser),
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.apiTimeoutMs)]),
        });
      } catch (e) {
        const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
        return { kind: "failure", reason: timeout ? "timeout" : "network", detail: timeout ? "timeout" : "fetch" };
      }
      // 200, 400, 413 and 429 all carry a CheckResponse: read `status`, not the HTTP code.
      const json = await res.json().catch(() => undefined);
      const v = validateCheckResponse(json);
      if (!v.ok) {
        return { kind: "failure", reason: "invalid_response", detail: `HTTP ${res.status}; ${v.errors.slice(0, 5).join(",")}` };
      }
      return { kind: "response", response: v.response };
    },

    async deleteSession(sessionId, signal) {
      try {
        const res = await fetchImpl(`${config.apiUrl}/api/v1/session/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
          headers: headers(),
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
        const json = await res.json().catch(() => null) as { deleted?: unknown; checks?: unknown } | null;
        return {
          ok: res.ok && json?.deleted === true,
          checks: typeof json?.checks === "number" ? json.checks : 0,
        };
      } catch {
        return { ok: false, checks: 0 };
      }
    },

    async mode(signal) {
      if (mode && Date.now() - mode.at < LIMITS.modeCacheMs) return mode.value;
      try {
        const res = await fetchImpl(`${config.apiUrl}/api/v1/health`, {
          headers: headers(),
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        });
        // `client_mode` (sent to keyed clients) includes MOCK_CLIENTS; `mode` is the API-wide mode.
        const json = await res.json() as { mode?: unknown; client_mode?: unknown };
        const m = json.client_mode ?? json.mode;
        if (m === "live" || m === "mock") {
          mode = { value: m, at: Date.now() };
          return m;
        }
      } catch {
        // fall through
      }
      return "unknown"; // a stale value is not trusted past its TTL
    },
  };
}
