import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const limitMb = Number(process.argv[2] ?? 35)
const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)))

function walk(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) total += walk(path)
    else total += statSync(path).size
  }
  return total
}

const totalMb = walk(dist) / (1024 * 1024)
if (totalMb > limitMb) {
  console.error(`[dist-size] ${totalMb.toFixed(2)}MB 超过预算 ${limitMb}MB，构建终止`)
  process.exit(1)
}
console.log(`[dist-size] ${totalMb.toFixed(2)}MB <= ${limitMb}MB`)
