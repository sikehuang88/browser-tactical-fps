// 经济 + 投掷物 联调测试
// 场景：购买(资金扣减/库存) → 投掷(HE/烟雾 Spawn→Explode) → 击杀奖励 → 回合奖励
const URL = 'ws://127.0.0.1:9000/ws'
const BTN = { FWD: 1, ATTACK: 128, USE: 256, THROW_SMOKE: 1 << 10, THROW_FLASH: 1 << 11, THROW_HE: 1 << 12 }

function env(msgType, seq, payload, reliable) {
  const buf = Buffer.alloc(10 + payload.length)
  buf[0] = 0xf5; buf[1] = 0x01; buf[2] = reliable ? 1 : 0; buf[3] = msgType
  buf.writeUInt32BE(seq >>> 0, 4); buf.writeUInt16BE(payload.length, 8)
  payload.copy(buf, 10)
  return buf
}
function hello(name) {
  const n = Buffer.from(name)
  const b = Buffer.alloc(4 + n.length)
  b[0] = 0; b[1] = 1; b[2] = 0; b[3] = n.length
  n.copy(b, 4)
  return b
}
function inputFrame(seq, buttons, yaw, pitch, fwd, strafe) {
  const b = Buffer.alloc(16)
  b.writeUInt32BE(seq >>> 0, 0)
  b.writeUInt16BE(buttons & 0xffff, 4)
  b.writeInt16BE(yaw, 6)
  b.writeInt16BE(pitch, 8)
  b.writeInt8(fwd, 10)
  b.writeInt8(strafe, 11)
  b.writeUInt32BE(Math.floor(Date.now() % 4294967296), 12)
  return b
}
function buyMsg(itemId) {
  return Buffer.from([itemId])
}

function decodeMsg(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const t = data[3]
  if (t === 2) return { type: 'welcome', playerId: dv.getUint32(10), tickRate: dv.getUint16(14) }
  if (t === 4) {
    const tick = dv.getUint32(10)
    const count = data[14]
    let off = 15
    const ents = []
    for (let i = 0; i < count; i++) {
      const id = dv.getUint32(off); off += 4
      const flags = data[off++]
      const x = dv.getInt16(off); off += 2
      const y = dv.getInt16(off); off += 2
      const z = dv.getInt16(off); off += 2
      const yaw = dv.getInt16(off); off += 2
      const pitch = dv.getInt16(off); off += 2
      const health = dv.getInt16(off); off += 2
      const team = data[off++]
      ents.push({ id, x: x / 100, y: y / 100, z: z / 100, health, team })
    }
    return { type: 'snapshot', tick, ents }
  }
  if (t === 8) return { type: 'roundState', phase: data[10], round: data[11], atk: data[14], def: data[15], bomb: data[16], winner: data[18] }
  if (t === 9) return { type: 'killFeed', attacker: dv.getUint32(10), victim: dv.getUint32(14), weapon: data[18] }
  if (t === 11) return { type: 'damage', victimId: dv.getUint32(10), damage: dv.getUint16(14), victimHealth: dv.getUint16(16) }
  if (t === 13) return { type: 'economy', playerId: dv.getUint32(10), money: dv.getUint16(14), weapon: data[16], armor: data[17], smoke: data[18], flash: data[19], he: data[20] }
  if (t === 14) {
    const kind = data[10]
    const owner = data[11]
    const pos = [dv.getInt16(12) / 100, dv.getInt16(14) / 100, dv.getInt16(16) / 100]
    return { type: 'grenadeSpawn', kind, owner, pos }
  }
  if (t === 15) {
    const kind = data[10]
    const pos = [dv.getInt16(11) / 100, dv.getInt16(13) / 100, dv.getInt16(15) / 100]
    return { type: 'grenadeExplode', kind, pos }
  }
  return { type: 'other', t }
}

