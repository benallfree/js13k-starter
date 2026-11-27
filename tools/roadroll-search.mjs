// Deep search for the zip baseline (tools/roadroll.mjs): spends a fixed budget of roadroller size evaluations looking
// for Packer params smaller than a single -O1 pass, measures every new candidate as a real zip, and saves the best to
// tools/roadroller-best.json, which `npm run baseline` then reuses without searching.
//   node tools/roadroll-search.mjs                        1,000 evaluations on dist/index.html, one worker
//   node tools/roadroll-search.mjs --evals 4000 --jobs 4  4 workers x 1,000 evaluations each, in parallel
//   node tools/roadroll-search.mjs --cheap                the cheap-wins sweep instead: terser and JSON-inlining variants
//   node tools/roadroll-search.mjs --in x/dist/index.html --save x.json --out x/dist/roadroller/
// `npm run baseline:search` builds first and runs the default search. Run --cheap first, then the deep search: the deep
// search keeps the terser options and JSON inlining it finds in the save file.
//
// How it searches. One evaluation is one roadroller size estimate (a full model run over the packed JS; well under a
// second for a small game, about 0.3 s for a 100 KB one). Each worker runs rounds of roadroller's own exhaustive
// optimizer (optimize(2): binary searches over the numeric params plus simulated annealing over the context
// selectors), each round seeded from the best params so far, so a round can only keep or improve the estimate.
// Workers differ in their starting point (the saved params, roadroller's defaults, 10, 14 or 16 context models), so
// they explore apart. Roadroller's estimate isn't the zip size, so the parent zips every candidate that improves a
// worker's estimate (advzip -i 100 to keep it quick) and ranks by that; the winner is re-zipped at -i 1000 at the end.
// The save file is rewritten each time the real zip improves, so a partial best survives an interrupted search.
// Past about 1,000 evaluations the returns are small (on one 270 KB game, 10x the evaluations bought about 80 bytes).
import { writeFileSync, readFileSync } from 'node:fs'
import { fork, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Packer, defaultSparseSelectors } from 'roadroller'
import { prepare, pack, packerParams, zip, loadBest, log, root, sha, BEST, TERSER } from './roadroll.mjs'

const argv = process.argv.slice(2)
const opt = (name, d) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : d
}
const n = (x) => x.toLocaleString()
const input = resolve(opt('--in', root + 'dist/index.html'))
const save = resolve(opt('--save', BEST))
const out = resolve(opt('--out', root + 'dist/roadroller/')).replace(/\/?$/, '/')
const scratch = out + 'search/'
const saved = loadBest(save) // the settings to start from, if any
const savedTerser = saved?.terser ?? TERSER
const savedJson = saved?.json ?? 'object'

// ---------- worker: rounds of optimize(2) until the evaluation budget is spent ----------
if (argv.includes('--worker')) {
  const budget = +opt('--evals', 1000)
  let current = JSON.parse(opt('--start', '{}'))
  const { js } = await prepare(input, savedTerser, savedJson)
  let used = 0
  for (let round = 1; used < budget; round++) {
    const packer = new Packer([{ data: js, type: 'js', action: 'eval' }], { ...current })
    const start = packerParams(packer)
    let last
    try {
      await packer.optimize(2, (info) => {
        last = info
        if (info.pass === 'initial') return
        used++
        if (info.bestUpdated) process.send({ type: 'candidate', params: { ...start, ...info.best }, estimate: info.bestSize, used, round })
        if (used >= budget) return false // stops the search ('search aborted')
      })
    } catch (e) {
      if (e.message !== 'search aborted') throw e
    }
    current = { ...start, ...last.best }
    process.send({ type: 'round', round, used, estimate: last.bestSize })
  }
  process.send({ type: 'done', used })
  process.exit(0)
}

// The source commit of the input: HEAD for this repo's own dist/index.html, else --commit if given.
function commit() {
  if (opt('--commit')) return opt('--commit')
  if (input !== root + 'dist/index.html') return undefined
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
}

