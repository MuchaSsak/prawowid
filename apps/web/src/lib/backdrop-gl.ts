/**
 * The backdrop's WebGL renderer, shared by the worker (src/lib/backdrop.worker.ts, the normal path)
 * and the main-thread fallback (src/lib/backdrop.ts). Plain WebGL, no library. The page tells it
 * the canvas size, the colors and whether to animate; it draws a faint blue haze that drifts slowly.
 * Spread over several frames so it never blocks for long: the context and the shader compile start
 * in the first call; with KHR_parallel_shader_compile the GPU compiles in the background and later
 * frames only poll; the first frame is drawn once the program has linked.
 */
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
  float t = uTime * 0.09;
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
  float haze = smoothstep(0.3, 0.8, flow);
  col = mix(col, uAccent, haze * uAccentAmt);

  // Dither so the very low-contrast gradient never bands.
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;


export type RGB = [number, number, number];

/** What the page decides; the renderer only draws it. */
export interface BackdropState {
  /** CSS size of the canvas in px. */
  w: number;
  h: number;
  /** Page color (both ends of the gradient) and the accent haze over it. */
  page: RGB;
  accent: RGB;
  accentAmt: number;
  /** false under reduced motion or in a hidden tab: one still frame. */
  animate: boolean;
}

const ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: "low-power",
  // No context when WebGL would only run in software (SwiftShader, blocklisted drivers, GPU-less
  // servers): there the fbm shader would burn the CPU at 30 fps, so the CSS gradient stays instead.
  failIfMajorPerformanceCaveat: true,
};

// One triangle that covers the screen: (x, y, u, v) per vertex.
const TRIANGLE = new Float32Array([-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2]);

// requestAnimationFrame exists in windows and (in current browsers) in dedicated workers.
const nextFrame: (cb: (now: number) => void) => number =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const cancelFrame: (id: number) => void =
  typeof cancelAnimationFrame === "function" ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

/**
 * Starts the renderer on `canvas` and returns the function that feeds it the page state. Calls
 * `onReady` after the first frame is drawn and `onFail` when there is no fast WebGL, the shader does
 * not link or the context is lost (the CSS gradient then stays).
 */
export function createBackdropRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  dpr: number,
  onReady: () => void,
  onFail: () => void,
): (state: BackdropState) => void {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (canvas.getContext("webgl2", ATTRS) ?? canvas.getContext("webgl", ATTRS)) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) {
    onFail();
    return () => {};
  }
  const g = gl;

  const shader = (type: number, source: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, source);
    g.compileShader(s);
    return s;
  };
  const program = g.createProgram()!;
  g.attachShader(program, shader(g.VERTEX_SHADER, vertex));
  g.attachShader(program, shader(g.FRAGMENT_SHADER, fragment));
  g.linkProgram(program);

  let state: BackdropState | null = null;
  let apply: ((s: BackdropState) => void) | null = null;
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    apply = null;
    onFail();
  };
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); fail(); });

  const parallel = g.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  const whenLinked = () => {
    if (failed) return;
    if (parallel && !g.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
      nextFrame(whenLinked);
      return;
    }
    if (!g.getProgramParameter(program, g.LINK_STATUS)) return fail();
    apply = start(g, program, canvas, dpr, () => failed);
    if (state) apply(state);
    onReady();
  };
  // Without the extension the status check blocks until linked, so it gets a task of its own.
  if (parallel) nextFrame(whenLinked);
  else setTimeout(whenLinked, 0);

  return (s) => {
    state = s;
    apply?.(s);
  };
}

function start(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  dpr: number,
  stopped: () => boolean,
): (s: BackdropState) => void {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, TRIANGLE, gl.STATIC_DRAW);
  for (const [name, offset] of [["position", 0], ["uv", 8]] as const) {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, offset);
  }
  const loc = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    time: loc("uTime"), res: loc("uRes"), hi: loc("uHi"), lo: loc("uLo"),
    accent: loc("uAccent"), accentAmt: loc("uAccentAmt"), warp: loc("uWarp"),
  };
  gl.uniform1f(u.warp, 0);

  const t0 = performance.now() - Math.random() * 60_000; // a different flow on each visit
  let last = 0;
  let frame = 0;
  const draw = (now: number) => {
    gl.uniform1f(u.time, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const loop = (now: number) => {
    if (stopped()) return;
    frame = nextFrame(loop);
    if (now - last < 33) return; // ~30 fps is plenty for motion this slow
    last = now;
    draw(now);
  };

  return (s) => {
    const w = s.w * dpr;
    const h = s.h * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.res, s.w, s.h);
    gl.uniform3fv(u.hi, s.page);
    gl.uniform3fv(u.lo, s.page);
    gl.uniform3fv(u.accent, s.accent);
    gl.uniform1f(u.accentAmt, s.accentAmt);
    draw(performance.now());
    cancelFrame(frame);
    if (s.animate) frame = nextFrame(loop);
  };
}
