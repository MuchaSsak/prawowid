import { assert, assertEquals } from "jsr:@std/assert@^1";
import { passages, sentenceSpans } from "../src/store/passages.ts";

Deno.test("passages: literal slices, about the target size, one sentence of overlap", () => {
  const sentence = (n: number) => `Zdanie numer ${n} opisuje wydarzenie w gminie Kozienice.`;
  const text = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(" ");
  const out = passages(text, 200);
  assert(out.length > 2);
  for (const p of out) {
    assertEquals(text.slice(p.start, p.end), p.text);
    assert(p.text.length <= 200 || !p.text.includes(". "), `passage too long: ${p.text.length}`);
  }
  // The last sentence of a passage opens the next one.
  const lastOfFirst = sentenceSpans(out[0].text).at(-1)!;
  assert(out[1].text.startsWith(out[0].text.slice(lastOfFirst[0], lastOfFirst[1])));
  // Nothing is lost: the passages cover the whole text.
  assertEquals(out[0].start, 0);
  assertEquals(out.at(-1)!.end, text.length);
});

Deno.test("passages: numbers, abbreviations and quotes do not cut a passage mid-sentence", () => {
  const text = "Rząd przeznaczył 11 mld zł na odbudowę. „Powódź z 2024 r. zniszczyła mosty” – powiedział minister. To 2. etap prac.";
  const out = passages(text);
  assertEquals(out.length, 1);
  assertEquals(out[0].text, text);
});

Deno.test("passages: one very long sentence stays one passage; tiny text is dropped", () => {
  const long = `Komunikat ${"bardzo ".repeat(200)}długi.`;
  assertEquals(passages(long).length, 1);
  assertEquals(passages("Krótko."), []);
});
