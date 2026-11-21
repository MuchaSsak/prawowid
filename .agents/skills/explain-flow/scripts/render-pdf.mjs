#!/usr/bin/env node
// Render an explain-flow HTML file to an A4 PDF (and a PNG preview) with a locally installed
// Chrome, Edge or Chromium in headless mode. No npm dependencies.
//
// Usage: node render-pdf.mjs <input.html> [output.pdf]
// Browser: set CHROME_PATH to override autodetection.
// Prints the PDF path, its page count and the preview PNG path; exits non-zero on failure.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , inArg, outArg] = process.argv;
if (!inArg) {
  console.error("Usage: node render-pdf.mjs <input.html> [output.pdf]");
  process.exit(2);
}
const input = resolve(inArg);
if (!existsSync(input)) {
  console.error(`Input not found: ${input}`);
  process.exit(2);
}
const output = resolve(outArg ?? input.replace(/\.html?$/i, "") + ".pdf");
const preview = output.replace(/\.pdf$/i, "") + "-preview.png";

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    try {
      const p = execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" })
        .split(/\r?\n/)[0].trim();
      if (p) return p;
    } catch { /* not found */ }
  }
  return null;
}

const browser = findBrowser();
if (!browser) {
  console.error("No Chrome, Edge or Chromium found. Set CHROME_PATH, or deliver the .html (it prints to PDF from any browser).");
  process.exit(3);
}

const url = pathToFileURL(input).href;
const common = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars"];
try {
  execFileSync(browser, [...common, "--no-pdf-header-footer", `--print-to-pdf=${output}`, url], { stdio: "pipe", timeout: 90_000 });
} catch (e) {
  console.error(`PDF render failed: ${e.message}`);
  process.exit(4);
}
if (!existsSync(output) || statSync(output).size < 1000) {
  console.error(`PDF missing or empty: ${output}`);
  process.exit(4);
}

// Count pages: Chrome writes uncompressed /Type /Page dictionaries.
const pages = (readFileSync(output, "latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

// Preview PNG at A4 width (794 CSS px), tall enough for a few pages, for a visual check.
let previewOk = false;
try {
  execFileSync(browser, [...common, `--screenshot=${preview}`, "--window-size=794,3400", url], { stdio: "pipe", timeout: 90_000 });
  previewOk = existsSync(preview);
} catch { /* preview is best-effort */ }

console.log(`PDF: ${output}`);
console.log(`Pages: ${pages || "unknown"}`);
console.log(`Preview: ${previewOk ? preview : "not created"}`);
