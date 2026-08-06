// 对局核心玩法联调测试：双客户端
// 场景1：A(进攻)击杀B(防守) → 击杀播报 + 回合结算 + 计分
// 场景2：A 走到B点安装炸弹 → 炸弹状态同步
const URL = 'ws://127.0.0.1:9000/ws'

const BTN = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, CROUCH: 32, SPRINT: 64, ATTACK: 128, USE: 256, RELOAD: 512 }

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
      ents.push({ id, flags, x: x / 100, y: y / 100, z: z / 100, yaw: yaw / 100, pitch: pitch / 100, health, team })
    }
    return { type: 'snapshot', tick, ents }
  }
  if (t === 8) return { type: 'roundState', phase: data[10], round: data[11], timeMs: dv.getUint16(12), atk: data[14], def: data[15], bomb: data[16], site: data[17], winner: data[18] }
  if (t === 9) return { type: 'killFeed', attacker: dv.getUint32(10), victim: dv.getUint32(14), weapon: data[18], flags: data[19], dist: dv.getUint16(20) }
  if (t === 10) return { type: 'matchEnd', winner: data[10], atk: data[11], def: data[12] }
  if (t === 7) return { type: 'kick', reason: data[10] }
  return { type: 'other', t }
}

class GameClient {
  constructor(name) {
    this.name = name
    this.inputSeq = 0
    this.welcome = null
    this.roundStates = []
    this.killFeeds = []
    this.matchEnd = null
    this.latest = null
    this.bad = 0
    this.ws = new WebSocket(URL)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => this.ws.send(env(1, 0, hello(name), true))
    this.ws.onmessage = (ev) => this.handle(new Uint8Array(ev.data))
    this.ws.onerror = () => { console.error(this.name, 'ws error') }
  }
  handle(data) {
    if (data[0] !== 0xf5) { this.bad++; return }
    const m = decodeMsg(data)
    switch (m.type) {
      case 'welcome': this.welcome = m; break
      case 'snapshot': this.latest = m; break
      case 'roundState': this.roundStates.push(m); break
      case 'killFeed': this.killFeeds.push(m); break
      case 'matchEnd': this.matchEnd = m; break
      case 'kick': console.error(this.name, 'KICK', m.reason); break
    }
  }
  sendInput(buttons, yaw = 0, pitch = 0, fwd = 0, strafe = 0) {
    this.ws.send(env(3, ++this.inputSeq, inputFrame(this.inputSeq, buttons, yaw, pitch, fwd, strafe), false))
  }
  startInputLoop(buttons, yaw = 0, pitch = 0, fwd = 0, strafe = 0) {
    return setInterval(() => this.sendInput(buttons, yaw, pitch, fwd, strafe), 15)
  }
  selfEnt() {
    if (!this.latest || !this.welcome) return null
    return this.latest.ents.find((e) => e.id === this.welcome.playerId) || null
  }
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
await sleep(300)

async function main() {
  await scenario('握手与队伍分配', async () => {
    await waitFor('双方 welcome', () => A.welcome && B.welcome, 5000)
    console.log('  A:', A.welcome, ' B:', B.welcome)
    await waitFor('首回合冻结', () => A.roundStates.some((s) => s.phase === 1), 5000)
    const ent = await waitForSnapTeam(A)
    console.log('  A team:', ent.team, ' B team:', ent2(B)?.team)
  })

  await scenario('行动阶段 A 击杀 B', async () => {
    await waitFor('进入行动', () => A.roundStates.some((s) => s.phase === 2), 12000)
    const killIv = A.startInputLoop(BTN.ATTACK, 0, 0, 0, 0)
    await waitFor('收到击杀播报', () => A.killFeeds.length > 0 || B.killFeeds.length > 0, 10000)
    clearInterval(killIv)
    const kf = A.killFeeds[0] || B.killFeeds[0]
    console.log('  击杀播报:', JSON.stringify(kf))
    assert(kf.attacker === A.welcome.playerId, `攻击方应为 A(${A.welcome.playerId})`)
    assert(kf.victim === B.welcome.playerId, `受害者应为 B(${B.welcome.playerId})`)
    assert(kf.flags & 1, '应为爆头')
  })

  await scenario('回合结算：防守方全灭 → 进攻方胜', async () => {
    await waitFor('回合结束', () => A.roundStates.some((s) => s.phase === 3 && s.winner === 1), 10000)
    const st = A.roundStates.filter((s) => s.phase === 3 && s.winner === 1).at(-1)
    console.log('  回合结束状态:', JSON.stringify(st))
    assert(st.atk === 1 && st.def === 0, '计分应为 1:0')
    const bEnt = B.selfEnt()
    console.log('  B 实体:', bEnt)
    assert(bEnt && bEnt.health === 0, 'B 生命应为 0')
  })

  await scenario('第2回合 A 前往B点安装炸弹', async () => {
    await waitFor('第2回合冻结', () => A.roundStates.some((s) => s.round === 2 && s.phase === 1), 15000)
    // 转向 B 点方向 (14,14)，yaw ≈ -113.3°
    A.sendInput(0, -11330, 0, 0, 0)
    await waitFor('进入行动', () => A.roundStates.some((s) => s.round === 2 && s.phase === 2), 10000)
    const fwdIv = A.startInputLoop(BTN.FWD, 0, 0, 127, 0)
    await waitFor('A 抵达 B 点', () => {
      const e = A.selfEnt()
      return e && Math.hypot(e.x - 14, e.z - 14) < 1.2
    }, 25000)
    clearInterval(fwdIv)
    const pos = A.selfEnt()
    console.log('  A 抵达位置:', pos ? `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}` : 'null')
    const useIv = A.startInputLoop(BTN.USE, 0, 0, 0, 0)
    await waitFor('炸弹安装成功', () => A.roundStates.some((s) => s.bomb === 2 && s.site === 1), 12000)
    clearInterval(useIv)
    const st = A.roundStates.filter((s) => s.bomb === 2).at(-1)
    console.log('  炸弹状态:', JSON.stringify(st))
  })

  await scenario('防守方 B 拆除炸弹 → 防守方胜', async () => {
    // B 从 (0,-8) 转向炸弹点 (14,14)：yaw 180 → 212.2°（+3220 厘度）
    B.sendInput(0, 3220, 0, 0, 0)
    const bFwd = B.startInputLoop(BTN.FWD, 0, 0, 127, 0)
    await waitFor('B 抵达炸弹点', () => {
      const e = B.selfEnt()
      return e && Math.hypot(e.x - 14, e.z - 14) < 1.2
    }, 25000)
    clearInterval(bFwd)
    const bUse = B.startInputLoop(BTN.USE, 0, 0, 0, 0)
    await waitFor('炸弹被拆除', () => B.roundStates.some((s) => s.bomb === 5), 15000)
    clearInterval(bUse)
    const st = B.roundStates.filter((s) => s.bomb === 5).at(-1)
    console.log('  拆除状态:', JSON.stringify(st))
    await waitFor('防守方胜', () => B.roundStates.some((s) => s.phase === 3 && s.winner === 2), 10000)
    const rst = B.roundStates.filter((s) => s.phase === 3 && s.winner === 2).at(-1)
    console.log('  回合结束:', JSON.stringify(rst))
    assert(rst.def === 1, '防守方计分应为 1')
  })

  console.log(failures === 0 ? '\n=== 全部通过 ===' : `\n=== ${failures} 个场景失败 ===`)
  process.exit(failures === 0 ? 0 : 1)
}

async function waitForSnapTeam(c) {
  const start = Date.now()
  while (Date.now() - start < 5000) {
    const e = c.selfEnt()
    if (e && e.team) return e
    await sleep(50)
  }
  throw new Error('等待队伍信息超时')
}
function ent2(c) {
  if (!c.latest) return null
  return c.latest.ents.find((e) => e.id === c.welcome.playerId) || null
}

await main()
