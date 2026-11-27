// Builds the game and reports its size against the 13,312-byte js13k budget:
//   raw build, gzip -9, Brotli, the build zipped as is, the zip baseline (terser -> roadroller -> advzip,
//   tools/roadroll.mjs), and, when surprisal is installed, the build compressed with surprisal.
//
//   npm run ship                 all of the above; surprisal at -3
//   npm run ship -1              surprisal at another level (-0..-9; npm hands it over as npm_config_1)
//   npm run ship -- -1           the same, passed as an argument
//   npm run ship -- --compare    also pass --compare to surprisal (its own table of zip, 7z, xz, Brotli sizes)
//   npm run baseline             build and zip sizes only, no surprisal (same as npm run ship -- --baseline)
//   SURPRISAL=/path/to/surprisal npm run ship
//
// surprisal (an LLM-based compressor, github.com/benallfree/surprisal) is optional. It's found through the SURPRISAL
// environment variable (a path or a command name), else `surprisal` on PATH. When it isn't found, or is too old for the
// -0..-9 levels, ship says so and reports the zip sizes only. js13k itself accepts a zip; the surprisal number is a
// measure of how small the same code gets under an LLM compressor.
//
// Output streams straight through, so surprisal's progress line shows live. Writes dist/index.zip (the build zipped as
// is), dist/roadroller/ and, with surprisal, dist/index.13k (overwritten each run, never reported stale).
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, statSync, readFileSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { build } from './build.mjs'
import { roadroll, zipFile, root, BUDGET } from './roadroll.mjs'

const args = process.argv.slice(2)
const baselineOnly = args.includes('--baseline')
const compare = args.includes('--compare')
// Level: `-N` in the arguments, or `npm run ship -N`, which npm swallows as config and exposes as npm_config_N.
const levels = new Set([
  ...args.filter((a) => /^-\d$/.test(a)).map((a) => a.slice(1)),
  ...Object.keys(process.env).filter((k) => /^npm_config_\d$/.test(k)).map((k) => k.slice(-1)),
])
if (levels.size > 1) {
  console.error(`more than one level given: -${[...levels].join(' -')}`)
  process.exit(1)
}
const level = '-' + ([...levels][0] ?? '3')

const t = () => new Date().toTimeString().slice(0, 8)
const log = (s) => console.log(`[${t()}] ${s}`)

// Returns the surprisal command to run, or null (with the reason logged) to skip it.
function findSurprisal() {
  const explicit = process.env.SURPRISAL
  const cmd = explicit || 'surprisal'
  const help = spawnSync(cmd, ['--help'], { encoding: 'utf8' })
  if (help.error) {
    if (explicit) {
      console.error(`SURPRISAL=${explicit}: not found. Fix the path, or unset SURPRISAL to skip surprisal.`)
      process.exit(1)
    }
    log('surprisal not found (set SURPRISAL=/path/to/surprisal, or put it on PATH); skipping it, zip sizes only')
    return null
  }
  if (!/-0 \.\.\. -9/.test(help.stdout + help.stderr)) {
    log(`${cmd} is too old for the -0..-9 levels; skipping it (update surprisal, or set SURPRISAL to a newer build)`)
    return null
  }
  return cmd
}

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' })
  if (r.error) throw r.error
  if (r.status !== 0) {
    console.error(`${cmd} failed (${r.signal || 'exit ' + r.status})`)
    process.exit(r.status || 1)
  }
}

const row = (name, size) =>
  `  ${name.padEnd(42)}${size.toLocaleString().padStart(9)}  ${((size / BUDGET) * 100).toFixed(1).padStart(6)}%  ${(BUDGET - size).toLocaleString().padStart(8)} left`

const surprisal = baselineOnly ? null : findSurprisal()

log('building…')
const b = build()
log(`built dist/index.html (${b.bytes.toLocaleString()} bytes, build ${b.id})`)
const html = readFileSync(root + 'dist/index.html')

let base
try {
  log('zip baseline: terser -> roadroller -> advzip…')
  base = await roadroll()
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
const plainZip = zipFile(root + 'dist/', 'index.html')

let packed
if (surprisal) {
  const out = 'dist/index.13k'
  const cmdArgs = [level, ...(compare ? ['--compare'] : []), '-f', '-o', out, 'dist/index.html']
  log(`surprisal ${level}: ${surprisal} ${cmdArgs.join(' ')}`)
  rmSync(root + out, { force: true })
  run(surprisal, cmdArgs)
  if (!existsSync(root + out)) {
    console.error(`${out} was not written`)
    process.exit(1)
  }
  packed = statSync(root + out).size
}

console.log(`\n[${t()}] build ${b.id} against the ${BUDGET.toLocaleString()}-byte budget:`)
console.log(row('raw (dist/index.html)', html.length))
console.log(row('gzip -9', gzipSync(html, { level: 9 }).length))
console.log(row('Brotli (quality 11)', brotliCompressSync(html, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length))
console.log(row('zip of the build as is (dist/index.zip)', plainZip))
console.log(row('terser + roadroller + zip (baseline)', base.zip))
if (packed !== undefined) {
  console.log(row(`surprisal ${level} (dist/index.13k)`, packed))
  const d = base.zip - packed
  console.log(`  surprisal is ${Math.abs(d).toLocaleString()} bytes ${d >= 0 ? 'smaller' : 'larger'} than the baseline (${((packed / base.zip) * 100).toFixed(1)}%)`)
}
const smaller = base.zip <= plainZip ? 'dist/roadroller/index.zip (play dist/roadroller/index.html first)' : 'dist/index.zip'
console.log(`  js13k counts the zip; the smaller one is ${smaller}.`)
