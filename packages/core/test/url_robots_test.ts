// robots.txt matching (RFC 9309), the robots.txt redirect guard and private-parameter detection
// in the URL intake (packages/core/src/intake/url.ts).
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1";
import { cleanUrl, fetchArticle, IntakeError, isPrivateParam, parseRobots, robotsRulesAllow } from "../src/intake/url.ts";

const allows = (robots: string, path: string) => robotsRulesAllow(parseRobots(robots), path);

// Shape of the robots.txt files on large Polish news sites (listing pagination and search blocked).
const NEWS_SITE = `
User-agent: *
Disallow: /*?page=*
Disallow: /*&page=*
Disallow: /szukaj
Disallow: /*.pdf$
Allow: /

Sitemap: https://news.example.pl/sitemap.xml
`;

Deno.test("robots: a wildcard rule matches only what it describes, not the whole site", () => {
  assert(allows(NEWS_SITE, "/kraj/sejm-przyjal-ustawe-o-czyms/abc123"));
  assert(allows(NEWS_SITE, "/kraj/artykul?id=5"));
  assert(!allows(NEWS_SITE, "/kraj?page=2"));
  assert(!allows(NEWS_SITE, "/kraj?sort=new&page=2"));
  assert(!allows(NEWS_SITE, "/szukaj?q=ustawa"));
});

Deno.test("robots: a trailing $ anchors the end of the path", () => {
  assert(!allows(NEWS_SITE, "/raporty/budzet-2026.pdf"));
  assert(allows(NEWS_SITE, "/raporty/budzet-2026.pdf.html"));
  assert(allows(NEWS_SITE, "/raporty/budzet-2026.pdf?x=1"));
  assert(allows("User-agent: *\nDisallow: /$", "/kraj/artykul"));
  assert(!allows("User-agent: *\nDisallow: /$", "/"));
});

Deno.test("robots: the longest matching rule wins, Allow wins a tie", () => {
  const pap = "User-agent: *\nDisallow: /\nAllow: /mediaroom\n";
  assert(allows(pap, "/mediaroom/komunikat-1"));
  assert(!allows(pap, "/aktualnosci/news-1"));
  const nested = "User-agent: *\nAllow: /wiadomosci/\nDisallow: /wiadomosci/archiwum/\n";
  assert(allows(nested, "/wiadomosci/dzis"));
  assert(!allows(nested, "/wiadomosci/archiwum/2019"));
  assert(allows("User-agent: *\nDisallow: /a*\nAllow: /a*\n", "/abc"));
});

Deno.test("robots: a site that blocks everything is blocked; an empty Disallow allows everything", () => {
  assert(!allows("User-agent: *\nDisallow: /\n", "/kraj/artykul"));
  assert(!allows("User-agent: *\nDisallow: *\n", "/kraj/artykul"));
  assert(allows("User-agent: *\nDisallow:\n", "/kraj/artykul"));
  assert(allows("", "/kraj/artykul"));
});

Deno.test("robots: group selection is unchanged (\"*\" and PrawdowidBot groups apply, others do not)", () => {
  const txt = "User-agent: SomeOtherBot\nDisallow: /\n\nUser-agent: PrawdowidBot\nUser-agent: Foo\nDisallow: /tylko-nie-to\n";
  assert(allows(txt, "/kraj/artykul"));
  assert(!allows(txt, "/tylko-nie-to/x"));
});

Deno.test("robots: non-ASCII patterns compare against the percent-encoded path", () => {
  assert(!allows("User-agent: *\nDisallow: /wyszukiwarka-łódź\n", new URL("https://x.pl/wyszukiwarka-łódź/1").pathname));
});

// ── fetchArticle end to end, with fetch stubbed ──────────────────────────────

const ARTICLE = `<html><head><title>Sejm przyjął ustawę</title></head><body><article><h1>Sejm przyjął ustawę</h1>
<p>${"Sejm przyjął w piątek ustawę o czymś bardzo ważnym dla obywateli. ".repeat(10)}</p></article></body></html>`;

