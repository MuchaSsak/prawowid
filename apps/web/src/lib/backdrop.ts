/**
 * The living backdrop: the dark page around the hero panel on the input screen, redrawn by a WebGL
 * fragment shader as a faint blue haze that drifts slowly on its own (no pointer input). Low
 * contrast by design. Colors come from the CSS tokens (--page, --navy), so it follows the page theme.
 * In chat it stays behind the whole thread, a little fainter.
 * Cheap on phones: device-pixel-ratio capped at 1, ~30 fps, paused when the tab is hidden, one
 * static frame under prefers-reduced-motion, and the plain CSS gradient stays as the fallback.
 * The drawing (src/lib/backdrop-gl.ts) runs in a worker on an OffscreenCanvas, so WebGL start-up
 * never blocks the page; this file only reads the page (size, colors, motion) and sends it over.
 * Browsers without OffscreenCanvas run the same renderer here on the main thread.
 */
import { createBackdropRenderer, type BackdropState, type FailReason, type RGB } from "./backdrop-gl.ts";

function toRgb(ctx: CanvasRenderingContext2D, value: string, fallback: RGB): RGB {
  ctx.fillStyle = "#000";
  ctx.fillStyle = value.trim() || "#000";
  const hex = ctx.fillStyle;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

/**
 * What the backdrop learned about the GPU: "gpu" (it is drawing), "software" (no GPU: the page also
 * keeps the hero video and film grain off) or "unknown" (it failed for another reason, or took longer
 * than 4 s: the page keeps its other effects, as before).
 */
export type GpuVerdict = "gpu" | "software" | "unknown";

export function initBackdrop(host: HTMLElement): Promise<GpuVerdict> {
  let settle!: (v: GpuVerdict) => void;
  const verdict = new Promise<GpuVerdict>((resolve) => (settle = resolve));
  setTimeout(() => settle("unknown"), 4000);
  start(host, settle);
  return verdict;
}

function start(host: HTMLElement, settle: (v: GpuVerdict) => void): void {
  const canvas = document.createElement("canvas");
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas); // transparent (opacity 0) until the first frame is drawn

  const probe = document.createElement("canvas").getContext("2d")!;
  // Fixed per page, not the OS setting: only the admin panel (data-theme="light") is light.
  const dark = document.documentElement.dataset.theme !== "light";
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const dpr = Math.min(window.devicePixelRatio || 1, 1);

  const read = (): BackdropState => {
    const r = canvas.getBoundingClientRect();
    const css = getComputedStyle(document.documentElement);
    const chat = document.body.classList.contains("is-chat");
    const page = toRgb(probe, css.getPropertyValue("--page"), [1, 1, 1]);
    return {
      w: Math.max(1, Math.round(r.width)),
      h: Math.max(1, Math.round(r.height)),
      page,
      accent: toRgb(probe, css.getPropertyValue("--navy"), page),
      // Dark: a faint blue haze drifting over the near-black page. Light: barely there.
      accentAmt: dark ? (chat ? 0.09 : 0.18) : (chat ? 0.03 : 0.06),
      animate: !still.matches && !document.hidden,
    };
  };

  const ready = () => {
    settle("gpu");
    requestAnimationFrame(() => canvas.classList.add("is-on"));
  };
  let alive = true;
  const fail = (reason: FailReason) => {
    settle(reason === "software" ? "software" : "unknown");
    alive = false;
    canvas.remove(); // the CSS gradient stays
  };

  let send: (s: BackdropState) => void;
  if ("transferControlToOffscreen" in canvas && typeof Worker === "function") {
    try {
      const offscreen = canvas.transferControlToOffscreen();
      const worker = new Worker(new URL("./backdrop.worker.ts", import.meta.url), { type: "module" });
      const stop = (reason: FailReason) => { worker.terminate(); fail(reason); };
      worker.onmessage = (e: MessageEvent<string>) => (e.data === "ready" ? ready() : stop(e.data === "software" ? "software" : "error"));
      worker.onerror = () => stop("error");
      worker.postMessage({ canvas: offscreen, dpr, state: read() }, [offscreen]);
      send = (state) => worker.postMessage({ state });
    } catch {
      return fail("error");
    }
  } else {
    const update = createBackdropRenderer(canvas, dpr, ready, fail);
    update(read());
    send = update;
  }

  const refresh = () => alive && send(read());
  new ResizeObserver(refresh).observe(canvas);
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  still.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", refresh);
}
