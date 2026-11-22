/// <reference lib="deno.unstable" />
import type { CheckResponse, CheckStore, ClaimResult } from "@prawdowid/core";

const DAY_MS = 86_400_000;
const DISCORD_API = "https://discord.com/api/v10";
const MAX_LOGGED_CLAIM_LENGTH = 300;

type AlertCheck = Pick<CheckResponse, "check_id" | "status" | "claims">;
type AlertClaim = Pick<ClaimResult, "class" | "verdict" | "text">;
type Digest = (text: string) => Promise<string>;
type DiscordSettings = { recipient: string; token: string };
type AlertReason = "high_risk" | "repeated";
type AlertLease = { state: "sending" } | { state: "sent" };

function unresolvedFact(claim: AlertClaim): boolean {
  return claim.class === "fact" && claim.verdict === "insufficient_evidence";
}

function normalizeClaim(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("pl").trim().replace(/\s+/g, " ");
}

async function postDiscord(
  path: string,
  body: object,
  token: string,
  signal: AbortSignal,
  fetchDiscord: typeof fetch,
): Promise<string> {
  const response = await fetchDiscord(DISCORD_API + path, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`Discord rejected request (${response.status})`);
  const value: unknown = await response.json();
  if (
    typeof value !== "object" || value === null || !("id" in value) ||
    typeof value.id !== "string" || !/^\d{17,20}$/.test(value.id)
  ) throw new Error("Discord response did not contain an ID");
  return value.id;
}

export async function notifyModerator({
  result,
  kv,
  store,
  discord,
  hash,
  fetchDiscord = fetch,
}: {
  result: AlertCheck;
  kv: Deno.Kv;
  store: Pick<CheckStore, "listRecent">;
  discord: DiscordSettings;
  hash: Digest;
  fetchDiscord?: typeof fetch;
}): Promise<void> {
  const claims = result.claims.filter(unresolvedFact);
  if (claims.length === 0 || (result.status !== "ok" && result.status !== "partial")) return;

  const rows = await store.listRecent(200);
  const current = rows.find((row) => row.check_id === result.check_id);
  if (!current) return;

  let claim = claims.find((item) => item.risk === "high");
  let reason: AlertReason = "high_risk";
  if (!claim && current.session_hash) {
    const cutoff = Date.now() - DAY_MS;
    claim = claims.find((item) =>
      item.text.length < MAX_LOGGED_CLAIM_LENGTH &&
      rows.some((row) =>
        row.session_hash && row.session_hash !== current.session_hash &&
        Date.parse(row.created_at) >= cutoff &&
        row.claims.some((previous) =>
          previous.class === "fact" && previous.verdict === "insufficient_evidence" && previous.text &&
          previous.text.length < MAX_LOGGED_CLAIM_LENGTH &&
          normalizeClaim(previous.text) === normalizeClaim(item.text)
        )
      )
    );
    reason = "repeated";
  }
  if (!claim) return;

  const hashValue = await hash(JSON.stringify([
    discord.recipient,
    normalizeClaim(claim.text),
    claim.time,
  ]));
  const key = ["prawdowid", "moderator_alert_v1", hashValue];
  const slot = await kv.get<AlertLease>(key);
  if (slot.value) return;
  const lease = await kv.atomic().check(slot).set(key, { state: "sending" }, { expireIn: 30_000 }).commit();
  if (!lease.ok) return;

  const signal = AbortSignal.timeout(4_000);
  const channelId = await postDiscord(
    "/users/@me/channels",
    { recipient_id: discord.recipient },
    discord.token,
    signal,
    fetchDiscord,
  );
  const detail = reason === "high_risk"
    ? "Brak wystarczających dowodów w sprawie wysokiego ryzyka."
    : "Dwie sesje zgłosiły to samo twierdzenie bez wystarczających dowodów.";
  await postDiscord(
    `/channels/${channelId}/messages`,
    {
      content: `Prawdomat · Sprawdzenie wymaga uwagi\nPowód: ${detail}\nID sprawdzenia: ${result.check_id}`,
      allowed_mentions: { parse: [] },
      nonce: hashValue.slice(0, 25),
      enforce_nonce: true,
    },
    discord.token,
    signal,
    fetchDiscord,
  );
  await kv.atomic().check({ key, versionstamp: lease.versionstamp })
    .set(key, { state: "sent" }, { expireIn: DAY_MS }).commit();
}

export function createModeratorNotifier(
  env: (key: string) => string | undefined,
  store: Pick<CheckStore, "listRecent">,
  hash: Digest,
): (result: AlertCheck) => void {
  const recipient = env("MODERATOR_DISCORD_USER_ID")?.trim();
  if (!recipient || !/^\d{17,20}$/.test(recipient)) return () => {};
  const token = env("DISCORD_BOT_TOKEN")?.trim();
  if (!token) return () => {};

  return (result) => {
    if (!result.claims.some(unresolvedFact)) return;
    void (async () => {
      const kv = await Deno.openKv();
      try {
        await notifyModerator({ result, kv, store, discord: { recipient, token }, hash });
      } finally {
        kv.close();
      }
    })().catch(() => console.warn("prawdomat.moderator_alert_failed"));
  };
}
