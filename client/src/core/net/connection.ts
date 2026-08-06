import {
  MSG,
  decodeKick,
  decodePong,
  decodeSnapshot,
  decodeWelcome,
  encodeEnvelope,
  encodeHello,
  encodeInputFrame,
  encodePing,
  parseEnvelope,
} from './codec'
import type { Transport } from './transport'
import type { EntitySnapshot, InputFrame } from '../types'

export interface WelcomeInfo {
  playerId: number
  tickRate: number
  serverRttMs: number
}

export interface ServerSnapshot {
  tick: number
  entities: EntitySnapshot[]
}

export type ServerEvent =
  | { type: 'welcome'; info: WelcomeInfo }
  | { type: 'snapshot'; snapshot: ServerSnapshot }
  | { type: 'pong'; clientSentAtMs: number; serverRecvAtMs: number }
  | { type: 'kick'; reason: number; detail: string }
  | { type: 'closed'; code: number; reason: string }

/**
 * 客户端连接：握手（Hello→Welcome 或 Kick）、输入帧上行、快照/心跳事件分发。
 * 高频输入帧走不可靠通道（可靠标志关闭）；握手与 Ping 可靠。
 */
export class GameConnection {
  private readonly events: ServerEvent[] = []
  private transport: Transport
  private closed = false
  connected = false
  playerId = 0

  constructor(
    transport: Transport,
    private readonly displayName: string,
    private readonly version: [number, number, number],
  ) {
    this.transport = transport
  }

  async connect(url: string): Promise<WelcomeInfo> {
    await this.transport.connect(url, {
      onMessage: (data) => {
        try {
          this.handleMessage(data)
        } catch (err) {
          this.queue({ type: 'closed', code: -1, reason: (err as Error).message })
        }
      },
      onClose: (code, reason) => {
        this.closed = true
        this.queue({ type: 'closed', code, reason })
      },
    })

    this.send(MSG.HELLO, 0, encodeHello(this.version, this.displayName), true)

    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      const ev = this.events.shift()
      if (!ev) {
        await sleep(30)
        continue
      }
      if (ev.type === 'welcome') {
        this.connected = true
        this.playerId = ev.info.playerId
        return ev.info
      }
      if (ev.type === 'kick') throw new Error(`服务器拒绝连接: ${ev.detail}`)
      if (ev.type === 'closed') throw new Error(`连接关闭: ${ev.reason || `code ${ev.code}`}`)
    }
    throw new Error('握手超时')
  }

  sendInput(frame: InputFrame): void {
    this.send(MSG.INPUT_FRAME, frame.seq, encodeInputFrame(frame), false)
  }

  sendPing(): void {
    this.send(MSG.PING, 0, encodePing(Math.round(performance.now())), true)
  }

  /** 每帧由对局逻辑调用并消费事件队列。 */
  drainEvents(): ServerEvent[] {
    const out = this.events
    this.events.length = 0
    return out
  }

  close(): void {
    this.transport.close()
  }

  private send(msgType: number, seq: number, payload: Uint8Array, reliable: boolean): void {
    if (this.closed) return
    this.transport.send(encodeEnvelope(msgType, seq, payload, reliable))
  }

  private handleMessage(data: Uint8Array): void {
    const env = parseEnvelope(data)
    switch (env.msgType) {
      case MSG.WELCOME:
        this.queue({ type: 'welcome', info: decodeWelcome(env.payload) })
        break
      case MSG.SNAPSHOT:
        this.queue({ type: 'snapshot', snapshot: decodeSnapshot(env.payload) })
        break
      case MSG.PONG: {
        const p = decodePong(env.payload)
        this.queue({ type: 'pong', clientSentAtMs: p.clientSentAtMs, serverRecvAtMs: p.serverRecvAtMs })
        break
      }
      case MSG.KICK: {
        const k = decodeKick(env.payload)
        this.queue({ type: 'kick', reason: k.reason, detail: k.detail })
        break
      }
      default:
        break // 忽略未知消息类型
    }
  }

  private queue(ev: ServerEvent): void {
    this.events.push(ev)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
