/**
 * Output safety (hard constraints 2 and 10). Every string in an API response is untrusted: model
 * fields, citation titles, excerpts and publishers, the article title, warnings. Before any of it
 * reaches a chat it is turned into inert plain text:
 *   - NFKC normalization,
 *   - zero-width, bidi and control characters stripped,
 *   - markdown and links removed (a link becomes its defanged host),
 *   - bare domains defanged (`example[.]com`) so chat apps don't auto-link them,
 *   - mentions neutralized (`@everyone`, `@here`, `<@…>`, `<#…>`, `<@&…>`).
 * The only links the bot ever posts are https citation URLs and the web app URL (see safeUrl).
 */

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const URL_RE = /\b(?:https?|ftp):\/\/[^\s<>"]+|\bwww\.[^\s<>"]+/gi;
const MD_LINK = /!?\[([^\]]*)\]\(([^)]*)\)/g;
/** host-like tokens: labels then a letter-only TLD ("a.pl", "x.com"). Skips "1.5" and "art.5". */
const BARE_DOMAIN = /(?<![\p{L}\p{N}-])((?:[\p{L}\p{N}-]+\.)+)(\p{L}{2,24})(?![\p{L}\p{N}])/gu;
/** Polish abbreviations that look like domains. */
const NOT_DOMAINS = new Set(["m.in", "m.st"]);

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
  // Markdown links → their label (the target is dropped).
  s = s.replace(MD_LINK, (_m, label: string) => label);
  // Formatting characters go before the link passes, so `example.*org*` can't re-form a domain.
  // Underscores only at word edges (`_italic_`), so identifiers like OPENROUTER_API_KEY survive.
  s = s.replace(/[*~`|]/g, "").replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "").replace(/^\s*[#>]+\s*/g, "");
  // Raw URLs → defanged host, then bare domains.
  s = s.replace(URL_RE, (m) => defangHost(m));
  s = s.replace(BARE_DOMAIN, (m: string, labels: string, tld: string, offset: number, all: string) => {
    // "m.in." in prose is an abbreviation; "m.in/x" is a link.
    const prose = /^(?:\.|\s|,|$)/.test(all.slice(offset + m.length, offset + m.length + 1));
    return NOT_DOMAINS.has(m.toLowerCase()) && prose ? m : `${labels.replaceAll(".", "[.]")}${tld}`;
  });
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
export function safeUrl(input: unknown, maxLength = 2000): string | null {
  if (typeof input !== "string" || input.length > maxLength) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
  const href = u.href.replace(/@/g, "%40");
  return href.length > maxLength ? null : href; // measured after encoding, which can grow it a lot
}
