// 对局编排：离线演示（本地权威）与联网对拍（服务器权威 + 客户端预测/校正）双模式。

import type { InputFrame, RawInput, EntitySnapshot } from '../core/types'
import { DEFAULT_COLLISION, SPAWN } from './map'
import { LocalPlayer, type LocalPlayerState } from '../prediction/localPlayer'
import { SnapshotInterpolator } from '../snapshot/interpolator'
import { EntityStore } from './entityStore'
import { GameConnection, type ServerEvent } from '../core/net/connection'

export interface MatchOptions {
  online: boolean
  connection?: GameConnection
  onError?: (msg: string) => void
  onStatus?: (connected: boolean, rttMs: number) => void
}

export class Match {
  readonly online: boolean
  local: LocalPlayer
  connection?: GameConnection
  connected = false
  rttMs = 0
  error: string | null = null
  statusText: string

  private readonly interpolator = new SnapshotInterpolator()
  private readonly entities = new EntityStore()
  private seq = 0
  private pingTimer = 0
  private readonly onError?: (msg: string) => void
  private readonly onStatus?: (connected: boolean, rttMs: number) => void

  constructor(options: MatchOptions) {
    this.online = options.online
    this.connection = options.connection
    this.onError = options.onError
    this.onStatus = options.onStatus
    this.local = new LocalPlayer(0, SPAWN, DEFAULT_COLLISION)
    this.statusText = this.online ? '连接服务器中…' : '本地演示模式'
  }

  get localId(): number {
    return this.local.state.id
  }

  get localState(): LocalPlayerState {
    return this.local.state
  }

  async start(url: string): Promise<void> {
    if (!this.online || !this.connection) return
    try {
      const info = await this.connection.connect(url)
      this.connected = true
      this.local.reset(info.playerId, SPAWN)
      this.statusText = `已连接 · ${info.tickRate} tick/s`
      this.onStatus?.(true, info.serverRttMs)
    } catch (err) {
      this.error = (err as Error).message
      this.statusText = '连接失败'
      this.onError?.(this.error)
    }
  }

  update(dt: number, raw: RawInput): void {
    const now = performance.now()

    // 1) 本地玩家预测
    this.local.step(dt, now, raw)

    // 2) 上行输入帧（仅在线且已握手）
    if (this.connected && this.connection) {
      const frame: InputFrame = {
        seq: ++this.seq,
        buttons: raw.buttons,
        yawDelta: raw.yawDelta,
        pitchDelta: raw.pitchDelta,
        forwardAxis: raw.forwardAxis,
        strafeAxis: raw.strafeAxis,
        clientSentAtMs: Math.round(now),
      }
      this.connection.sendInput(frame)
    }

    // 3) 心跳（RTT 采样）
    if (this.connected && this.connection) {
      this.pingTimer -= dt
      if (this.pingTimer <= 0) {
        this.pingTimer = 1
        this.connection.sendPing()
      }
    }

    // 4) 消费服务器事件
    if (this.connection) {
      this.processEvents(this.connection.drainEvents(), now)
    }
  }

  /** 供渲染层使用的可见实体列表。 */
  visibleEntities(): EntitySnapshot[] {
    if (!this.connected) {
      return [toSnapshot(this.local.state)]
    }
    return this.interpolator.entitiesAt(performance.now())
  }

  /** 计分板等低频数据的实体最近状态。 */
  knownEntities(): EntitySnapshot[] {
    return this.entities.all()
  }

  /**
   * 基础服务器校正（MOVE-002 简化版）：服务器快照中的本地玩家位置与预测值偏差
   * 超过阈值时硬对齐。后续里程碑改为基于输入回放与平滑插值校正（NET-005）。
   */
  private reconcileLocal(entities: EntitySnapshot[]): void {
    const self = entities.find((e) => e.id === this.localId)
    if (!self) return
    const s = this.local.state
    const dx = s.position.x - self.position.x
    const dy = s.position.y - self.position.y
    const dz = s.position.z - self.position.z
    if (Math.hypot(dx, dy, dz) > 0.5) {
      s.position.x = self.position.x
      s.position.y = self.position.y
      s.position.z = self.position.z
      s.velocity = { x: 0, y: 0, z: 0 }
    }
  }

  private processEvents(events: ServerEvent[], now: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'snapshot':
          this.interpolator.add(ev.snapshot, now)
          this.entities.apply(ev.snapshot.entities)
          this.reconcileLocal(ev.snapshot.entities)
          break
        case 'pong':
          this.rttMs = Math.max(0, Math.round(now - ev.clientSentAtMs))
          this.onStatus?.(true, this.rttMs)
          break
        case 'closed':
          this.connected = false
          this.statusText = '连接已断开'
          this.onStatus?.(false, this.rttMs)
          break
        case 'kick':
          this.error = ev.detail
          this.onError?.(this.error)
          break
        case 'welcome':
          break
      }
    }
  }
}

function toSnapshot(s: LocalPlayerState): EntitySnapshot {
  return {
    id: s.id,
    position: { ...s.position },
    yaw: s.yaw,
    pitch: s.pitch,
    moving: s.moveSpeed > 0.1,
    crouching: s.crouching,
    health: s.health,
    weaponId: s.weaponId,
  }
}
