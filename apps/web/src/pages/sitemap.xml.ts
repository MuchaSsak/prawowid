import type { APIRoute } from "astro";

// The public, indexable pages. Admin pages are noindex and stay out. Absolute URLs need the public
// origin (PUBLIC_SITE_URL); without it the list is empty and robots.txt does not point here.
const PAGES = ["/", "/prywatnosc"];

export const GET: APIRoute = ({ site }) => {
  const urls = site ? PAGES.map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`) : [];
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, "</urlset>", ""].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
