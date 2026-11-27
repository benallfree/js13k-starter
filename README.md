# js13k starter

A starting point for a [js13k](https://js13kgames.com) game: write readable source in `src/`, and the tools turn it
into one self-contained `index.html`, pack it as small as the conventional pipeline gets, and tell you how it sits
against the 13,312-byte zip limit. It includes a tiny sample game (Starfall: fly a ship, catch the stars) that
exercises every step.

What you get:

- **A one-file build** (`tools/build.mjs`): follows `src/main.js` and its imports into a single page, strips comments
  at build time (strings, template literals and regexes are left alone), inlines your JSON data files, and stamps the
  git commit into the page so you always know which build you're looking at.
- **Size tooling**: `npm run baseline` packs the build with terser, then
  [roadroller](https://github.com/lifthrasiir/roadroller), then a Zopfli zip (advzip), and prints raw, gzip, Brotli and
  zip sizes against the budget. `npm run ship` adds [surprisal](https://github.com/benallfree/surprisal) (an LLM-based
  compressor) when it's installed.
- **A roadroller parameter search** that finds smaller settings for your build and saves them for every later baseline.
- **A dev server** that rebuilds on every reload, and serves the packed page too.
- **A GitHub Pages workflow** that publishes the build on every push to `main`.
- **Release zips**: `npm run release` packs a clean copy of the starter; a version tag publishes it as a GitHub Release.
- **`AGENTS.md`**: conventions and code facts for AI coding agents (and humans) working in the repo.

## Quick start

Needs Node 20 or newer. For the best zip numbers, install advzip (`brew install advancecomp` on macOS,
`sudo apt install advancecomp` on Debian/Ubuntu); without it the tools fall back to `zip -9`.

```bash
npm install
```

```bash
npm start
```

Open http://127.0.0.1:8013/. Edit anything in `src/` and reload: the page rebuilds on each load.

```bash
npm run baseline
```

Builds, packs `dist/roadroller/index.zip` and prints the size table. Play the packed page at
http://127.0.0.1:8013/roadroller/ to make sure packing didn't break anything.

```bash
npm run ship
```

The same, plus surprisal if it's installed (see below).

| command | what it does |
|---|---|
| `npm start` | dev server on port 8013 (`PORT=9000 npm start` for another); rebuilds on every page load |
| `npm run build` | writes `dist/index.html` |
| `npm run baseline` | build, terser + roadroller + zip, size table |
| `npm run ship` | the baseline, plus surprisal at `-3` when it's installed; `npm run ship -1` picks another level |
| `npm run baseline:cheap` | greedy sweep of terser options that pack smaller under roadroller; saves the best |
| `npm run baseline:search` | roadroller parameter search (1,000 evaluations); saves the best |
| `npm run release` | `release/js13k-starter-<version>.zip`, a clean copy of the starter |

## Layout

```
src/
  index.html      page shell: markup, CSS, <!--JSON:level--> and <!--CODE--> markers
  main.js         entry point; the build follows its relative imports
  world.js        a second module (game state, rules, drawing)
  level.json      the level data, pretty JSON with named keys
tools/
  build.mjs       src/ -> dist/index.html
  strip.mjs       the comment stripper
  serve.mjs       dev server
  roadroll.mjs    terser -> roadroller -> zip baseline
  roadroll-search.mjs   searches for better terser and roadroller settings
  ship.mjs        the size report
  release.mjs     the release zip
.github/workflows/
  pages.yml       deploy to GitHub Pages
  release.yml     publish a release zip on a version tag
```

## How the build works

- **Modules.** `src/main.js` is the entry. Each `import { x } from './file.js'` pulls `src/file.js` in, dependencies
  first, each once. The modules are joined into one `<script type="module">`, so they share one scope: top-level names
  must be unique across files. Keep each import on one line.
- **Comments** are stripped from the code when it's built, so write as many as you like; they never ship.
- **Data.** Put `<!--JSON:name-->` inside `<script type="application/json" id="name">` in `src/index.html`, and the
  build drops in `src/name.json`. Read it in code with exactly
  `JSON.parse(document.getElementById('name').textContent)`: the baseline looks for that expression to move the data
  into the packed code.
- **Build ID.** Every `BUILD_ID` in the code becomes the short git commit of the build, with `+` when `src/` has
  uncommitted changes (`dev` outside a git checkout). The sample shows it in the bottom-right corner.
- **Libraries from a CDN.** Imports that aren't relative (`import * as THREE from 'three'`) are kept and hoisted to
  the top, to be resolved by an import map in `index.html`. Check your js13k category's rules first: most categories
  don't allow external libraries.

## The size workflow

js13k's limit is a **13,312-byte zip**. Two numbers matter for that:

- **The build zipped as is** (`dist/index.zip`).
- **The baseline** (`dist/roadroller/index.zip`): terser minifies and mangles, roadroller packs the JS into a
  self-decoding script, and advzip writes the smallest Deflate zip it can find. This is the best-known conventional
  pipeline. On a tiny game it's about the same as the plain zip; on a big one it's far smaller.

`npm run ship` prints both, plus gzip and Brotli for reference.

### Squeezing the baseline

- `npm run baseline:cheap` tries turning off terser's compress transforms one at a time and keeps any that make the zip
  smaller. Less compression often packs smaller, because roadroller predicts plain code better.
- `npm run baseline:search` runs roadroller's exhaustive optimizer in rounds, measuring every improvement as a real zip.
  `node tools/roadroll-search.mjs --evals 4000 --jobs 4` spreads more work over 4 processes. Most of the gain comes in
  the first 1,000 evaluations.

Both write `tools/roadroller-best.json` (pretty JSON). After that, `npm run baseline` reuses the saved settings
without searching. It notes when they were found on a different build. They usually still help, but rerun the search
now and then. `ROADROLLER_PARAMS=none` ignores the file, and `ROADROLLER_O=1` adds a quick optimization pass on top.

### surprisal (optional)

[surprisal](https://github.com/benallfree/surprisal) is a lossless compressor driven by a code language model. js13k
doesn't accept its archives; it's a measure of how small the same code gets when the compressor understands code. If
it's installed, `npm run ship` runs it on `dist/index.html` and adds a row:

```bash
npm run ship
```

```bash
npm run ship -1
```

```bash
SURPRISAL=/path/to/surprisal npm run ship
```

It's found through the `SURPRISAL` environment variable, else `surprisal` on your `PATH`; if neither is there, ship
skips it and prints the zip sizes. The default level is `-3`. `-0` to `-9` pick another (higher is smaller and slower;
levels 7 to 9 use a 7B model). `npm run ship -1` works because npm passes `-1` through as `npm_config_1`; npm warns
about an unknown config, which is harmless. `npm run ship -- -1` does the same without the warning.

## Writing data

Write game data (levels, maps, sprites, dialog, music) as **pretty-printed JSON with descriptive keys**, like
`src/level.json`, and keep it in its own file.

- Under an LLM compressor, plain readable JSON is the smallest form. It beats compact custom formats, minified JSON and
  positional arrays, even though it's several times bigger raw.
- Under zip and roadroller, compact formats win. The baseline minifies the JSON and inlines it as an object literal
  either way, so pretty source costs you nothing there.
- Pick the measure you're optimizing for before you invent a compact format; the two pull in opposite directions.
  `AGENTS.md` has the details.

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. In the repo's Settings, under Pages, set Source to **GitHub Actions**.
3. Every push to `main` builds `dist/index.html` and publishes it (`.github/workflows/pages.yml`).

The deploy step occasionally fails on GitHub's side with "No artifacts named github-pages". The workflow retries it
once after 30 seconds; if it still fails, re-run the job.

## Releases

`npm run release` writes `release/js13k-starter-<version>.zip` (the name and version come from `package.json`). It holds
one folder with the starter's files: in a git checkout, the files git tracks plus untracked files that aren't ignored;
`node_modules`, `.git`, `dist` and `release` are always left out.

To publish one:

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
3. `.github/workflows/release.yml` checks the tag matches `package.json`, installs, builds, runs the baseline, packs the
   zip and attaches it to a new GitHub Release with generated notes. A version with a pre-release part
   (`1.0.0-alpha.1`) becomes a GitHub pre-release.

## Starting your own game

Download a release zip (or use this repo as a template), then:

1. Replace `src/main.js`, `src/world.js` and `src/level.json` with your game. Keep `main.js` as the entry.
2. Change the `<title>` and the markup in `src/index.html`; keep the `<!--CODE-->` marker.
3. Rename the package in `package.json`.

## License

MIT
