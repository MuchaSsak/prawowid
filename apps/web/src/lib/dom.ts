/** Tiny DOM builder. Text always goes through textContent: results contain untrusted quotes. */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Only http(s) links are rendered as links; anything else becomes plain text. */
export function safeLink(url: string, text: string): HTMLElement {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return h("a", { href: u.toString(), target: "_blank", rel: "noopener noreferrer nofollow" }, text);
    }
  } catch {
    // fall through
  }
  return h("span", {}, text);
}
