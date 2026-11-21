/**
 * Renders the canonical CheckResponse for readers of every age, including people 65+ with low
 * digital skills: one card per checked sentence, the verdict first (big word + an icon whose SHAPE
 * differs per verdict, so meaning never rests on color alone), a fixed plain-language meaning,
 * the source quote with a big "read it at the source" button, and a fixed "what now" line.
 * Technical details sit behind disclosures.
 *
 * Rules kept (hard constraints 7-9, 17): only the 5 verdicts; system states look different
 * (dashed frame, no verdict colors) and always say "this is not a truth rating"; escalation is
 * only ever "recommended"; every fixed text below is a static mapping, never invented per answer.
 * Untrusted text goes through textContent only (dom.ts).
 * Merged from two design reviews (gpt-6.2-sol, Claude Opus), 2026-11-21.
 */
import type { CheckResponse, Citation, ClaimResult, Verdict, Warning } from "@prawdowid/core/types";
import { h } from "./dom.ts";

type Tone = Verdict | "state";

const VERDICT_TITLE: Record<Verdict, string> = {
  confirmed: "Potwierdzone",
  false: "Fałszywe",
  misleading: "Wprowadzające w błąd",
  insufficient_evidence: "Brak wystarczających dowodów",
  not_verifiable: "Nie podlega weryfikacji",
};
const VERDICT_MEANING: Record<Verdict, string> = {
  confirmed: "To się zgadza ze źródłami.",
  false: "To nieprawda. Źródła mówią co innego.",
  misleading: "Coś tu się zgadza, ale całość wprowadza w błąd.",
  insufficient_evidence: "Nie wiemy. Nie znaleźliśmy dość dowodów ani za, ani przeciw.",
  not_verifiable: "To opinia albo przewidywanie, a nie fakt. Nie da się tego sprawdzić.",
};
/** No "Co teraz" line for confirmed claims (user's choice, 2026-11-21): the sources say enough. */
const VERDICT_ADVICE: Partial<Record<Verdict, string>> = {
  false: "Nie przekazuj tego dalej. Jeśli ktoś Ci to wysłał, pokaż mu źródło.",
  misleading: "Nie przekazuj tego w tej formie. Przeczytaj, co dokładnie mówi źródło.",
  insufficient_evidence: "Wstrzymaj się z przekazywaniem dalej. Poczekaj na komunikat urzędu lub zaufanych mediów.",
  not_verifiable: "To czyjeś zdanie. Możesz się z nim zgodzić lub nie, fakty tego nie rozstrzygną.",
};

const NOT_A_RATING = "To nie jest ocena prawdziwości.";
const STATE_TITLE = {
  source_unavailable: "Źródło niedostępne",
  technical_error: "Błąd techniczny",
  not_processed: "Nie sprawdzono",
} as const;
const STATE_MEANING = {
  source_unavailable: "Źródło, w którym sprawdzamy, nie odpowiadało.",
  technical_error: "Coś poszło nie tak po naszej stronie.",
  not_processed: "Nie zdążyliśmy sprawdzić tego zdania.",
} as const;
const STATE_ADVICE = {
  source_unavailable: "Spróbuj ponownie za kilka minut. Do tego czasu nie traktuj tego jako sprawdzonego.",
  technical_error: "Spróbuj ponownie za kilka minut. Do tego czasu nie traktuj tego jako sprawdzonego.",
  not_processed: "Wyślij to zdanie osobno, a sprawdzimy je.",
} as const;

const STRENGTH = {
  high: { bars: 3, word: "wysoka", text: "Mamy mocne dowody." },
  medium: { bars: 2, word: "średnia", text: "Dowody są dobre, ale niepełne." },
  low: { bars: 1, word: "niska", text: "Dowody są słabe." },
} as const;
/** The meter only makes sense where evidence decided the verdict. */
const SHOWS_STRENGTH: Verdict[] = ["confirmed", "false", "misleading"];

