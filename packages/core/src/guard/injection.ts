/**
 * Prompt-injection scan over user input and fetched content (hard constraint 10). A hit never
 * stops the check: the fragment is logged, a warning is shown, and the models are told to ignore it.
 */

export interface InjectionSignal {
  excerpt: string;
  provenance: string;
}

const PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions|rules|prompts?)/i,
  /disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)?\s*(?:instructions|rules)/i,
  /you\s+are\s+now\s+(?:a|an|the)\b/i,
  /(?:system|developer)\s+prompt/i,
  /\b(?:mark|rate|label|classify)\s+(?:this|it|the claim)\s+(?:claim\s+)?as\s+(?:true|false|confirmed)/i,
  /zignoruj\s+(?:wszystkie\s+|wszelkie\s+)?(?:poprzednie\s+|wcześniejsze\s+)?(?:instrukcje|polecenia|zasady)/i,
  /nowe\s+instrukcje/i,
  /jesteś\s+teraz\b/i,
  /(?:oznacz|oceń|uznaj)\s+(?:to|ten\s+tekst|to\s+twierdzenie)\s+(?:jako|za)\s+(?:prawd|fałsz|potwierdz)/i,
  /<\|(?:im_start|im_end|system)\|>/i,
  /\[\/?INST\]/,
  /^\s*(?:system|assistant)\s*:/im,
];

export function scanInjection(text: string, provenance: string): InjectionSignal[] {
  const out: InjectionSignal[] = [];
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - 30);
    out.push({ excerpt: text.slice(start, m.index + m[0].length + 30).replace(/\s+/g, " ").trim(), provenance });
  }
  return out;
}
