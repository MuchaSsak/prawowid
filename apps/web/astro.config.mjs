import { defineConfig } from "astro/config";

// Public origin of the web app, needed for absolute og:image / og:url (link previews on Discord,
// Messenger, WhatsApp). Set PUBLIC_SITE_URL at build time; Vercel / Netlify / Cloudflare Pages
// provide their own variable as a fallback. Without it the tags fall back to relative paths and
// most chat apps show no banner.
const env = process.env;
const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
const site = env.PUBLIC_SITE_URL || (vercel ? `https://${vercel}` : undefined) || env.URL || env.CF_PAGES_URL || undefined;

// Static site: the page talks to the API over HTTP (PUBLIC_API_URL, default http://localhost:8787).
export default defineConfig({
  site,
  server: { port: 4321 },
  // One small stylesheet per page: inlined, it no longer blocks the first paint (Lighthouse
  // "render-blocking resources"), and the font files are discovered straight from the HTML.
  build: { inlineStylesheets: "always" },
  devToolbar: { enabled: false },
});
