import { assert, assertEquals } from "jsr:@std/assert@^1";
import { ipKey, RateLimiter, waitText } from "./rate-limit.ts";

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;
function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const human = () => ({
  burst: { capacity: 12, refillMs: 5 * SEC },
  windows: [{ limit: 150, windowMs: HOUR }],
  abuse: { strikes: 30, windowMs: 10 * MIN, banMs: 15 * MIN, maxBanMs: 24 * HOUR },
});

Deno.test("a person checking every 6 s for an hour never hits the limit", () => {
  const c = clock();
  const l = new RateLimiter(human(), c.now);
  for (let i = 0; i < 140; i++, c.advance(6 * SEC)) assert(l.hit("p").ok, `request ${i}`);
});

Deno.test("a tester clicking 12 demo answers at once is fine; the 13th waits ~5 s, then works", () => {
  const c = clock();
  const l = new RateLimiter(human(), c.now);
  for (let i = 0; i < 12; i++) assert(l.hit("t").ok);
  const d = l.hit("t");
  assert(!d.ok && d.reason === "burst" && d.retryAfterMs <= 5 * SEC);
  c.advance(5 * SEC);
  assert(l.hit("t").ok);
});

Deno.test("keys are independent", () => {
  const l = new RateLimiter({ burst: { capacity: 1, refillMs: MIN } });
  assert(l.hit("a").ok);
  assert(!l.hit("a").ok);
  assert(l.hit("b").ok);
});

Deno.test("hourly window: refused until the window ends, with the right wait", () => {
  const c = clock();
  const l = new RateLimiter({ windows: [{ limit: 3, windowMs: HOUR }] }, c.now);
  for (let i = 0; i < 3; i++) assert(l.hit("k").ok);
  c.advance(10 * MIN);
  const d = l.hit("k");
  assert(!d.ok && d.reason === "window");
  assertEquals(d.retryAfterMs, 50 * MIN);
  c.advance(50 * MIN);
  assert(l.hit("k").ok);
});

Deno.test("a script that keeps hammering after 429 gets banned, and repeat bans double", () => {
  const c = clock();
  const l = new RateLimiter(human(), c.now);
  for (let i = 0; i < 12; i++) l.hit("bot");
  let last = l.hit("bot");
  for (let i = 1; i < 30; i++) last = l.hit("bot");
  assert(!last.ok && last.reason === "banned");
  assertEquals(last.retryAfterMs, 15 * MIN);
  c.advance(14 * MIN); // the bucket has refilled, but the ban holds
  assert(!l.hit("bot").ok);
  c.advance(MIN);
  for (let i = 0; i < 12; i++) assert(l.hit("bot").ok);
  for (let i = 0; i < 30; i++) last = l.hit("bot");
  assert(!last.ok && last.reason === "banned");
  assertEquals(last.retryAfterMs, 30 * MIN);
});

Deno.test("requests refused during a ban do not extend it", () => {
  const c = clock();
  const l = new RateLimiter(human(), c.now);
  for (let i = 0; i < 42; i++) l.hit("bot");
  for (let i = 0; i < 500; i++) l.hit("bot");
  c.advance(15 * MIN);
  assert(l.hit("bot").ok);
});

Deno.test("a person retrying a few times after 429 is not banned", () => {
  const c = clock();
  const l = new RateLimiter(human(), c.now);
  for (let i = 0; i < 12; i++) l.hit("p");
  for (let i = 0; i < 10; i++, c.advance(SEC)) l.hit("p");
  c.advance(10 * SEC);
  assert(l.hit("p").ok);
});

Deno.test("check() does not count", () => {
  const l = new RateLimiter({ windows: [{ limit: 1, windowMs: MIN }] });
  for (let i = 0; i < 5; i++) assert(l.check("k").ok);
  assert(l.hit("k").ok);
  assert(!l.check("k").ok);
});

Deno.test("sweep drops idle entries but keeps banned ones", () => {
  const c = clock();
  const l = new RateLimiter(human(), c.now);
  l.hit("idle");
  for (let i = 0; i < 42; i++) l.hit("bot");
  c.advance(HOUR + MIN);
  l.sweep();
  assertEquals(l.size, 0); // the 15 min ban is over too
  for (let i = 0; i < 42; i++) l.hit("bot2");
  c.advance(11 * MIN);
  l.sweep();
  assertEquals(l.size, 1);
});

Deno.test("ipKey: IPv4 as is, IPv6 grouped by /64, v4-mapped unwrapped", () => {
  assertEquals(ipKey("203.0.113.7"), "ip:203.0.113.7");
  assertEquals(ipKey("2001:db8:aa:bb:1:2:3:4"), "ip6:2001:db8:aa:bb::/64");
  assertEquals(ipKey("2001:0db8:00aa:00bb:ffff::1"), "ip6:2001:db8:aa:bb::/64");
  assertEquals(ipKey("2001:db8::1"), "ip6:2001:db8:0:0::/64");
  assertEquals(ipKey("[2001:db8:aa:bb::9]"), "ip6:2001:db8:aa:bb::/64");
  assertEquals(ipKey("::1"), "ip6:0:0:0:0::/64");
  assertEquals(ipKey("::ffff:198.51.100.2"), "ip:198.51.100.2");
});

Deno.test("waitText", () => {
  assertEquals(waitText(4_200), "5 s");
  assertEquals(waitText(15 * MIN), "15 min");
  assertEquals(waitText(3 * HOUR), "3 godz.");
});
