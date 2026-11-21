/**
 * Output safety (hard constraints 2 and 10). Every string in an API response is untrusted: model
 * fields, citation titles, excerpts and publishers, the article title, warnings. Before any of it
 * reaches a chat it is turned into inert plain text:
 *   - NFKC normalization,
 *   - zero-width, bidi and control characters stripped,
 *   - markdown and links removed (a link becomes its defanged host),
 *   - bare domains defanged (`example[.]com`) so WhatsApp doesn't auto-link them,
 *   - mentions neutralized (`@everyone`, `@here`, `<@…>`, `<#…>`, `<@&…>`).
 * The only links the bot ever posts are https citation URLs and the web app URL (see safeUrl).
 */

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const URL_RE = /\b(?:https?|ftp):\/\/[^\s<>"]+|\bwww\.[^\s<>"]+/gi;
const MD_LINK = /!?\[([^\]]*)\]\(([^)]*)\)/g;
/** host-like tokens: at least one 2+ char label, then a letter-only TLD. Skips "m.in", "1.5", "art.5". */
const BARE_DOMAIN = /\b((?:[\p{L}\p{N}-]{2,}\.)+)(\p{L}{2,24})\b/gu;

function defangHost(raw: string): string {
  try {
    const u = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
    return u.hostname.replaceAll(".", "[.]");
  } catch {
    return "[link]";
  }
}

export function sanitizeText(input: unknown, maxChars = 600): string {
  if (typeof input !== "string") return "";
  let s = input.normalize("NFKC").replace(INVISIBLE, "").replace(CONTROL, " ");
  s = s.replace(/[\r\n\t]+/g, " ");
  // Markdown links → their label (the target is dropped), then raw URLs → defanged host.
  s = s.replace(MD_LINK, (_m, label: string) => label);
  s = s.replace(URL_RE, (m) => defangHost(m));
  s = s.replace(BARE_DOMAIN, (_m, labels: string, tld: string) => `${labels.replaceAll(".", "[.]")}${tld}`);
  // Markdown and chat formatting characters.
  // Underscores only at word edges (`_italic_`), so identifiers like OPENROUTER_API_KEY survive.
  s = s.replace(/[*~`|]/g, "").replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "").replace(/^\s*[#>]+\s*/g, "");
  // Mentions and Discord entity syntax: `@` → fullwidth `＠` (applied after NFKC, so it stays),
  // and angle brackets → look-alikes so `<@id>`, `<#id>` and `<url>` can never form.
  s = s.replace(/@/g, "＠").replace(/</g, "‹").replace(/>/g, "›");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s.length > maxChars ? `${s.slice(0, maxChars - 1).trimEnd()}…` : s;
}

/**
 * A citation or web-app URL that may be posted as a link: https only, no credentials, normalized
 * by the URL parser (which percent-encodes `<`, `>` and spaces). `@` in the path is encoded too,
 * so it can't read as a mention. Anything else returns null and is not posted.
 */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
  return u.href.replace(/@/g, "%40");
}