const STANCE: Record<Citation["stance"], { text: string; icon: Tone }> = {
  supports: { text: "To źródło potwierdza", icon: "confirmed" },
  refutes: { text: "To źródło zaprzecza", icon: "false" },
  misleading: { text: "To źródło pokazuje inny kontekst", icon: "misleading" },
  context: { text: "Dodatkowy kontekst", icon: "insufficient_evidence" },
};
const ROUTE_PL: Record<string, string> = {
  hits: "znaleziono wyniki",
  no_hits: "brak wyników",
  unavailable: "niedostępne",
  error: "błąd",
  timeout: "przekroczony czas",
  skipped: "pominięte",
};

/** Polish plural: 1 zdanie, 2-4 zdania (not 12-14), else zdań. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const t = n % 10, hh = n % 100;
  return t >= 2 && t <= 4 && !(hh >= 12 && hh <= 14) ? few : many;
}

function date(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(d);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
}

function hostname(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** Where in the material a sentence came from: "video@01:15" → "w filmie, 01:15". */
function provenanceLabel(p: string): string | null {
  const m = p.match(/^(video|audio)@(\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (m) return `${m[1] === "video" ? "w filmie" : "w nagraniu"}, ${m[2]}`;
  if (p.startsWith("image")) return "ze zdjęcia";
  if (p === "article") return "z artykułu";
  return null;
}

// ── icons: the shape carries the meaning, color only repeats it ─────────────
const SVG = "http://www.w3.org/2000/svg";
const ICON_SHAPES: Record<Tone, { base: string; glyph: string }> = {
  confirmed: { base: "circle", glyph: "M7.5 12.5l3 3 6-6.5" },
  false: { base: "circle", glyph: "M8.5 8.5l7 7M15.5 8.5l-7 7" },
  misleading: { base: "triangle", glyph: "M12 9.5v4.5M12 17.2v.1" },
  insufficient_evidence: { base: "circle", glyph: "M9.6 9.6a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.2M12 17.2v.1" },
  not_verifiable: { base: "bubble", glyph: "M8 10.5h8M8 13.5h5" },
  state: { base: "dashed", glyph: "M8 12h.1M12 12h.1M16 12h.1" },
};

export function icon(tone: Tone, size = "lg"): SVGSVGElement {
  const { base, glyph } = ICON_SHAPES[tone];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `vicon vicon-${size} tone-${tone}`);
  const shape = document.createElementNS(SVG, "path");
  shape.setAttribute(
    "d",
    base === "triangle"
      ? "M12 2.5L22.5 20.5H1.5Z"
      : base === "bubble"
      ? "M4 4.5h16a1.5 1.5 0 011.5 1.5v10a1.5 1.5 0 01-1.5 1.5H10l-5 4v-4H4A1.5 1.5 0 012.5 16V6A1.5 1.5 0 014 4.5z"
      : "M12 1.5a10.5 10.5 0 110 21 10.5 10.5 0 010-21z",
  );
  shape.setAttribute("class", base === "dashed" ? "vicon-ring" : "vicon-base");
  const mark = document.createElementNS(SVG, "path");
  mark.setAttribute("d", glyph);
  mark.setAttribute("class", "vicon-glyph");
  svg.append(shape, mark);
  return svg;
}

/** What the share sheet gets for one rated sentence: the sentence, our verdict, the first source. */
function shareText(c: ClaimResult, v: Verdict): string {
  const src = c.citations.find((x) => hostname(x.url));
  return [
    `„${c.text}”`,
    `Prawdomat: ${VERDICT_TITLE[v]}. ${VERDICT_MEANING[v]}`,
    src ? `Źródło: ${src.publisher}, ${src.url}` : null,
  ].filter(Boolean).join("\n");
}

/** The common "share" glyph: three dots joined by two lines. */
const SHARE_ICON =
  "M18 2a3 3 0 110 6 3 3 0 010-6zM6 9a3 3 0 110 6 3 3 0 010-6zM18 16a3 3 0 110 6 3 3 0 010-6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4";

/**
 * Icon-only share button. Phones and tablets get the system share sheet; computers copy the text to
 * the clipboard, because Chrome's desktop share sheet (Windows) is unreliable and crashed a browser
 * in testing (2026-11-21). The link goes inside the text: some share targets drop a separate url.
 */
function shareButton(c: ClaimResult, v: Verdict): HTMLElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", SHARE_ICON);
  svg.append(p);
  const LABEL = "Udostępnij wynik";
  const tip = h("span", { class: "share-tip", "aria-hidden": "true" });
  const btn = h("button", { type: "button", class: "share-btn", "aria-label": LABEL, title: LABEL }, svg, tip);
  let resetTimer = 0;
  const flash = (label: string) => {
    btn.setAttribute("aria-label", label);
    btn.title = label;
    tip.textContent = label;
    btn.classList.add("is-done");
    clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      btn.setAttribute("aria-label", LABEL);
      btn.title = LABEL;
      btn.classList.remove("is-done");
    }, 2000);
  };
  btn.addEventListener("click", async () => {
    const text = `${shareText(c, v)}\nSprawdzono w Prawdomacie: ${location.origin}/`;
    const data = { title: "Prawdomat", text };
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
      } catch {
        // Closed by the person (AbortError) or blocked: nothing to say.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("Skopiowano do schowka");
    } catch {
      flash("Nie udało się udostępnić");
    }
  });
  return btn;
}

