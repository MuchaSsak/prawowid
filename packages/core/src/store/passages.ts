/**
 * Splitting corpus documents into passages (scripts/build_corpus_index.ts).
 * A passage keeps subject, date and place together (single sentences lost them) and stays short
 * enough to quote. Every passage is a literal slice of the document, so start/end offsets and the
 * verbatim quote check hold.
 */

export const PASSAGE_TARGET = 800;
export const PASSAGE_MIN = 25;

/** Sentence spans [start, end) in `text`: a break after . ! ? … followed by an uppercase letter or digit. */
export function sentenceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const boundary = /[.!?…](?=\s+["„(]?[A-ZĄĆĘŁŃÓŚŹŻА-ЯЁЇІЄҐ0-9])/gu;
  let start = 0;
  for (const m of text.matchAll(boundary)) {
    const end = (m.index ?? 0) + 1;
    spans.push([start, end]);
    start = end;
    while (start < text.length && /\s/.test(text[start])) start++;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans.filter(([s, e]) => e > s);
}

/**
 * Consecutive sentences grouped into passages of about `target` characters. The next passage
 * repeats the previous one's last sentence, so a fact split across the boundary is still found whole.
 */
export function passages(
  text: string,
  target = PASSAGE_TARGET,
): Array<{ start: number; end: number; text: string }> {
  const spans = sentenceSpans(text);
  const out: Array<{ start: number; end: number; text: string }> = [];
  let i = 0;
  while (i < spans.length) {
    const first = i;
    let end = spans[i][1];
    i++;
    while (i < spans.length && spans[i][1] - spans[first][0] <= target) {
      end = spans[i][1];
      i++;
    }
    const start = spans[first][0];
    const slice = text.slice(start, end);
    if (slice.length >= PASSAGE_MIN) out.push({ start, end, text: slice });
    // One sentence of overlap, unless this passage was a single (long) sentence.
    if (i < spans.length && i - first > 1) i--;
  }
  return out;
}