// The save file's header: what it is and which input it was found on, keeping any other keys already there.
function header(prev) {
  const html = readFileSync(input, 'utf8')
  return {
    about: 'Settings for the zip baseline (tools/roadroll.mjs), found by tools/roadroll-search.mjs: terser options and JSON inlining (--cheap), roadroller Packer params (deep search)',
    ...prev,
    input: { file: input.startsWith(root) ? input.slice(root.length) : input, commit: commit(), bytes: Buffer.byteLength(html), sha256: sha(html) },
  }
}

// ---------- cheap wins: greedy search over terser options and JSON inlining, zipped for real ----------
// Every step packs with the same roadroller params (the saved ones, else roadroller's defaults), so only the terser
// output changes. Only transforms that are safe to turn off are toggled (turning a transform off can't break the code);
// unsafe options are never switched on. A toggle is kept if the zip shrinks. Less compression often packs smaller,
// because roadroller models plain code better.
if (argv.includes('--cheap')) {
  const params = saved?.params || {}
  const t0 = Date.now()
  const rows = []
  const measure = async (name, terser, json) => {
    try {
      const { imports, js, page } = await prepare(input, terser, json)
      const { zip: size } = zip(scratch, page(pack(js, params)), 100)
      rows.push({ variant: name, terserBytes: imports.length + js.length, zipBytes: size })
      log(`${name.padEnd(44)} terser ${n(imports.length + js.length).padStart(8)}  zip ${n(size).padStart(7)}`)
      return size
    } catch (e) {
      rows.push({ variant: name, error: e.message })
      log(`${name.padEnd(44)} failed: ${e.message}`)
      return Infinity
    }
  }
  log(`cheap-wins search on ${input}, roadroller params: ${params.sparseSelectors ? 'saved' : 'defaults'}`)
  let json = 'object'
  let terser = structuredClone(TERSER)
  let best = await measure('JSON as object literals', terser, json)
  const asString = await measure('JSON as strings', terser, 'string')
  if (asString < best) [best, json] = [asString, 'string']
  const offs = ['sequences', 'join_vars', 'conditionals', 'comparisons', 'if_return', 'collapse_vars', 'reduce_vars', 'reduce_funcs',
    'inline', 'booleans', 'loops', 'dead_code', 'evaluate', 'hoist_props', 'switches', 'typeofs', 'arrows', 'computed_props',
    'properties', 'negate_iife', 'unsafe_arrows', 'unsafe_methods', 'side_effects', 'unused']
  for (let round = 1; round <= 2; round++) {
    let changed = false
    for (const passes of [1, 2, 3, 4]) {
      if (passes === terser.compress.passes) continue
      const next = { ...terser, compress: { ...terser.compress, passes } }
      const size = await measure(`passes ${passes}`, next, json)
      if (size < best) [best, terser, changed] = [size, next, true]
    }
    for (const k of offs) {
      const on = terser.compress[k] ?? !k.startsWith('unsafe')
      if (!on) continue // only switch transforms off, never on
      const next = { ...terser, compress: { ...terser.compress, [k]: false } }
      const size = await measure(`${k}: false`, next, json)
      if (size < best) [best, terser, changed] = [size, next, true]
    }
    const noCompress = { ...terser, compress: false }
    const size = await measure('compress: false', noCompress, json)
    if (size < best) [best, terser, changed] = [size, noCompress, true]
    log(`round ${round}: best zip ${n(best)}`)
    if (!changed) break
  }
  const { params: _, ...rest } = saved ?? {}
  writeFileSync(save, JSON.stringify({ ...header(rest), json, terser, cheapWins: { zipBytes: best, advzipIterations: 100 }, ...(saved?.params ? { params: saved.params } : {}) }, null, 2) + '\n')
  log(`saved the terser options and JSON inlining to ${save}`)
  const result = { input, roadrollerParams: params.sparseSelectors ? 'saved' : 'defaults', advzipIterations: 100, minutes: +((Date.now() - t0) / 60000).toFixed(1), best: { zipBytes: best, json, terser }, rows }
  writeFileSync(out + 'cheap-wins.json', JSON.stringify(result, null, 2) + '\n')
  log(`best: zip ${n(best)}, JSON as ${json === 'object' ? 'object literals' : 'strings'}; table in ${out}cheap-wins.json`)
  process.exit(0)
}

