"""
Builds the self-hosted web font files in src/assets/fonts/ from the Fontsource packages.
global.css declares them with @font-face. Rerun after upgrading @fontsource-variable/newsreader or
@fontsource-variable/inter-tight:

    pip install fonttools brotli
    python apps/web/scripts/build-fonts.py

1. Newsreader pinned at weight 400. Every Newsreader text on the site is 400 (headline, brand,
   answer titles, quotes, admin headings); the weight axis made up more than half of each file. The
   optical-size axis stays variable. Same outlines at 400: renders pixel-identical, about 55% smaller.
2. Polish letters (Ą Ć Ę Ł Ń Ś Ź Ż, both cases) cut out of the latin-ext files into tiny files.
   global.css gives them a Polish-only unicode-range, so a Polish page skips the ~36-88 KB latin-ext
   files, which still load on demand for other letters (ř, ő, ș ...).

Inter Tight keeps its weight axis (the UI uses 400 to 700); only its Polish subset is made here.
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "src" / "assets" / "fonts"
POLISH = "U+0104-0107,U+0118-0119,U+0141-0144,U+015A-015B,U+0179-017C"


def fontsource_file(package: str, name: str) -> Path:
    hits = sorted((WEB.parent.parent / "node_modules").rglob(f"@fontsource-variable/{package}/files/{name}"))
    if not hits:
        raise SystemExit(f"not found: {package}/{name} (run bun install)")
    return hits[0]


def save(font: TTFont, name: str) -> Path:
    font.flavor = "woff2"
    path = OUT / name
    font.save(path)
    print(f"{path.relative_to(WEB)}  {path.stat().st_size // 1024} KB")
    return path


def polish_subset(src: Path, name: str) -> None:
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.flavor = "woff2"
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(POLISH))
    sub.subset(font)
    save(font, name)


OUT.mkdir(parents=True, exist_ok=True)
for part in ["latin", "latin-ext", "vietnamese"]:
    font = instancer.instantiateVariableFont(
        TTFont(fontsource_file("newsreader", f"newsreader-{part}-opsz-normal.woff2")), {"wght": 400}
    )
    saved = save(font, f"newsreader-{part}-opsz400.woff2")
    if part == "latin-ext":
        polish_subset(saved, "newsreader-polish-opsz400.woff2")

polish_subset(fontsource_file("inter-tight", "inter-tight-latin-ext-wght-normal.woff2"), "inter-tight-polish-wght.woff2")
