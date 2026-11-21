/**
 * Files listed on /admin/dokumenty. One entry per file; add a deck or a PDF by adding an entry.
 *
 * `url`: where the card opens. A Google Sheets, Docs, Slides or Drive link gets its embed URL
 * derived (the file must be shared as "anyone with the link can view"); a local file in
 * `public/` (e.g. a PDF) is previewed directly. Leave `url` empty until the file has a link:
 * the card then shows a placeholder and only the `download` link.
 */
export type AdminDocument = {
  title: string;
  description: string;
  url: string;
  /** Optional local copy for download, a path under `public/`. */
  download?: { href: string; label: string };
};

export const documents: AdminDocument[] = [
  {
    title: "Koszt 1000 sprawdzeń",
    description: "Koszt 1000 sprawdzeń, utrzymanie kanałów i zachowanie pod obciążeniem.",
    url: "https://docs.google.com/spreadsheets/d/1D6go2MeyFnhprEzkjBkmr-XGPP7ujAMxQzEeebbAml0/edit?gid=2131606200",
  },
  {
    title: "Prezentacja dla jury",
    description: "10 slajdów: problem, demo, architektura, wyniki, ryzyka i pilotaż. Notatki z pięciominutowym scenariuszem.",
    url: "https://docs.google.com/presentation/d/1uC4f8bR6BtkHHww_MXOA5SvWwWdSlTkVEySPFjCXwfc/edit?usp=sharing",
  },
];

/** The URL to load in the preview iframe, or null when there is nothing to preview. */
export function embedUrl(url: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url, "https://local.invalid");
  } catch {
    return null;
  }
  if (u.hostname === "local.invalid") return u.pathname; // a file served from public/
  if (u.hostname === "docs.google.com") {
    const m = u.pathname.match(/^\/(spreadsheets|document|presentation)\/d\/([\w-]+)/);
    if (!m) return null;
    const [, type, id] = m;
    const tail = type === "presentation" ? "embed?start=false&loop=false" : "preview";
    return `https://docs.google.com/${type}/d/${id}/${tail}`;
  }
  if (u.hostname === "drive.google.com") {
    const m = u.pathname.match(/^\/file\/d\/([\w-]+)/);
    return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
  }
  return null;
}