function meter(level: keyof typeof STRENGTH): HTMLElement {
  const s = STRENGTH[level];
  const bars = h("span", { class: "meter-bars", "aria-hidden": "true" });
  for (let i = 1; i <= 3; i++) bars.append(h("span", { class: i <= s.bars ? "bar on" : "bar" }));
  return h("p", { class: "meter", title: s.text }, bars, h("span", { class: "meter-word" }, "Pewność "), h("strong", {}, s.word));
}

/** The card's header: a quiet top line, the verdict pill (with the strength meter on the same row,
 * so a card without a top line has no empty row), the sentence, what it means. */
function cardHead(
  tone: Tone,
  title: string,
  meaning: string,
  opts: { kicker?: string | null; id?: string; side?: HTMLElement | null; claim?: string } = {},
) {
  return h(
    "header",
    { class: "card-head" },
    opts.kicker ? h("p", { class: "card-eyebrow" }, opts.kicker) : null,
    h(
      "div",
      { class: "verdict-row" },
      h("h3", { class: "verdict", id: opts.id, tabindex: "-1" }, icon(tone, "sm"), h("span", {}, title)),
      opts.side ?? null,
    ),
    opts.claim ? h("p", { class: "claim-text" }, opts.claim) : null,
    h("p", { class: "verdict-meaning" }, meaning),
  );
}

/** A request-level or connection problem: dashed card, never verdict colors (constraint 8). */
export function stateCard(title: string, lines: string[], extra: HTMLElement | null = null): HTMLElement {
  return h(
    "div",
    { class: "card card-state tone-state request-state", role: "status" },
    cardHead("state", title, lines[0] ?? NOT_A_RATING),
    lines.length > 1 || extra
      ? h("div", { class: "card-body" }, ...lines.slice(1).map((l) => h("p", {}, l)), extra)
      : null,
  );
}

/**
 * The site's small icon in front of a link, so a list of sources doesn't read as one grey block.
 * Fetched from DuckDuckGo's icon service: it receives only the publisher's domain (already public),
 * never the user's text, and no referrer. Unknown sites get a 404, so the icon is simply removed
 * (no blank placeholder). Decorative: hidden from screen readers.
 */
function favicon(host: string): HTMLElement {
  const img = h("img", {
    class: "favicon",
    src: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
    alt: "",
    width: "16",
    height: "16",
    loading: "lazy",
    decoding: "async",
    referrerpolicy: "no-referrer",
    "aria-hidden": "true",
  });
  img.addEventListener("error", () => img.remove(), { once: true });
  return img;
}

