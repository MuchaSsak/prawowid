# Web performance (Lighthouse)
What we did to the web app (`apps/web`) for Lighthouse performance, accessibility, best practices and SEO without changing how it looks, the scores, and how to re-check.

## Scores (Lighthouse 12, production build, 2026-11-21)
Mobile = Moto G emulation with simulated slow 4G and 4x CPU; desktop = Lighthouse desktop preset. Perf / A11y / Best practices / SEO.

| Page | Before (mobile) | After (mobile) | Before (desktop) | After (desktop) |
|---|---|---|---|---|
| `/` | 83 / 100 / 100 / 100 | 98 / 100 / 100 / 100 | 99 / 100 / 96 / 100 | 100 / 100 / 100 / 100 |
| `/prywatnosc` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/admin/analityka` | 0 / 100 / 100 / 50 | 99 / 100 / 100 / 63 | 0 / 100 / 100 / 50 | 100 / 100 / 100 / 63 |
| `/admin/dokumenty` | 90 / 100 / 79 / 50 | 99 / 100 / 79 / 63 | 100 / 94 / 74 / 50 | 100 / 100 / 78 / 63 |

Home on mobile: FCP 3.2 → 1.7 s, LCP 3.5 → 2.0 s, TBT 150 → 0 ms. Font bytes on the home page 350 → 110 KB.

**Deliberate ceilings** (not bugs):
- Admin SEO stays at 63: the pages are `noindex` on purpose (Lighthouse "page is blocked from indexing").
- `/admin/dokumenty` best practices 78-79: the Google Sheets preview iframe sets Google's own `NID` cookie (third-party cookie + inspector issue). Removing it would mean dropping or click-to-load previews, a visible change. Tried `credentialless` iframes (2026-11-21): best practices went to 96, but the Sheets preview turned into Google's cookie-consent prompt, so it was reverted.
- Home mobile FCP ~1.7 s is simulated slow-4G latency plus ~110 KB of fonts the first screen needs.

## What changed and why
- **CSS inlined** (`build.inlineStylesheets: "always"` in `astro.config.mjs`): the one small stylesheet no longer blocks the first paint, and font files are found straight from the HTML.
- **LCP poster**: the hero video's poster is the largest paint; now `prawdomat-bg-loop.webp` (q90 from the old jpg, 22 KB vs 34 KB, visually identical under the overlay) with `<link rel="preload" fetchpriority="high">`.
- **Video after load**: no `autoplay` attribute, `preload="none"`; `src/lib/hero-video.ts` starts it on `load`. The 0.8 MB file no longer competes with fonts and poster, and reduced-motion visitors never download it.
- **Film grain after load**: rasterising the SVG turbulence was the costliest paint (~150 ms on first paint), so `.has-grain` is added a frame after load and the layer fades in; the finished frame is unchanged.
- **Backdrop off the main thread**: `ogl` removed; `src/lib/backdrop-gl.ts` is the same shader in plain WebGL, run by `src/lib/backdrop.worker.ts` on an OffscreenCanvas (main-thread fallback where OffscreenCanvas is missing), started when the page is idle after load. The first WebGL context blocked the page ~350 ms while the browser started its GPU process. Shader compile uses `KHR_parallel_shader_compile`. `failIfMajorPerformanceCaveat` skips it on software-only WebGL (no GPU), where the CSS gradient stays instead of a CPU-burning shader.
- **Sample data on demand**: `@prawdowid/core/mock` fixtures are a dynamic import, loaded only with `?test=true`.
- **Fonts** (`scripts/build-fonts.py`, output in `src/assets/fonts/`, faces in `global.css`):
  - Newsreader pinned at weight 400 (every Newsreader text on the site is 400, checked across all 21 sample answers and the admin pages); optical size stays variable; pixel-identical, 132 → 57 KB.
  - Polish letters (ĄĆĘŁŃŚŹŻ) from 4-6 KB subsets declared last with a Polish-only `unicode-range`, so the 36-88 KB latin-ext files load only for other letters.
  - Metric-matched fallback faces (`Newsreader Fallback`, `Inter Tight Fallback` by weight range, `size-adjust` measured in Chrome) so the font swap barely moves text.
- **Layout shift on `/admin/dokumenty`** (CLS 0.17-0.35 → 0): at ≤412 px the admin top bar's nav wrapped or unwrapped by ~2 px as fonts arrived; it now always breaks at ≤412 px, where it wrapped anyway.
- **`/admin/analityka` had no LCP** (performance 0): the lock card rose from `opacity: 0`, which Chrome ignores for LCP; the keyframe now starts at `.01`.
- **Accessibility**: the 12 px "PANEL" sidebar label was 3.2:1; now `rgb(0 12 31 / .6)`, 5.2:1.
- **SEO**: meta descriptions on admin pages, `robots.txt` (allow all, so crawlers can see `noindex`) and `sitemap.xml` (public pages, only when `PUBLIC_SITE_URL` is set), WebApplication JSON-LD on the home page, apple-touch-icon (`logo-512.jpg`).
- **Ultrawide**: the admin content column is capped at 1760 px and centred (no change up to a 1992 px window); public pages were already centred.

## How it was validated
- Pixel diffs of a baseline build (worktree of `dce53ec`) against the new build at 320, 390, 768, 1280, 2560 and 3440 px, with `Math.random` and `Date` frozen: privacy, admin lock screen and the chat screen (full-screen WebGL backdrop) are 0 px different; other differences were only the intended ones (label color, ultrawide cap) or other people's same-day changes.
- Functional paths: normal, no OffscreenCanvas, no GPU, reduced motion, `?test=true` answer; zero console errors. `astro check` clean.

## Re-checking
Build (`bun run build` in `apps/web`), `bun --bun astro preview`, then run Lighthouse (CLI or the Chrome DevTools panel) on `/`, `/prywatnosc/`, `/admin/analityka/`, `/admin/dokumenty/` in mobile and desktop mode. After upgrading `@fontsource-variable/*`, rerun `scripts/build-fonts.py` (needs `pip install fonttools brotli`).
