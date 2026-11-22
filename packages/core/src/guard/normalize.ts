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

/** What a person may type differently from the model's copy: case and Polish letters ("odbyl" vs "odbył"). */
export function foldTyping(text: string): string {
  return normalizeForMatch(text).toLocaleLowerCase("pl").normalize("NFD").replace(/\p{M}+/gu, "").replace(/ł/g, "l").normalize("NFC");
}

/**
 * True when `needle` occurs verbatim in `haystack` after normalization. `ignoreCase` is only for
 * claim spans copied from what a person typed (people write "robert lewandowski" or "czy w hiszpanii
 * odbyl sie strajk", the model copies "Robert Lewandowski" or "odbył się") and may lack the final
 * full stop or question mark the model adds: case and Polish letters are ignored. Quotes from
 * sources stay exact.
 */
export function containsVerbatim(haystack: string, needle: string, opts: { ignoreCase?: boolean } = {}): boolean {
  const norm = (s: string) => (opts.ignoreCase ? foldTyping(s) : normalizeForMatch(s));
  const n = opts.ignoreCase ? norm(needle).replace(/[.!?]+$/, "").trimEnd() : norm(needle);
  if (n.length < 3) return false;
  const h = norm(haystack);
  if (h.includes(n)) return true;
  // Lines of one record quoted together ("Akt: …\nData aktu: …"): every line must be verbatim.
  const lines = needle.split(/\n+/).map((l) => norm(l)).filter(Boolean);
  return lines.length > 1 && lines.every((l) => l.length >= 3 && h.includes(l));
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