function sourceLink(c: Citation): HTMLElement | null {
  const host = hostname(c.url);
  if (!host) return null;
  return h(
    "a",
    { class: "cite-link", href: c.url, target: "_blank", rel: "noopener noreferrer nofollow" },
    favicon(host),
    host,
    h("span", { "aria-hidden": "true" }, " ↗"),
    h("span", { class: "sr-only" }, " (otworzy się w nowej karcie)"),
  );
}

function citation(c: Citation): HTMLElement {
  const link = sourceLink(c);
  return h(
    "li",
    { class: `cite stance-${c.stance}` },
    h("blockquote", { class: "quote" }, c.excerpt),
    h(
      "p",
      { class: "cite-meta" },
      // "To źródło potwierdza" is left out (user's choice, 2026-11-21): the green quote says it.
      // A refuting or different-context source keeps its words, so meaning never rests on color alone.
      c.stance === "supports" ? h("span", { class: "sr-only" }, `${STANCE.supports.text}: `) : null,
      c.stance !== "supports" ? h("span", { class: "cite-stance" }, STANCE[c.stance].text) : null,
      c.stance !== "supports" ? " · " : null,
      h("span", { class: "publisher" }, c.publisher),
      c.published_at ? ` · ${date(c.published_at)}` : "",
      link ? " · " : "",
      link,
    ),
  );
}

function warningBox(w: Warning): HTMLElement {
  const title = w.type === "sources_conflict"
    ? "Uwaga: źródła mówią różne rzeczy"
    : w.type === "injection_detected"
    ? "Uwaga: tekst zawierał polecenia dla komputera"
    : w.type === "illegible_media" || w.type === "partial_analysis"
    ? "Sprawdziliśmy tylko część materiału"
    : w.type === "assumed_period" || w.type === "assumed_scope"
    ? "Przyjęliśmy założenie"
    : w.type === "archival_material"
    ? "Uwaga: to stary materiał"
    : w.type === "known_narrative"
    ? "Podobny przekaz był już opisywany"
    : "Ważne";
  return h("div", { class: `note note-${w.type}` }, h("strong", {}, title), h("p", {}, w.text));
}

function detailsBlock(summary: string, ...children: (Node | null)[]): HTMLElement {
  return h("details", { class: "more" }, h("summary", {}, summary), h("div", { class: "more-body" }, ...children));
}

/** Known incidents (EUvsDisinfo): context next to the claim, behind a disclosure and visibly apart from the sources. */
function contextMatches(c: ClaimResult): HTMLElement | null {
  if (!c.context_matches?.length) return null;
  return detailsBlock(
    "Podobne przekazy w bazach dezinformacji (kontekst, nie dowód)",
    h(
      "ul",
      { class: "context-matches" },
      ...c.context_matches.map((m) => {
        const title = m.title.length > 90 ? m.title.slice(0, 90) + "…" : m.title;
        return h(
          "li",
          {},
          m.excerpt ? h("blockquote", { class: "quote" }, m.excerpt) : null,
          h(
            "p",
            { class: "cite-meta" },
            h("span", { class: "publisher" }, m.catalog),
            m.published_at ? `, ${date(m.published_at)}` : "",
            ": ",
            hostname(m.url)
              ? h(
                "a",
                { href: m.url, target: "_blank", rel: "noopener noreferrer nofollow" },
                favicon(hostname(m.url)!),
                title,
                h("span", { class: "sr-only" }, " (otworzy się w nowej karcie)"),
              )
              : title,
          ),
        );
      }),
    ),
  );
}

