/** Normalization used to locate spans and quotes: whitespace, typographic quotes, dashes. Never case. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[“”„‟«»″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\s ]+/g, " ")
    .trim();
}

/** True when `needle` occurs verbatim in `haystack` after normalization. */
export function containsVerbatim(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  if (n.length < 3) return false;
  return normalizeForMatch(haystack).includes(n);
}

/** Lowercase, strip diacritics, keep letters/digits: for lexical ranking only. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ł/g, "l")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