async function withFetch<T>(handler: (url: URL) => Response, fn: (calls: URL[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: URL[] = [];
  // Behaves like real fetch: without redirect "manual" it follows 3xx responses itself.
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    let url = new URL(input instanceof Request ? input.url : input.toString());
    for (let hop = 0; hop < 10; hop++) {
      calls.push(url);
      const res = handler(url);
      const loc = res.headers.get("location");
      if (init?.redirect === "manual" || res.status < 300 || res.status >= 400 || !loc) return Promise.resolve(res);
      url = new URL(loc, url);
    }
    return Promise.reject(new TypeError("too many redirects"));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const publicDns = () => Promise.resolve(["93.184.216.34"]);

Deno.test("fetchArticle: a pagination wildcard in robots.txt does not reject a pasted article", async () => {
  const article = await withFetch(
    (u) =>
      u.pathname === "/robots.txt"
        ? new Response(NEWS_SITE)
        : new Response(ARTICLE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    () => fetchArticle("https://wildcard-news.example.pl/kraj/sejm-przyjal-ustawe/abc123", { resolveHost: publicDns }),
  );
  assertEquals(article.title, "Sejm przyjął ustawę");
});

Deno.test("fetchArticle: robots.txt redirect to an internal address is not followed", async () => {
  const resolveHost = (host: string) => Promise.resolve(host === "internal.example.pl" ? ["10.0.0.5"] : ["93.184.216.34"]);
  await withFetch(
    (u) => {
      if (u.hostname === "redirect-site.example.pl" && u.pathname === "/robots.txt") {
        return new Response(null, { status: 302, headers: { location: "https://internal.example.pl/robots.txt" } });
      }
      return new Response(ARTICLE, { headers: { "content-type": "text/html" } });
    },
    async (calls) => {
      await fetchArticle("https://redirect-site.example.pl/kraj/artykul", { resolveHost });
      assert(!calls.some((c) => c.hostname === "internal.example.pl"), "fetched the internal robots.txt target");
    },
  );
});

Deno.test("fetchArticle: a public robots.txt redirect is followed and its rules apply", async () => {
  await withFetch(
    (u) => {
      if (u.hostname === "bare-host.example.pl" && u.pathname === "/robots.txt") {
        return new Response(null, { status: 301, headers: { location: "https://www.bare-host.example.pl/robots.txt" } });
      }
      if (u.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n");
      return new Response(ARTICLE, { headers: { "content-type": "text/html" } });
    },
    async (calls) => {
      const err = await assertRejects(
        () => fetchArticle("https://bare-host.example.pl/kraj/artykul", { resolveHost: publicDns }),
        IntakeError,
      );
      assertEquals(err.kind, "robots");
      assert(!calls.some((c) => c.pathname === "/kraj/artykul"), "page fetched despite robots.txt");
    },
  );
});

// ── private query parameters ────────────────────────────────────────────────

Deno.test("cleanUrl: ordinary parameters that contain a private word as a substring pass", () => {
  for (const q of ["author=kowalski", "keyword=sejm", "postcode=00-950", "president=duda", "passage=3", "sidebar=1", "codename=x"]) {
    assertEquals(cleanUrl(`https://example.pl/a?${q}`).search, `?${q}`);
  }
});

Deno.test("cleanUrl: private parameters are still refused, whole name or name part, any case", () => {
  for (
    const name of [
      "token", "access_token", "accessToken", "id-token", "API_KEY", "apikey", "key", "password", "pwd", "PHPSESSID",
      "jsessionid", "sessionId", "sid", "auth", "auth_token", "sig", "signature", "email", "user_email", "phone", "code",
      "secret", "client_secret",
    ]
  ) {
    assert(isPrivateParam(name), name);
    assertThrows(() => cleanUrl(`https://example.pl/a?${name}=abc`), IntakeError);
  }
});

Deno.test("robots: a site that blocks AI crawlers blocks us too, even when '*' allows everything", async () => {
  const { parseRobotsGroups, robotsGroupsAllow } = await import("../src/intake/url.ts");
  const txt = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /szukaj",
    "",
    "User-agent: GPTBot",
    "User-agent: ClaudeBot",
    "Disallow: /",
    "Allow: /mediaroom/",
  ].join("\n");
  const groups = parseRobotsGroups(txt);
  assertEquals(groups.length, 2);
  assertEquals(robotsGroupsAllow(groups, "/kraj/artykul,123.html"), false);
  assertEquals(robotsGroupsAllow(groups, "/mediaroom/komunikat"), true);
  // A site that names no AI crawler: only "*" applies.
  const plain = parseRobotsGroups("User-agent: *\nDisallow: /*?page=*\n\nUser-agent: Googlebot\nDisallow: /");
  assertEquals(plain.length, 1);
  assertEquals(robotsGroupsAllow(plain, "/kraj/artykul,123.html"), true);
  assertEquals(robotsGroupsAllow(plain, "/kraj?page=2"), false);
});

Deno.test("robots: Sitemap between User-agent lines keeps one group; our own group replaces '*'; escapes compare canonically", async () => {
  const { parseRobotsGroups, robotsGroupsAllow } = await import("../src/intake/url.ts");
  const split = parseRobotsGroups("User-agent: *\nSitemap: https://x.example/s.xml\nUser-agent: GPTBot\nDisallow: /private\n");
  assertEquals(robotsGroupsAllow(split, "/private/a"), false);
  const ours = parseRobotsGroups("User-agent: *\nDisallow: /\n\nUser-agent: prawdowid\nAllow: /\n");
  assertEquals(robotsGroupsAllow(ours, "/artykul"), true);
  const enc = parseRobotsGroups("User-agent: *\nDisallow: /%7Euser/\n");
  assertEquals(robotsGroupsAllow(enc, "/~user/page"), false);
  assertEquals(robotsGroupsAllow(parseRobotsGroups("User-agent: *\nDisallow: /a%2fb\n"), "/a%2Fb/x"), false);
});
