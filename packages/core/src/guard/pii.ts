/**
 * Local PII masking before any third-party call, search or storage (hard constraint 12,
 * verification-pipeline §1). Rules only for now; a local name recognizer is a TODO, so private
 * names are NOT masked yet (disclosed in limitations).
 *
 * Numbers inside claims ("38 000 000 mieszkańców") must survive, so phone rules are conservative.
 */

export interface Redaction {
  type: string;
  count: number;
}

function peselValid(d: string): boolean {
  if (!/^\d{11}$/.test(d)) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = w.reduce((s, wi, i) => s + wi * Number(d[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(d[10]);
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** ISO 4217 codes likely before an amount in Polish text; never masked as an ID-card series. */
const CURRENCY_CODES = new Set([
  "PLN", "EUR", "USD", "GBP", "CHF", "JPY", "CNY", "CZK", "HUF", "SEK", "NOK", "DKK", "RON", "BGN",
  "UAH", "RUB", "BYN", "CAD", "AUD", "NZD", "TRY", "ILS", "INR", "KRW", "MXN", "BRL", "ZAR", "SGD",
  "HKD", "XDR", "XAU",
]);

const UNIT_AFTER = /^\s*(zł|zl|pln|eur|usd|mln|mld|tys|osób|osob|ludzi|%|proc|km|kg|ton|głos|glos)/i;

export function maskPii(input: string): { text: string; redactions: Redaction[] } {
  const counts = new Map<string, number>();
  const hit = (type: string) => counts.set(type, (counts.get(type) ?? 0) + 1);
  let text = input;

  // E-mail addresses.
  text = text.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/giu, () => (hit("email"), "[e-mail]"));

  // IBAN (PL and generic), with or without spaces.
  text = text.replace(/\b[A-Z]{2}\d{2}(?:[ ]?\d{4}){4,7}\b/g, () => (hit("iban"), "[numer konta]"));
  // Bare 26-digit Polish account numbers (NRB), spaced or not.
  text = text.replace(/\b\d{2}(?:[ ]?\d{4}){6}\b/g, () => (hit("iban"), "[numer konta]"));

  // Payment cards: 13-19 digits with optional separators, Luhn-valid.
  text = text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && luhnValid(d)) return (hit("card"), "[numer karty]");
    return m;
  });

  // PESEL: 11 digits with a valid checksum.
  text = text.replace(/\b\d{11}\b/g, (m) => (peselValid(m) ? (hit("pesel"), "[PESEL]") : m));

  // Polish ID card number: 3 letters + 6 digits. A currency code before an amount ("PLN 250000")
  // is not an ID: masking it would destroy the numeric claim.
  text = text.replace(/\b([A-Z]{3})\s?\d{6}\b/g, (m, prefix: string) => {
    if (CURRENCY_CODES.has(prefix)) return m;
    return (hit("id_card"), "[nr dowodu]");
  });

  // Phones with a country prefix.
  text = text.replace(/(?:\+|00)\d{2}[ -]?\d{3}[ -]?\d{3}[ -]?\d{3}\b/g, () => (hit("phone"), "[telefon]"));
  // Phones written 3-3-3 or 9 digits right after a phone cue word.
  text = text.replace(
    /(\b(?:tel\.?|telefon\w*|nr|numer|(?:za)?dzwo[nń]\w*|kontakt|kom\.?|sms)\s*:?\s*)(\d{3}[ -]?\d{3}[ -]?\d{3})\b/gi,
    (_m, cue) => (hit("phone"), `${cue}[telefon]`),
  );
  text = text.replace(/\b\d{3}-\d{3}-\d{3}\b/g, (m, offset: number, whole: string) => {
    if (UNIT_AFTER.test(whole.slice(offset + m.length, offset + m.length + 8))) return m;
    return (hit("phone"), "[telefon]");
  });

  // Street addresses: "ul. Długa 12/4", "al. Jerozolimskie 100".
  text = text.replace(
    /\b(?:ul|al|os|pl)\.\s+[\p{Lu}][\p{L}.-]*(?:\s+[\p{Lu}][\p{L}.-]*){0,3}\s+\d+[a-zA-Z]?(?:\s?\/\s?\d+[a-zA-Z]?)?/gu,
    () => (hit("address"), "[adres]"),
  );

  // IPv4 addresses.
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, () => (hit("ip"), "[adres IP]"));

  return { text, redactions: [...counts].map(([type, count]) => ({ type, count })) };
}
