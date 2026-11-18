# sumi guide

A template for a folder of single-file HTML explainers. The layout and palette are modelled on [Quartz](https://github.com/jackyzha0/quartz)'s default theme, but sumi is not a Quartz plugin and needs nothing installed beyond Python 3.

Each page gets a light theme, a left sidebar with search and a link graph, the article in the centre, a right sidebar with the table of contents and backlinks, and hand-drawn doodles in the empty space below both sidebars. The index page is the page list. Fonts (Hanken Grotesk, JetBrains Mono) are bundled, so everything works offline by double-clicking a file.

This repo holds only the template. The pages it styles live outside it.

## What's here

| File | Role |
|---|---|
| `quartz.css` | Theme: palette, typography, sidebar layout |
| `quartz.js` | Builds the sidebars at page load, rewrites each page's fonts, handles narrow windows |
| `build.py` | Copies the theme next to the pages and adds two `<script>` lines to each page |
| `doodles/` | Margin doodle SVGs and `doodles.json`, their order and tilt. `build.py` inlines them into `quartz-data.js` |
| `fonts/` | Bundled `.woff2` files. Only Hanken Grotesk and JetBrains Mono are used; the others came from the font comparison in `font-compare.html`. All are under the SIL Open Font License; each family's license is in `fonts/licenses/` |
| `starter-index.html` | Empty landing page (search + card grid) for a new folder |
| `starter-example.html` | Minimal page showing the structure the shell expects |

## Setting up a new folder

Clone the template once, anywhere, and keep your pages in a separate folder. `build.py` acts on the current directory, or on the folder passed with `--dir`:

```
git clone https://github.com/jinglin-l/sumi.git ~/sumi
mkdir ~/my-explainers && cd ~/my-explainers
cp ~/sumi/starter-index.html index.html
cp ~/sumi/starter-example.html example.html
python3 ~/sumi/build.py --all
open index.html
```

It refuses to run in a folder without an `index.html`.

## Adding a page

1. Write `<topic>.html` with a plain `<header><h1>…</h1><p>…</p></header>`, `<h2>` sections, and page CSS that uses the variables `--bg`, `--text`, `--muted`, `--border`, `--accent`, `--accent-soft`.
2. Add a card for it to `index.html` above the `insert-here` marker. The card's tag becomes the page's category (breadcrumb, search, and graph).
3. Run `python3 ~/sumi/build.py --all` from the pages folder (or add `--dir ~/my-explainers`). It's safe to rerun, and it keeps file modification dates, which the pages display.

## Code blocks

Every `<pre>` gets three things from the shell, with no page code needed:

- a **Copy** button on hover;
- **typing practice**: click a block and it clears so you can retype it (Enter auto-indents, Tab skips leading spaces, Backspace undoes, Esc or clicking elsewhere stops). Dragging still selects text;
- **hover notes**, if the page defines them: give the block `data-note-key="k"` and define a global `LINE_NOTES_BY_KEY = { k: { 0: 'html note', 2: '…' } }` (0-indexed lines; skip lines with nothing to say). `starter-example.html` shows one.

A wrong keystroke buzzes and finishing a block chimes. If the page defines its own `buzz()` and `chime()` (for example behind a sound toggle), those are used instead.

## Local add-ons

If the pages folder contains a `quartz-local.js`, `build.py` loads it on every page after `quartz.js`. Use it for folder-specific scripts that shouldn't live in the template. Without the file nothing is injected.

## Glossary

Define the page's jargon once and the shell does the rest:

```js
const GLOSSARY = [
  { term: 'Scope', match: ['scope', 'scopes'], def: 'A named, saved filter on a Rails model.' },
];
```

Every use of a `match` form in the prose (case-insensitive, whole words; defaults to `[term]`) gets a dotted underline with the definition on hover, including text the page inserts later. Code blocks, headings, buttons, links, and SVG are left alone. The full list fills `<section id="words">` (inserted after the header if the page has none). `match: []` lists a term without underlining it, and wrapping content in `class="q-noterm"` (a demo table, say) keeps it plain.

## Doodles

The doodles fill whatever space is left below each sidebar's panels, alternate sides down the page, and scroll with it. Hovering one redraws it stroke by stroke. They hide on phone-width windows and wherever a sidebar has less than ~140px free. To add one, drop an SVG in the same format (`class="doodle-svg"`, paths with `pathLength="1"` and `--dur`/`--delay` styles) into `doodles/`, list it in `doodles.json`, and rebuild.

`build.py --strip` removes the shell from every page. `build.py --preview a b` writes shelled copies of `a.html` and `b.html` to `quartz-preview/` without touching the originals.

Edit the theme here in the repo, never the copies `build.py` writes next to the pages, since the next build overwrites them.

## License

Code, doodles and starter pages: MIT (see `LICENSE`). Fonts: SIL Open Font License 1.1, under their original authors' copyrights (see `fonts/licenses/`).
