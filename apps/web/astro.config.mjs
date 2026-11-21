import { defineConfig } from "astro/config";

// Static site: the page talks to the API over HTTP (PUBLIC_API_URL, default http://localhost:8787).
export default defineConfig({
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
