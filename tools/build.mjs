// Builds dist/index.html: one self-contained page from src/.
//
//   node tools/build.mjs          (also `npm run build`)
//
// What it does:
// - Starts at src/main.js and follows its relative imports (`import { x } from './world.js'`), dependencies first, so
//   each module appears once. The modules are joined into one <script type="module">: relative import lines are
//   dropped and a leading `export ` is removed, so every module shares one scope (top-level names must not clash).
//   Imports of anything else (`from 'three'`, resolved by an import map in index.html) are kept and hoisted to the top.
// - Strips comments from the code (tools/strip.mjs). Strings, template literals and regexes are left alone, and so are
//   names, indentation and line breaks.
// - Replaces <!--JSON:name--> in src/index.html with the contents of src/name.json. Put the marker inside
//   <script type="application/json" id="name"> and read it with
//   JSON.parse(document.getElementById('name').textContent), which is the exact form tools/roadroll.mjs looks for.
// - Replaces <!--CODE--> with the joined modules, and every BUILD_ID in the code with the git commit this build is
//   from (short hash, plus '+' when src/ has uncommitted changes; 'dev' outside a git checkout).
// Import lines must fit on one line. The build fails loudly on a missing module or JSON file.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { strip } from './strip.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = root + 'src/'

function buildId() {
  try {
    const git = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return git('git rev-parse --short HEAD') + (git('git status --porcelain src') ? '+' : '')
  } catch {
    return 'dev'
  }
}

function read(file, what) {
  if (!existsSync(src + file)) throw new Error(`build: ${what} src/${file} not found`)
  return readFileSync(src + file, 'utf8')
}

// Collects modules depth-first from the entry, so a module's dependencies come before it.
function collect(entry) {
  const order = []
  const seen = new Set()
  const bare = new Set()
  const visit = (file, from) => {
    if (seen.has(file)) return
    seen.add(file)
    const lines = strip(read(file, from ? `module imported by ${from}:` : 'entry')).split('\n')
    const body = []
    for (const line of lines) {
      const m = line.match(/^import\s.*?from\s+['"](.+?)['"];?\s*$/) || line.match(/^import\s+['"](.+?)['"];?\s*$/)
      if (!m) {
        body.push(line.replace(/^export /, ''))
        continue
      }
      if (m[1].startsWith('./')) visit(m[1].slice(2), file)
      else bare.add(line.trim())
    }
    order.push({ file, code: body.join('\n').trim() })
  }
  visit(entry)
  return { modules: order, imports: [...bare] }
}

export function build() {
  const id = buildId()
  const { modules, imports } = collect('main.js')
  const code = [...imports, ...modules.map((m) => m.code)].join('\n').replaceAll('BUILD_ID', id)
  const html = read('index.html', 'page')
    .replace(/<!--JSON:([\w-]+)-->/g, (_, name) => read(name + '.json', 'data file').trim())
    .replace('<!--CODE-->', () => code) // a function, so $-patterns in the code stay literal
  mkdirSync(root + 'dist', { recursive: true })
  writeFileSync(root + 'dist/index.html', html)
  return { id, bytes: Buffer.byteLength(html), modules: modules.map((m) => m.file) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = build()
  console.log(`built dist/index.html (${r.bytes.toLocaleString()} bytes, build ${r.id}, modules: ${r.modules.join(' ')})`)
}
