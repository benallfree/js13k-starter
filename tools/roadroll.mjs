// The js13k zip baseline: the best-known conventional pipeline.
//   terser (minify + mangle) -> roadroller (context-mixing packer) -> advzip -4 (Zopfli zip)
// Reads dist/index.html (run tools/build.mjs first) and writes dist/roadroller/index.html (a playable page) and
// dist/roadroller/index.zip (what you'd submit to js13k).
//   node tools/roadroll.mjs                     (also `npm run baseline`, which builds first)
//   ROADROLLER_O=1 ADVZIP_ITER=1000 node tools/roadroll.mjs
//   node tools/roadroll.mjs --in other/dist/index.html --out other/dist/roadroller/
//
// Settings: the terser options, the JSON inlining and roadroller's starting params come from
// tools/roadroller-best.json when it exists (written by tools/roadroll-search.mjs for your build), else the defaults.
// ROADROLLER_O: roadroller optimization level on top of those (0 none; 1 about a minute on a big game; 2 exhaustive).
//   Default 0 when roadroller-best.json exists (reuse the search result as is), else 1.
// ROADROLLER_PARAMS: another settings JSON file to use; "none" ignores roadroller-best.json.
// ADVZIP_ITER: Zopfli iterations for advzip (default 1000). Without advzip (brew install advancecomp,
//   apt install advancecomp) the zip falls back to `zip -9`, which is a few percent bigger.
//
// Data: every <script type="application/json" id="name"> tag in the page is moved into the code, so roadroller packs
// it with everything else. The code must read it as JSON.parse(document.getElementById('name').textContent) (either
// quote style). With json "object" (the default) that whole expression becomes a JS object literal; with "string" just
// the textContent read becomes a minified JSON string literal and JSON.parse stays.
// Bare imports (an import map + CDN library) stay outside the packed code: roadroller's output is a direct eval, which
// still sees the module's imported bindings.
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { minify } from 'terser'
import { Packer } from 'roadroller'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const BEST = root + 'tools/roadroller-best.json'
export const BUDGET = 13312
const t = () => new Date().toTimeString().slice(0, 8)
export const log = (s) => console.log(`[${t()}] ${s}`)
const n = (x) => x.toLocaleString()
export const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function fail(msg) {
  throw new Error(`roadroll: ${msg}`)
}