function claimCard(c: ClaimResult, index: number, total: number, uid: string): HTMLElement {
  const from = provenanceLabel(c.provenance);
  const kicker = [total > 1 ? `Zdanie ${index + 1} z ${total}` : null, from].filter(Boolean).join(", ") || null;
  const id = `${uid}-${index}-h`;

  // System state: dashed frame, no verdict color, says plainly it is not a rating.
  if (c.system_state) {
    const st = c.system_state;
    return h(
      "article",
      { class: "card card-state tone-state", id: `${uid}-${index}`, "aria-labelledby": id },
      cardHead("state", STATE_TITLE[st], `${STATE_MEANING[st]} ${NOT_A_RATING}`, { kicker: kicker ?? "Nie udało się sprawdzić", id, claim: c.text }),
      h(
        "div",
        { class: "card-body" },
        h("p", { class: "advice" }, h("strong", {}, "Co teraz: "), STATE_ADVICE[st]),
        detailsBlock("Szczegóły", c.system_message ? h("p", {}, c.system_message) : null, routesList(c)),
      ),
    );
  }

  const v = c.verdict!;
  const fact = v !== "not_verifiable";
  const sources = c.citations.length
    ? h(
      "div",
      { class: "section" },
      h("p", { class: "label" }, c.citations.length === 1 ? "Źródło" : "Źródła"),
      h("ul", { class: "cites" }, ...c.citations.map(citation)),
    )
    : fact
    ? h("p", { class: "no-source" }, "Nie znaleźliśmy źródła, które rozstrzyga tę sprawę.")
    : null;

  return h(
    "article",
    { class: `card tone-${v}`, id: `${uid}-${index}`, "aria-labelledby": id },
    cardHead(v, VERDICT_TITLE[v], VERDICT_MEANING[v], {
      kicker,
      id,
      side: h(
        "div",
        { class: "card-actions" },
        c.strength && SHOWS_STRENGTH.includes(v) ? meter(c.strength.level) : null,
        shareButton(c, v),
      ),
      claim: c.text,
    }),
    h(
    "div",
    { class: "card-body" },
    c.explanation ? h("p", { class: "explanation" }, c.explanation) : null,
    c.missing ? h("div", { class: "section" }, h("p", { class: "label" }, "Czego nie ustaliliśmy"), h("p", {}, c.missing)) : null,
    ...c.warnings.map(warningBox),
    sources,
    contextMatches(c),
    VERDICT_ADVICE[v] ? h("p", { class: "advice" }, h("strong", {}, "Co teraz: "), VERDICT_ADVICE[v]) : null,
    ),
  );
}

function routesList(c: ClaimResult): HTMLElement | null {
  if (!c.routes.length) return null;
  return h(
    "div",
    {},
    h("p", {}, "Gdzie szukaliśmy:"),
    h(
      "ul",
      {},
      ...c.routes.map((r) =>
        h("li", {}, `${r.label}: `, h("span", { class: `route route-${r.status}` }, ROUTE_PL[r.status] ?? r.status), r.detail ? ` (${r.detail})` : "")
      ),
    ),
  );
}

/** One row per sentence; tapping it jumps to its card. */
function overview(claims: ClaimResult[], uid: string): HTMLElement {
  return h(
    "ol",
    { class: "overview" },
    ...claims.map((c, i) => {
      const tone: Tone = c.verdict ?? "state";
      const title = c.verdict ? VERDICT_TITLE[c.verdict] : STATE_TITLE[c.system_state!];
      const btn = h(
        "button",
        { type: "button", class: `overview-row tone-${tone}` },
        icon(tone, "md"),
        h("span", { class: "overview-text" }, h("strong", {}, title), h("span", { class: "overview-claim" }, c.text)),
        h("span", { class: "overview-go", "aria-hidden": "true" }, "›"),
      );
      btn.addEventListener("click", () => {
        const card = document.getElementById(`${uid}-${i}`);
        card?.scrollIntoView({ behavior: "smooth", block: "start" });
        (card?.querySelector(".verdict") as HTMLElement | null)?.focus({ preventScroll: true });
      });
      return h("li", {}, btn);
    }),
  );
}

/** Short text for screen readers once the answer is ready. */
export function announce(r: CheckResponse): string {
  if (!r.claims.length) return `Gotowe. ${r.system_message?.title ?? ""}`.trim();
  const parts = r.claims.map((c) => (c.verdict ? VERDICT_TITLE[c.verdict] : STATE_TITLE[c.system_state!]).toLowerCase());
  const n = r.claims.length;
  return `Gotowe. ${n} ${plural(n, "zdanie", "zdania", "zdań")}: ${parts.join(", ")}.`;
}

