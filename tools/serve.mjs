// A tiny static dev server. / rebuilds and serves the game (dist/index.html), so a browser reload picks up edits
// in src/. /roadroller/ serves the packed baseline page (dist/roadroller/index.html, after `npm run baseline`), so you
// can check the packed build still runs. Anything else under dist/ is served as a file.
//   node tools/serve.mjs          (npm start)
//   PORT=9000 node tools/serve.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { build } from './build.mjs'

const port = +(process.env.PORT || 8013)
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', json: 'application/json', zip: 'application/zip' }

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path == '/' || path == '/index.html') {
    try {
      build()
    } catch (e) {
      console.error(e.message)
      return res.writeHead(500, { 'content-type': 'text/plain' }).end(e.message)
    }
    path = '/index.html'
  }
  if (path == '/roadroller/' || path == '/roadroller') path = '/roadroller/index.html'
  if (!/^\/[\w./-]+$/.test(path) || path.includes('..')) return res.writeHead(404).end('not found')
  try {
    const body = await readFile(new URL('../dist' + path, import.meta.url))
    res.writeHead(200, { 'content-type': types[path.split('.').pop()] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`serving http://127.0.0.1:${port}/  (packed baseline: /roadroller/)`))