class GameClient {
  constructor(name) {
    this.name = name
    this.inputSeq = 0
    this.welcome = null
    this.roundStates = []
    this.killFeeds = []
    this.damages = []
    this.economy = []
    this.grenadeSpawns = []
    this.grenadeExplodes = []
    this.latest = null
    this.bad = 0
    this.ws = new WebSocket(URL)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => this.ws.send(env(1, 0, hello(name), true))
    this.ws.onmessage = (ev) => this.handle(new Uint8Array(ev.data))
  }
  handle(data) {
    if (data[0] !== 0xf5) { this.bad++; return }
    const m = decodeMsg(data)
    switch (m.type) {
      case 'welcome': this.welcome = m; break
      case 'snapshot': this.latest = m; break
      case 'roundState': this.roundStates.push(m); break
      case 'killFeed': this.killFeeds.push(m); break
      case 'damage': this.damages.push(m); break
      case 'economy': this.economy.push(m); break
      case 'grenadeSpawn': this.grenadeSpawns.push(m); break
      case 'grenadeExplode': this.grenadeExplodes.push(m); break
    }
  }
  sendInput(buttons, yaw = 0, pitch = 0, fwd = 0, strafe = 0) {
    this.ws.send(env(3, ++this.inputSeq, inputFrame(this.inputSeq, buttons, yaw, pitch, fwd, strafe), false))
  }
  startInputLoop(buttons, yaw = 0, pitch = 0, fwd = 0, strafe = 0) {
    return setInterval(() => this.sendInput(buttons, yaw, pitch, fwd, strafe), 15)
  }
  buy(itemId) { this.ws.send(env(12, 0, buyMsg(itemId), true)) }
  selfEnt() {
    if (!this.latest || !this.welcome) return null
    return this.latest.ents.find((e) => e.id === this.welcome.playerId) || null
  }
  lastEconomy() { return this.economy.at(-1) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(label, fn, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return
    await sleep(50)
  }
  throw new Error(`超时等待: ${label}`)
}
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`)
}

let failures = 0
async function scenario(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`✗ ${name}: ${e.message}`)
  }
}

const A = new GameClient('alpha')
const B = new GameClient('bravo')
await sleep(400)

async function main() {
  await scenario('握手 + 初始经济 800', async () => {
    await waitFor('双方 welcome', () => A.welcome && B.welcome, 5000)
    await waitFor('首回合冻结', () => A.roundStates.some((s) => s.phase === 1), 5000)
    await waitFor('收到经济消息', () => A.lastEconomy() && B.lastEconomy(), 5000)
    const ea = A.lastEconomy()
    console.log('  A 经济:', JSON.stringify(ea))
    assert(ea.money === 800, '初始资金应为 800')
    assert(ea.smoke === 0 && ea.he === 0, '初始无投掷物')
  })

  await scenario('购买 烟雾+闪光+高爆 → 资金扣减/库存更新', async () => {
    A.buy(5) // 烟雾 300
    A.buy(6) // 闪光 200
    A.buy(7) // 高爆 300
    await waitFor('购买后经济更新', () => {
      const e = A.lastEconomy()
      return e && e.smoke === 1 && e.flash === 1 && e.he === 1
    }, 5000)
    const e = A.lastEconomy()
    console.log('  A 购买后经济:', JSON.stringify(e))
    assert(e.money === 0, '800 - 300 - 200 - 300 = 0')
    assert(e.smoke === 1 && e.flash === 1 && e.he === 1, '三种投掷物各 1')
  })

  await scenario('投掷 HE → Spawn 与 Explode 事件', async () => {
    await waitFor('进入行动', () => A.roundStates.some((s) => s.phase === 2), 10000)
    A.sendInput(BTN.THROW_HE, 0, 0, 0, 0) // 单帧投掷
    await waitFor('收到 HE Spawn', () => A.grenadeSpawns.some((g) => g.kind === 3), 5000)
    await waitFor('收到 HE Explode', () => A.grenadeExplodes.some((g) => g.kind === 3), 6000)
    const sp = A.grenadeSpawns.find((g) => g.kind === 3)
    const ex = A.grenadeExplodes.find((g) => g.kind === 3)
    console.log('  HE Spawn@', sp.pos.map((v) => v.toFixed(1)), 'Explode@', ex.pos.map((v) => v.toFixed(1)))
  })

  await scenario('击杀 → 击杀奖励 +300', async () => {
    const before = A.lastEconomy()?.money ?? 0
    const iv = A.startInputLoop(BTN.ATTACK, 0, 0, 0, 0)
    await waitFor('B 被击杀', () => A.killFeeds.length > 0 || B.killFeeds.length > 0, 8000)
    clearInterval(iv)
    const kf = A.killFeeds[0] || B.killFeeds[0]
    console.log('  击杀播报:', JSON.stringify(kf))
    await waitFor('击杀奖励到账', () => (A.lastEconomy()?.money ?? -1) > before, 5000)
    console.log('  击杀后资金:', before, '→', A.lastEconomy()?.money)
  })

  await scenario('回合胜出 → 胜利奖励 +3250', async () => {
    await waitFor('回合结束', () => A.roundStates.some((s) => s.phase === 3 && s.winner === 1), 8000)
    await waitFor('第2回合冻结 + 奖励到账', () => {
      const e = A.lastEconomy()
      return e && A.roundStates.some((s) => s.round === 2 && s.phase === 1) && e.money >= 3000
    }, 12000)
    const e = A.lastEconomy()
    console.log('  回合2资金:', e.money)
    assert(e.money >= 3000, '胜利奖励后资金应 ≥ 3000')
  })

  console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 个场景失败 ===`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
