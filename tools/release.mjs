// Packs a clean copy of the starter into release/<name>-<version>.zip (name and version from package.json, so
// release/js13k-starter-1.0.0-alpha.1.zip here), for a GitHub Release.
//   node tools/release.mjs              (npm run release) version from package.json
//   node tools/release.mjs 1.2.3        another version label
// In a git checkout it packs the files git knows about (tracked, plus untracked files that aren't ignored); elsewhere
// it walks the folder. Either way node_modules, .git, dist, release, .cache and *.13k are left out. The zip holds one
// top-level folder, <name>-<version>/, so unzipping doesn't spill files into the current directory.
// Needs the `zip` command (preinstalled on macOS and GitHub's Ubuntu runners).
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, cpSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'))
const version = (process.argv[2] || pkg.version).replace(/^v/, '')
const name = `${pkg.name}-${version}`
const skipDirs = new Set(['node_modules', '.git', 'dist', 'release', '.cache'])
const skip = (file) => file.split('/').some((part) => skipDirs.has(part) || part == '.DS_Store') || file.endsWith('.13k')

function gitFiles() {
  try {
    const out = execSync('git ls-files -z --cached --others --exclude-standard', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    return out.toString().split('\0').filter(Boolean)
  } catch {
    return null
  }
}

function walk(dir = '') {
  return readdirSync(root + dir, { withFileTypes: true }).flatMap((e) => {
    const rel = dir + e.name
    if (skip(rel)) return []
    return e.isDirectory() ? walk(rel + '/') : [rel]
  })
}

const files = (gitFiles() ?? walk()).filter((f) => !skip(f) && existsSync(root + f) && statSync(root + f).isFile()).sort()
const stage = root + 'release/stage/'
const zipPath = root + `release/${name}.zip`
rmSync(stage, { recursive: true, force: true })
rmSync(zipPath, { force: true })
mkdirSync(stage + name, { recursive: true })
for (const f of files) cpSync(root + f, stage + name + '/' + f)

const z = spawnSync('zip', ['-r', '-X', '-q', '-9', zipPath, name], { cwd: stage, stdio: 'inherit' })
if (z.error || z.status !== 0) {
  console.error(z.error?.code === 'ENOENT' ? 'release: the zip command was not found' : `release: zip failed (exit ${z.status})`)
  process.exit(1)
}
rmSync(stage, { recursive: true, force: true })
console.log(`release/${name}.zip: ${files.length} files, ${statSync(zipPath).size.toLocaleString()} bytes`)
for (const f of files) console.log(`  ${f}`)
