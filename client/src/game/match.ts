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

export interface RoundState {
  phase: number // 0=idle 1=freeze 2=active 3=round_end 4=match_end
  round: number
  timeMs: number
  attackScore: number
  defendScore: number
  bomb: number // 0=none 1=planting 2=planted 3=defusing 4=exploded 5=defused
  bombSite: number
  winner: number
}

export interface KillEntry {
  attackerId: number
  victimId: number
  weaponId: number
  headshot: boolean
  atMs: number
}

export interface MatchEndInfo {
  winner: number
  attackScore: number
  defendScore: number
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

  /** 服务器回合状态（供 HUD 展示）。 */
  round: RoundState = { phase: 0, round: 0, timeMs: 0, attackScore: 0, defendScore: 0, bomb: 0, bombSite: 0, winner: 0 }
  /** 击杀播报队列（保留最近 6 条）。 */
  killFeed: KillEntry[] = []
  matchEnd: MatchEndInfo | null = null

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

    // 1) 本地玩家预测（死亡后冻结，等待服务器下回合重生）
    if (this.local.state.health > 0) {
      this.local.step(dt, now, raw)
    }

    // 2) 上行输入帧（仅在线、已握手且存活）
    if (this.connected && this.connection && this.local.state.health > 0) {
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
   * 超过阈值时硬对齐；同时同步血量与队伍（服务器权威）。
   */
  private reconcileLocal(entities: EntitySnapshot[]): void {
    const self = entities.find((e) => e.id === this.localId)
    if (!self) return
    const s = this.local.state
    s.health = self.health
    s.team = self.team
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
        case 'roundState':
          this.round = {
            phase: ev.phase,
            round: ev.round,
            timeMs: ev.timeMs,
            attackScore: ev.attackScore,
            defendScore: ev.defendScore,
            bomb: ev.bomb,
            bombSite: ev.bombSite,
            winner: ev.winner,
          }
          this.roundUpdatedAtMs = now
          break
        case 'killFeed':
          this.killFeed.push({
            attackerId: ev.attackerId,
            victimId: ev.victimId,
            weaponId: ev.weaponId,
            headshot: (ev.flags & 1) !== 0,
            atMs: now,
          })
          if (this.killFeed.length > 6) this.killFeed.shift()
          break
        case 'matchEnd':
          this.matchEnd = {
            winner: ev.winner,
            attackScore: ev.attackScore,
            defendScore: ev.defendScore,
          }
          break
        case 'damage':
          break
      }
    }
  }

  private roundUpdatedAtMs = 0

  /** 本地倒计时的剩余毫秒。 */
  roundTimeRemaining(): number {
    if (this.round.timeMs <= 0) return 0
    const elapsed = performance.now() - this.roundUpdatedAtMs
    return Math.max(0, this.round.timeMs - elapsed)
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
    team: s.team,
  }
}