/**
 * A picture of the checked material (the attached photo or one frame of the attached video) laid
 * behind the top of the answer: dimmed, fading to nothing toward the bottom. Purely decorative:
 * the bubble above already shows the file, so it is hidden from screen readers.
 */
function backdropImage(src: string): HTMLElement {
  return h(
    "div",
    { class: "answer-backdrop", "aria-hidden": "true" },
    h("img", { src, alt: "", decoding: "async" }),
  );
}

export function renderResult(root: HTMLElement, r: CheckResponse, opts: { backdrop?: string | null } = {}) {
  const parts: (HTMLElement | null)[] = [];
  // The demo_data warning is not shown (user's choice, 2026-11-21); mock texts from the API still
  // carry [DEMO] and point to example.org, which the source button shows as the address.
  const notes = r.warnings.filter((w) => w.type !== "demo_data");
  const claims = r.claims;
  // Ids must be unique across every answer in the thread (overview rows jump to their own cards).
  const uid = `c${r.check_id.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;

  // Request-level system state (no claims): dashed frame, says plainly it is not a rating.
  if (r.system_message) {
    const text = r.system_message.text;
    parts.push(
      stateCard(r.system_message.title, [
        /nie jest ocen/i.test(text) ? text : `${text} ${NOT_A_RATING}`,
        ...(r.status === "needs_clarification" ? ["Napisz całe pytanie jeszcze raz, z brakującymi szczegółami."] : []),
      ]),
    );
  }

  if (r.input.url || r.input.description) {
    const host = r.input.url ? hostname(r.input.url) : null;
    parts.push(
      h(
        "div",
        { class: "input-meta" },
        r.input.url
          ? h(
            "p",
            {},
            "Sprawdzana strona: ",
            h("strong", {}, r.input.title ?? host ?? r.input.url),
            host ? ` (${host})` : "",
            r.input.published_at ? `, opublikowana ${date(r.input.published_at)}` : "",
            ".",
          )
          : null,
        r.input.description ? h("p", {}, r.input.type === "image" ? "Na zdjęciu: " : "W nagraniu: ", r.input.description) : null,
      ),
    );
  }

  // Our own heading from the claim list (the API's summary.text stays for the messaging bot).
  if (claims.length > 1) {
    const n = claims.length;
    const unrated = claims.filter((c) => c.system_state).length;
    parts.push(
      h("h2", { class: "answer-title", tabindex: "-1" }, `Sprawdziliśmy ${n} ${plural(n, "zdanie", "zdania", "zdań")}`),
      unrated ? h("p", { class: "answer-sub" }, `Bez oceny: ${unrated} z ${n} zdań.`) : null,
      overview(claims, uid),
    );
  } else if (claims.length === 1) {
    parts.push(h("h2", { class: "sr-only answer-title", tabindex: "-1" }, "Wynik sprawdzenia"));
  }

  for (const w of notes) parts.push(warningBox(w));

  if (r.escalation.state === "recommended") {
    parts.push(
      h(
        "div",
        { class: "escalation" },
        h("strong", {}, "Zalecamy, by sprawdził to człowiek"),
        h(
          "p",
          {},
          "Sprawa wygląda poważnie, a dowodów jest za mało. To tylko zalecenie: nikomu tego nie przekazaliśmy. Jeśli chodzi o Twoje bezpieczeństwo, sprawdź komunikaty urzędu lub służb. W nagłej sytuacji dzwoń pod 112.",
        ),
        r.escalation.reason ? h("p", { class: "escalation-reason" }, `Powód: ${r.escalation.reason}`) : null,
      ),
    );
  }

  claims.forEach((c, i) => parts.push(claimCard(c, i, claims.length, uid)));

  const sheet = h("div", { class: "sheet" }, ...parts.filter((p): p is HTMLElement => p !== null));
  if (opts.backdrop) {
    sheet.classList.add("has-backdrop");
    sheet.prepend(backdropImage(opts.backdrop));
  }
  root.replaceChildren(sheet);
}