// The terser options the baseline starts with; roadroller-best.json's `terser` (from roadroll-search.mjs --cheap)
// replaces them when present. The unsafe_* options here only assume ordinary arrow and method use.
export const TERSER = {
  module: true,
  ecma: 2022,
  compress: { passes: 3, unsafe_arrows: true, unsafe_methods: true },
  mangle: true,
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Built page -> { html, imports, js, page(packed) }: the JS to pack (JSON inlined, terser'd, imports split off) and a
// function that wraps packed code back into the page shell.
export async function prepare(input = root + 'dist/index.html', terser = TERSER, json = 'object') {
  const html = readFileSync(input, 'utf8')
  const tag = /<script type="application\/json" id="([\w-]+)">([\s\S]*?)<\/script>\s*/g
  const data = [...html.matchAll(tag)].map((m) => ({ id: m[1], body: m[2] }))
  const open = '<script type="module">'
  const start = html.indexOf(open)
  if (start < 0) fail(`no ${open} in ${input}`)
  const end = html.indexOf('</script>', start)
  let code = html.slice(start + open.length, end)

  for (const { id, body } of data) {
    const minified = JSON.stringify(JSON.parse(body))
    const read = `document\\.getElementById\\((['"])${escape(id)}\\1\\)\\.textContent`
    const parsed = new RegExp(`JSON\\.parse\\(\\s*${read}\\s*\\)`, 'g')
    const plain = new RegExp(read, 'g')
    const count = (re) => code.match(re)?.length ?? 0
    if (json === 'object' && count(parsed) === 1) code = code.replace(parsed, () => `(${minified})`)
    else if (count(plain) === 1) code = code.replace(plain, () => JSON.stringify(minified))
    else fail(`the JSON tag #${id} must be read exactly once, as JSON.parse(document.getElementById('${id}').textContent); found ${count(plain)}`)
  }

  let js = (await minify(code, structuredClone(terser))).code // terser writes into its options
  // terser hoists imports to the front; keep them out of the packed code
  const imports = js.match(/^(import[^;]*;)*/)[0]
  js = js.slice(imports.length)

  // page shell: the page minus the JSON tags and the module, whitespace between tags dropped
  const shell = html.slice(0, start).replace(tag, '').replace(/>\s+</g, '><').trim()
  const tail = html.slice(end + '</script>'.length).replace(/\s+/g, '')
  const page = (packed) => shell + open + imports + packed + '</script>' + tail
  return { html, imports, js, page }
}

// The saved pipeline settings (pretty JSON, named keys): terser options, JSON inlining and roadroller Packer params,
// plus a record of the input and search that found them. null when there's no file (or ROADROLLER_PARAMS=none).
export function loadBest(file = process.env.ROADROLLER_PARAMS ?? BEST) {
  if (file === 'none' || !existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

// Packs js with the given Packer options; returns the packed code.
export function pack(js, params = {}) {
  const packer = new Packer([{ data: js, type: 'js', action: 'eval' }], { ...params })
  const { firstLine, secondLine } = packer.makeDecoder()
  return firstLine + '\n' + secondLine
}

// The tunable part of a Packer's options (drops the resource pool and other runtime-only fields).
export function packerParams(packer) {
  const o = packer.options
  const p = {
    sparseSelectors: o.sparseSelectors.slice(),
    precision: o.precision,
    modelMaxCount: o.modelMaxCount,
    modelRecipBaseCount: o.modelRecipBaseCount,
    recipLearningRate: o.recipLearningRate,
    numAbbreviations: o.numAbbreviations,
    dynamicModels: o.dynamicModels ?? 0,
  }
  if (o.contextBits) p.contextBits = o.contextBits
  else p.maxMemoryMB = o.maxMemoryMB
  return p
}

const have = (cmd) => !spawnSync(cmd, ['-h'], { stdio: 'ignore' }).error
let warned = false

// Zips one file as index.html into zipPath with advzip (Zopfli), or `zip -9` when advzip isn't installed.
// Returns the zip's size in bytes.
export function zipFile(dir, file, iter = 1000) {
  const out = dir + 'index.zip'
  rmSync(out, { force: true })
  let z
  if (have('advzip')) z = spawnSync('advzip', ['-a', '-4', '-i', String(iter), 'index.zip', file], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] })
  else if (have('zip')) {
    if (!warned) console.warn('roadroll: advzip not found (brew install advancecomp); using zip -9, a few percent bigger')
    warned = true
    z = spawnSync('zip', ['-9', '-X', '-q', 'index.zip', file], { cwd: dir, stdio: 'inherit' })
  } else fail('neither advzip nor zip found (brew install advancecomp)')
  if (z.error) fail(z.error.message)
  if (z.status !== 0) fail(`zipping failed (exit ${z.status})`)
  return statSync(out).size
}

// Writes page to dir/index.html and zips it into dir/index.zip; returns { page, zip } sizes.
export function zip(dir, page, iter = 1000) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(dir + 'index.html', page)
  return { page: Buffer.byteLength(page), zip: zipFile(dir, 'index.html', iter) }
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? resolve(process.argv[i + 1]) : undefined
}

export async function roadroll({ input = arg('--in'), out = arg('--out') } = {}) {
  input ??= root + 'dist/index.html'
  out = out ? out.replace(/\/?$/, '/') : root + 'dist/roadroller/'
  const best = loadBest()
  const saved = best?.params
  const level = +(process.env.ROADROLLER_O ?? (saved ? 0 : 1))
  const iter = +(process.env.ADVZIP_ITER ?? 1000)

  if (best?.input?.sha256 && best.input.sha256 !== sha(readFileSync(input, 'utf8')))
    log(`note: tools/roadroller-best.json was found on another build (${best.input.commit ?? best.input.sha256}); rerun npm run baseline:search when it stops paying off`)

  const json = best?.json ?? 'object'
  log(`terser: ${input} (JSON as ${json === 'object' ? 'object literals' : 'strings'}${best?.terser ? ', saved terser options' : ''})…`)
  const { html, imports, js, page } = await prepare(input, best?.terser ?? TERSER, json)
  log(`terser: ${n(imports.length + js.length)} bytes`)

  log(`roadroller -O${level}: packing ${n(js.length)} bytes${saved ? ' from the saved params' : ''}…`)
  const packer = new Packer([{ data: js, type: 'js', action: 'eval' }], { ...(saved || {}) })
  if (level > 0)
    await packer.optimize(level, (info) => {
      const pct = typeof info.passRatio === 'number' ? ` ${(info.passRatio * 100).toFixed(0)}%` : ''
      console.log(`  roadroller pass ${info.pass}${pct}: ${n(info.currentSize)}${info.bestUpdated ? ' <- best' : ''}`)
    })
  const { firstLine, secondLine } = packer.makeDecoder()
  const packed = firstLine + '\n' + secondLine
  log(`roadroller: ${n(packed.length)} bytes`)

  log(`zipping (advzip -4 -i ${iter})…`)
  const s = zip(out, page(packed), iter)
  const sizes = { raw: Buffer.byteLength(html), terser: imports.length + js.length, roadroller: s.page, zip: s.zip }
  log(`${out}index.zip: ${n(s.zip)} bytes, ${((s.zip / BUDGET) * 100).toFixed(1)}% of the ${n(BUDGET)}-byte budget`)
  return sizes
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await roadroll()
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