// ---------- parent: start workers, zip their candidates, keep the best ----------
const evals = +opt('--evals', 1000)
const jobs = +opt('--jobs', 1)
const t0 = Date.now()
const mins = () => ((Date.now() - t0) / 60000).toFixed(1)

const { html, imports, js, page } = await prepare(input, savedTerser, savedJson)
log(`input ${input}: ${n(Buffer.byteLength(html))} bytes raw, ${n(imports.length + js.length)} after terser`)

const starts = [
  ['saved params', saved?.params],
  ['roadroller defaults', {}],
  ['10 context models', { sparseSelectors: defaultSparseSelectors(10) }],
  ['14 context models', { sparseSelectors: defaultSparseSelectors(14) }],
  ['16 context models', { sparseSelectors: defaultSparseSelectors(16) }],
].filter(([, p]) => p)

let best = null // { params, zip, estimate, worker, minutes }
const seen = new Set()
function measure(params, estimate, who) {
  const key = JSON.stringify(params)
  if (seen.has(key)) return
  seen.add(key)
  const { zip: size } = zip(scratch, page(pack(js, params)), 100)
  const better = !best || size < best.zip
  log(`  ${who}: estimate ${Number.isNaN(estimate) ? '-' : n(estimate)} -> zip ${n(size)}${better ? '  <- best' : ''}`)
  if (better) {
    best = { params, zip: size, estimate, worker: who, minutes: +mins() }
    writeSave(100)
  }
}

function writeSave(advzipIterations, final = {}) {
  const doc = {
    ...header(saved),
    json: savedJson,
    terser: savedTerser,
    zipBytes: best.zip,
    advzipIterations,
    roadrollerEstimate: Number.isNaN(best.estimate) ? null : best.estimate,
    search: { evaluations: evals, jobs, foundBy: best.worker, foundAfterMinutes: best.minutes, ...final },
    params: best.params,
  }
  writeFileSync(save, JSON.stringify(doc, null, 2) + '\n')
}

// the starting points themselves are candidates too (the saved params are the record to beat)
for (const [name, p] of starts) measure(packerParams(new Packer([{ data: js, type: 'js', action: 'eval' }], { ...p })), NaN, `start: ${name}`)

log(`${jobs} worker(s), ${n(evals)} evaluations in all, about ${n(Math.ceil(evals / jobs))} each`)
const self = fileURLToPath(import.meta.url)
await Promise.all(
  Array.from({ length: jobs }, (_, i) => {
    // worker 1 starts from the best-zipping start point, the rest from each start point in turn
    const [name, start] = i === 0 ? ['best start', best.params] : starts[i % starts.length]
    const who = `w${i + 1} (${name})`
    const w = fork(self, ['--worker', '--in', input, '--save', save, '--evals', String(Math.ceil(evals / jobs)), '--start', JSON.stringify(start)])
    w.on('message', (m) => {
      if (m.type === 'candidate') measure(m.params, m.estimate, `${who} round ${m.round} eval ${m.used}`)
      if (m.type === 'round') log(`${who}: round ${m.round} done, ${m.used} evaluations, estimate ${n(m.estimate)}, best zip so far ${n(best.zip)} (${mins()} min)`)
    })
    return new Promise((res, rej) => w.on('exit', (code) => (code ? rej(new Error(`${who} exited ${code}`)) : res())))
  })
)

log(`search done in ${mins()} min; re-zipping the best at advzip -i 1000…`)
const s = zip(out, page(pack(js, best.params)), 1000)
best.zip = s.zip
writeSave(1000, { totalMinutes: +mins() })
log(`best: ${out}index.zip ${n(s.zip)} bytes (found by ${best.worker} after ${best.minutes} min); settings saved to ${save}`)
