/**
 * The living backdrop: the hero panel's soft radial gradient, redrawn by an OGL fragment shader
 * so it drifts slowly on its own (no pointer input). Low contrast by design: it should read as the
 * same calm panel, just not frozen. Colors come from the CSS tokens, so it follows light/dark mode
 * and the chat state (flat page color + a faint accent haze).
 * Cheap on phones: device-pixel-ratio capped at 1, ~30 fps, paused when the tab is hidden, one
 * static frame under prefers-reduced-motion, and the plain CSS gradient stays as the fallback.
 */
import { Mesh, Program, Renderer, Triangle } from "ogl";

const vertex = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uHi;
uniform vec3 uLo;
uniform vec3 uAccent;
uniform float uAccentAmt;
uniform float uWarp;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.02; a *= 0.5; }
  return v;
}

void main() {
  float t = uTime * 0.05;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(vUv.x * aspect, vUv.y) * 1.6;

  // Domain-warped flow field: two slow layers drifting in different directions.
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.7, 0.0)));
  float flow = fbm(p + 1.7 * q + vec2(t * 0.4, -t * 0.25));

  // The same radial gradient as the CSS fallback (120% x 80% ellipse at 50% 28%), its centre
  // breathing a little and its edge warped by the flow.
  vec2 c = vec2(0.5 + 0.04 * sin(t * 1.3), 0.72 + 0.03 * cos(t * 0.9));
  float d = length((vUv - c) / vec2(1.2, 0.8));
  d += (flow - 0.5) * uWarp;
  vec3 col = mix(uHi, uLo, clamp(d / 0.62, 0.0, 1.0));

  // A faint accent haze riding the flow.
  float haze = smoothstep(0.35, 0.85, flow);
  col = mix(col, uAccent, haze * uAccentAmt);

  // Dither so the very low-contrast gradient never bands.
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

type RGB = [number, number, number];

function toRgb(ctx: CanvasRenderingContext2D, value: string, fallback: RGB): RGB {
  ctx.fillStyle = "#000";
  ctx.fillStyle = value.trim() || "#000";
  const hex = ctx.fillStyle;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

export function initBackdrop(host: HTMLElement): void {
  let renderer: Renderer;
  try {
    renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 1), alpha: false, antialias: false, powerPreference: "low-power" });
  } catch {
    return; // no WebGL: the CSS gradient stays
  }
  const gl = renderer.gl;
  if (!gl) return;
  const canvas = gl.canvas as HTMLCanvasElement;
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);

  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: [1, 1] },
      uHi: { value: [0, 0, 0] },
      uLo: { value: [0, 0, 0] },
      uAccent: { value: [0, 0, 0] },
      uAccentAmt: { value: 0 },
      uWarp: { value: 0 },
    },
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  const probe = document.createElement("canvas").getContext("2d")!;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const readColors = () => {
    const css = getComputedStyle(document.documentElement);
    const chat = document.body.classList.contains("is-chat");
    const u = program.uniforms;
    const page = toRgb(probe, css.getPropertyValue("--page"), [1, 1, 1]);
    u.uHi.value = chat ? page : toRgb(probe, css.getPropertyValue("--panel-hi"), page);
    u.uLo.value = chat ? page : toRgb(probe, css.getPropertyValue("--panel"), page);
    u.uAccent.value = toRgb(probe, css.getPropertyValue("--navy"), page);
    // Dark: a faint blue glow is enough to feel alive. Light: barely there, it would read as dirt.
    u.uAccentAmt.value = dark.matches ? (chat ? 0.035 : 0.06) : (chat ? 0.012 : 0.025);
    u.uWarp.value = chat ? 0 : 0.28;
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const hgt = Math.max(1, Math.round(r.height));
    renderer.setSize(w, hgt);
    // OGL writes pixel sizes inline; drop them so CSS (100% of the frame / viewport) stays in charge.
    canvas.style.width = "";
    canvas.style.height = "";
    program.uniforms.uRes.value = [w, hgt];
  };

  const start = performance.now() - Math.random() * 60_000; // a different flow on each visit
  let last = 0;
  let raf = 0;
  const draw = (now: number) => {
    program.uniforms.uTime.value = (now - start) / 1000;
    renderer.render({ scene: mesh });
  };
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return; // ~30 fps is plenty for motion this slow
    last = now;
    draw(now);
  };
  const run = () => {
    cancelAnimationFrame(raf);
    if (still.matches) draw(performance.now());
    else raf = requestAnimationFrame(loop);
  };

  const refresh = () => {
    readColors();
    resize();
    draw(performance.now());
  };

  new ResizeObserver(refresh).observe(canvas);
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  dark.addEventListener("change", refresh);
  still.addEventListener("change", run);
  document.addEventListener("visibilitychange", () => (document.hidden ? cancelAnimationFrame(raf) : run()));
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); canvas.remove(); });

  refresh();
  run();
  requestAnimationFrame(() => canvas.classList.add("is-on"));
}
