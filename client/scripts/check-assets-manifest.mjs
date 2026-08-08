import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const publicDir = join(clientRoot, 'public')
const manifestPath = join(publicDir, 'assets-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const entries = manifest.assets.map((entry) => entry.path.replace(/^\/+/, ''))

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

const files = walk(join(publicDir, 'assets')).map((path) =>
  path.slice(publicDir.length + 1).split(sep).join('/'),
)
const unlisted = files.filter(
  (file) => !entries.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)),
)

if (unlisted.length > 0) {
  console.error('[assets-manifest] 以下资源未登记授权清单，构建终止：')
  for (const file of unlisted) console.error(`  - ${file}`)
  process.exit(1)
}
console.log(`[assets-manifest] ok：${files.length} 个资源全部在清单内`)
