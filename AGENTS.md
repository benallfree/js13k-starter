# AGENTS.md

Facts and conventions for working in this repo. It's a js13k game starter: readable source in `src/`, built into one
`dist/index.html`, measured against js13k's 13,312-byte zip limit.

## Commands

| command | what it does |
|---|---|
| `npm install` | dev dependencies (terser, roadroller); the build itself needs only Node |
| `npm start` | dev server on 127.0.0.1:8013; rebuilds on every load of `/`; `/roadroller/` serves the packed page |
| `npm run build` | `src/` -> `dist/index.html` |
| `npm run baseline` | build, then terser -> roadroller -> advzip; prints the size table |
| `npm run ship` | the baseline plus surprisal at `-3` if installed; `npm run ship -N` or `npm run ship -- -N` for level N |
| `npm run baseline:cheap` / `npm run baseline:search` | tune the baseline; write `tools/roadroller-best.json` |
| `npm run release` | `release/js13k-starter-<version>.zip` |

There are no tests. To check a change: `npm run build`, open the page, and check the console has no errors. If the
change could affect packing, run `npm run baseline` and play `/roadroller/` too.

## How the build works (`tools/build.mjs`)

- The entry is `src/main.js`. Relative imports (`import { a } from './b.js'`) are followed depth-first and each module
  is included once, dependencies first. Relative import lines are dropped and a leading `export ` is removed, so all
  modules share **one scope**: top-level names must not repeat across files. Import statements must fit on one line.
- Non-relative imports (`from 'three'`) are kept and hoisted; an import map in `src/index.html` would resolve them.
- Comments are stripped by `tools/strip.mjs`, a small scanner that skips strings, template literals (with `${}`
  nesting) and regex literals. Whitespace, names and line breaks are kept as written.
- `<!--JSON:name-->` in `src/index.html` becomes the contents of `src/name.json`. It belongs inside
  `<script type="application/json" id="name">`, placed before the module script.
- Data is read with exactly `JSON.parse(document.getElementById('name').textContent)`, once per tag.
  `tools/roadroll.mjs` replaces that expression with an object literal and fails loudly if it can't find it.
- `BUILD_ID` anywhere in the code becomes the short git commit (`+` if `src/` is dirty, `dev` with no git). Don't use
  `BUILD_ID` as an identifier.

## Size tooling

- `tools/roadroll.mjs` is the conventional baseline: terser (module, mangle, compress), roadroller, then advzip
  `-4 -i 1000`, falling back to `zip -9` when advzip is missing. Output goes to `dist/roadroller/index.html` and
  `index.zip`. Env: `ROADROLLER_O` (optimization level; default 1, or 0 when saved settings exist),
  `ROADROLLER_PARAMS` (settings file, or `none`), `ADVZIP_ITER`.
- `tools/roadroll-search.mjs` writes `tools/roadroller-best.json` (terser options, JSON inlining, roadroller params,
  and a record of the input it was found on). `--cheap` sweeps terser options; the default mode searches roadroller
  params (`--evals`, `--jobs`). The file is per-game: commit it if you want CI and teammates to reuse it.
- `tools/ship.mjs` prints raw, gzip, Brotli, the plain zip, the baseline zip and, if found, surprisal. surprisal comes
  from `SURPRISAL` (path or command) or `surprisal` on `PATH`. A missing binary is skipped with a note, unless
  `SURPRISAL` was set explicitly, which makes it an error. `npm run ship -N` reaches the script as `npm_config_N`.
- Long-running tools print a timestamped line before and after each step. Keep that when you change them.

## Writing code that packs small

The two size measures reward different things. js13k counts the zip, so that is the default target. surprisal
(an LLM compressor) is the alternative measure.

For both:

- Write readable, idiomatic code with real names. Don't hand-minify: terser does it for the zip path, and it makes
  surprisal output bigger.
- Keep comments in the source. They're stripped at build time, so they cost nothing in either measure.
- Don't over-transform. Plain code packs better under roadroller as well as under an LLM compressor.
- Spend bytes on features, not squeezing. Refactoring for size rarely pays; refactor for clarity.

For the surprisal measure:

- Data goes in pretty JSON (`JSON.stringify(data, null, 2)` style) with descriptive keys, read with `JSON.parse` and
  named destructuring. It beats custom DSLs, positional arrays, minified JSON and YAML, despite being much larger raw.
  Small expressions inside strings (`"0.25*h"`) are fine.
- Keep normal whitespace and line breaks; collapsing code onto one line makes it bigger.
- Use conventional names and APIs (`Math.hypot`, `player`). Renaming to short names or aliasing `Math` members makes it
  bigger, as does factoring repeated code into helpers just for size: repetition is nearly free and a new helper name
  isn't.
- Leave debug-only code (global hooks, name tables) out of the shipped page; lists of identifiers are expensive.
- Moving tables between code and JSON nets about zero. Put data where it reads best.

For the zip and roadroller measure:

- Compact data formats (positional arrays, small DSLs) beat pretty JSON by roughly 15 to 40% under zip. The baseline
  already minifies JSON and inlines it as an object literal, so only change the format if you're optimizing for zip.
- `npm run baseline:cheap` often finds that switching off terser transforms (`sequences`, `join_vars`, `conditionals`,
  `if_return`, `loops`, `inline`) makes the zip smaller.
- Inlining JSON as an object literal packs smaller than inlining it as a string. It's the default (`"json": "object"`).
- Mangling properties is not attempted: code that calls browser or library APIs by property name would break.

## Conventions

- Keep generated files out of git: `dist/`, `release/`, `*.13k`, `node_modules/`.
- Data files in this repo, including tool outputs like `roadroller-best.json`, are pretty JSON with named keys.
- The page must run from a single `index.html` with no other files. js13k bans external requests in most categories.
- `.github/workflows/pages.yml` deploys `dist/` on push to `main` and retries a failed deploy once.
  `.github/workflows/release.yml` publishes the release zip when a `v<version>` tag matching `package.json` is pushed.
