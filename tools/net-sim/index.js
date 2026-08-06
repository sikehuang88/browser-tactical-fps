#!/usr/bin/env node
/**
 * 网络模拟代理（NET-007 骨架）
 * 在客户端与实时游戏服务器之间注入延迟、抖动、带宽限制与强制断连。
 *
 * 说明：M0 传输为 WebSocket/TCP，无法在应用层丢弃单个 TCP 包。真正的包级
 * 丢包/乱序模拟需在 WebTransport datagram 路径（M1）或操作系统级完成
 * （如 Linux `tc qdisc add ... netem loss 5%`）。
 * 本工具的 `--loss-percent` 以"断连概率"近似高丢包下的掉线行为。
 *
 * 用法：
 *   node index.js --listen 9001 --target 127.0.0.1:9000 --delay-ms 100 --jitter-ms 20
 *   node index.js --listen 9001 --target 127.0.0.1:9000 --delay-ms 50 --bandwidth-kbps 200
 *   node index.js --listen 9001 --target 127.0.0.1:9000 --loss-percent 5 --drop-after-ms 60000
 */
import { createServer, connect } from 'node:net'

const opts = parseArgs(process.argv.slice(2))
if (opts.help || opts.h) {
  printHelp()
  process.exit(0)
}

const LISTEN = Number(opts.listen ?? 9001)
const [THOST, TPORT] = String(opts.target ?? '127.0.0.1:9000').split(':')
const DELAY_MS = Number(opts['delay-ms'] ?? 0)
const JITTER_MS = Number(opts['jitter-ms'] ?? 0)
const LOSS_PCT = Number(opts['loss-percent'] ?? 0)
const BANDWIDTH_KBPS = Number(opts['bandwidth-kbps'] ?? 0)
const DROP_AFTER_MS = Number(opts['drop-after-ms'] ?? 0)

let connections = 0
const throttle = makeThrottle(BANDWIDTH_KBPS)

const server = createServer((client) => {
  const id = ++connections
  const upstream = connect({ host: THOST, port: Number(TPORT) }, () => {
    log(id, `已连接 -> ${THOST}:${TPORT}`)
  })
  upstream.on('error', (e) => {
    log(id, `上游错误 ${e.code || e.message}`)
    client.destroy()
  })
  client.on('error', () => {})

  pipeLatency(client, upstream, id, '客户端→服务器')
  pipeLatency(upstream, client, id, '服务器→客户端')

  if (DROP_AFTER_MS > 0) {
    setTimeout(() => {
      log(id, `达到 ${DROP_AFTER_MS}ms 强制断连`)
      client.destroy()
      upstream.destroy()
    }, DROP_AFTER_MS)
  }
})

server.listen(LISTEN, () => {
  console.log(`net-sim 监听 :${LISTEN} -> ${THOST}:${TPORT}`)
  console.log(
    `  延迟=${DELAY_MS}ms 抖动=${JITTER_MS}ms 断连概率=${LOSS_PCT}% 带宽=${BANDWIDTH_KBPS || '不限'}kbps 强制断连=${DROP_AFTER_MS || '-'}ms`,
  )
})

/** 单方向管道：先注入延迟/抖动/带宽，再写入对端。 */
function pipeLatency(src, dst, id, dir) {
  const deliver = (buf) => {
    if (LOSS_PCT > 0 && Math.random() * 100 < LOSS_PCT) {
      log(id, `${dir} 模拟掉线（${buf.length} bytes）`)
      src.destroy()
      dst.destroy()
      return
    }
    const jitter = JITTER_MS > 0 ? Math.random() * JITTER_MS : 0
    const delay = DELAY_MS + jitter
    const write = () => dst.write(buf)
    throttle(buf, () => (delay > 0 ? setTimeout(write, delay) : write()))
  }
  src.on('data', deliver)
  src.on('close', () => dst.destroy())
}

/** 漏桶带宽限制：按平均速率排队写出。 */
function makeThrottle(kbps) {
  if (!kbps || kbps <= 0) {
    return (_buf, write) => write()
  }
  const bytesPerMs = (kbps * 1000) / 8 / 1000
  let nextAt = Date.now()
  return (buf, write) => {
    const needMs = buf.length / bytesPerMs
    const start = Math.max(Date.now(), nextAt)
    nextAt = start + needMs
    setTimeout(write, Math.max(0, start - Date.now()))
  }
}

function log(id, msg) {
  console.log(`[conn ${id}] ${msg}`)
}

function printHelp() {
  console.log(`
网络模拟代理

用法: node index.js [选项]

选项:
  --listen <port>        代理监听端口（默认 9001）
  --target <host:port>   目标游戏服务器（默认 127.0.0.1:9000）
  --delay-ms <ms>        单向延迟（默认 0）
  --jitter-ms <ms>       抖动上界（默认 0）
  --loss-percent <n>     断连概率 %（默认 0）
  --bandwidth-kbps <n>   带宽限制（默认不限）
  --drop-after-ms <ms>   连接建立 N 毫秒后强制断连（默认不限）

客户端地址: ws://127.0.0.1:<listen>/ws
`)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '')
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    out[k] = v
  }
  return out
}
