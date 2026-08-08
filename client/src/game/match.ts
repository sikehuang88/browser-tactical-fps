// 对局编排：离线演示（本地权威）与联网对拍（服务器权威 + 客户端预测/校正）双模式。

import type { GameModeId, InputFrame, RawInput, EntitySnapshot, Vec3 } from '../core/types'
import { ARENA_BOUNDS, BOMB_SITES, DEFAULT_COLLISION, SPAWN } from './map'
import { LocalPlayer, type LocalPlayerState } from '../prediction/localPlayer'
import { SnapshotInterpolator } from '../snapshot/interpolator'
import { EntityStore } from './entityStore'
import { GameConnection, type ServerEvent } from '../core/net/connection'
import type { GrenadeSpawnMsg, GrenadeExplodeMsg } from '../core/net/codec'
import { getWeapon } from './weapons/registry'
import { BUTTON } from '../core/input'
import { OfflineBotController, type OfflineShotResult } from './offlineBots'
import { SHOP_ITEMS } from './shop'

/** 客户端效果事件（音频/投掷物视觉），由引擎每帧交给 Effects 处理。 */
export type MatchEffect =
  | { type: 'grenadeSpawn'; msg: GrenadeSpawnMsg }
  | { type: 'grenadeExplode'; msg: GrenadeExplodeMsg }
  | { type: 'flash'; strength: number }

export interface GrenadeCounts {
  smoke: number
  flash: number
  he: number
}

export interface MatchOptions {
  online: boolean
  mode: GameModeId
  connection?: GameConnection
  onError?: (msg: string) => void
  onStatus?: (connected: boolean, rttMs: number) => void
  /** 本地玩家击杀时触发（击杀音效）。 */
  onKill?: () => void
  /** 本地命中确认时触发（命中标记/命中音效）。 */
  onHit?: (result: { killed: boolean; damage: number }) => void
  /** 本地玩家受伤时触发（受击音效/红色屏幕反馈）。 */
  onHurt?: (damage: number) => void
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

export const TEAM_DEATHMATCH_LIMIT = 50

const OFFLINE_DEMOLITION_ROUNDS_TO_WIN = 6
const OFFLINE_DEMOLITION_MAX_ROUNDS = 10
const OFFLINE_FREEZE_MS = 15_000
const OFFLINE_ROUND_MS = 90_000
const OFFLINE_BOMB_MS = 40_000
const OFFLINE_PLANT_MS = 3500
const OFFLINE_DEFUSE_MS = 8000
const OFFLINE_ROUND_END_MS = 4000
const OFFLINE_DEFEND_SPAWN: Vec3 = { x: 0, y: 0, z: -24 }
const OFFLINE_START_MONEY = 800
const OFFLINE_MAX_MONEY = 16_000
const OFFLINE_KILL_REWARD = 300
const OFFLINE_WIN_REWARD = 3250
const OFFLINE_LOSS_BASE = 1400
const OFFLINE_LOSS_STREAK_BONUS = 500
const OFFLINE_LOSS_CAP = 3400
const OFFLINE_PLANT_BONUS = 300
const OFFLINE_DEFUSE_BONUS = 300
const OFFLINE_BUY_ZONE_RADIUS = 5
const OFFLINE_MAX_GRENADES_PER_TYPE = 3

export class Match {
  readonly online: boolean
  readonly mode: GameModeId
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
  private readonly onKill?: () => void
  private readonly onHit?: (result: { killed: boolean; damage: number }) => void
  private readonly onHurt?: (damage: number) => void
  private readonly offlineBots: OfflineBotController | null
  private readonly offlineDemolition: boolean
  private offlineShots = 0
  private offlineRespawnAtMs = 0
  private offlineRoundEndAtMs = 0
  private offlineActiveUntilMs = 0
  private offlineBombPlantedAtMs = 0
  private offlinePlantProgress = 0
  private offlineDefuseProgress = 0
  private offlineWeaponRefund: number | null = null
  private offlineAttackLossStreak = 0
  private offlineDefendLossStreak = 0
  spectating = false
  spectateGodView = true
  spectateTargetId: number | null = null
  private spectatorPos: Vec3 = { x: 0, y: 2, z: 0 }
  private spectatorYaw = 0
  private spectatorPitch = 0
  private spectateIndex = 0
  private lastServerYaw = 0
  private lastServerPitch = 0
  private lastServerViewAtMs = 0
  hitFeedback = { sequence: 0, kind: 'none' as 'none' | 'hit' | 'kill', damage: 0, atMs: 0 }
  hurtFeedback = { sequence: 0, damage: 0, atMs: 0 }

  /** 服务器回合状态（供 HUD 展示）。 */
  round: RoundState = { phase: 0, round: 0, timeMs: 0, attackScore: 0, defendScore: 0, bomb: 0, bombSite: 0, winner: 0 }
  /** 击杀播报队列（保留最近 6 条）。 */
  killFeed: KillEntry[] = []
  matchEnd: MatchEndInfo | null = null

  /** 经济状态（服务器权威，ECONOMY 消息同步）。 */
  money = 0
  armor = 0
  grenades: GrenadeCounts = { smoke: 0, flash: 0, he: 0 }
  /** 致盲强度与时间。 */
  flashStrength = 0
  flashAtMs = 0
  private pendingEffects: MatchEffect[] = []

  constructor(options: MatchOptions) {
    this.online = options.online
    this.mode = options.mode
    this.offlineDemolition = !this.online && options.mode === 'demolition'
    this.connection = options.connection
    this.onError = options.onError
    this.onStatus = options.onStatus
    this.onKill = options.onKill
    this.onHit = options.onHit
    this.onHurt = options.onHurt
    this.offlineBots = this.online
      ? null
      : new OfflineBotController(DEFAULT_COLLISION, { allowRespawn: !this.offlineDemolition })
    this.local = new LocalPlayer(0, SPAWN, DEFAULT_COLLISION, this.online ? 2 : 1)
    if (!this.online) this.local.state.team = 1
    this.statusText = this.online ? '连接服务器中…' : '本地演示模式'
    if (!this.online) {
      this.round = { phase: 2, round: 1, timeMs: 0, attackScore: 0, defendScore: 0, bomb: 0, bombSite: 0, winner: 0 }
    }
    if (this.offlineDemolition) {
      this.round = { phase: 1, round: 1, timeMs: OFFLINE_FREEZE_MS, attackScore: 0, defendScore: 0, bomb: 0, bombSite: 0, winner: 0 }
      const now = performance.now()
      this.roundUpdatedAtMs = now
      this.offlineRoundEndAtMs = now + OFFLINE_FREEZE_MS
      this.local.state.team = 1
      this.money = OFFLINE_START_MONEY
      this.armor = 0
      this.grenades = { smoke: 0, flash: 0, he: 0 }
      this.offlineWeaponRefund = null
      this.offlineAttackLossStreak = 0
      this.offlineDefendLossStreak = 0
      this.statusText = '本地爆破演示模式'
    }
  }

  get localId(): number {
    return this.local.state.id
  }

  get localState(): LocalPlayerState {
    return this.local.state
  }

  renderLocalState(alpha: number): LocalPlayerState {
    if (this.spectating) return this.spectatorViewState()
    return this.local.renderState(alpha)
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
      const predictedRaw = (this.online || this.offlineDemolition) && this.round.phase !== 2
        ? { ...raw, buttons: raw.buttons & BUTTON.CROUCH, forwardAxis: 0, strafeAxis: 0 }
        : raw
      this.local.step(dt, now, predictedRaw)
    }
    if (this.local.state.health <= 0 && !this.spectating && (this.online || this.offlineDemolition)) {
      this.startSpectating()
    }
    if (this.spectating) this.updateSpectator(dt, raw)

    if (!this.online && this.offlineBots) {
      if (this.matchEnd) return
      if (this.offlineDemolition) {
        this.updateOfflineDemolition(dt, now, raw)
      } else {
        if (this.local.state.health <= 0) {
          if (this.offlineRespawnAtMs === 0) this.offlineRespawnAtMs = now + 1800
          if (now >= this.offlineRespawnAtMs) {
            this.local.reset(this.localId, SPAWN)
            this.local.state.team = 1
            this.offlineBots.reset()
            this.offlineShots = 0
            this.offlineRespawnAtMs = 0
          }
        }
        const healthBeforeBots = this.local.state.health
        this.offlineBots.update(dt, now, this.local.state)
        if (this.local.state.health < healthBeforeBots) {
          this.recordHurt(healthBeforeBots - this.local.state.health, now)
        }
        const result = this.offlineBots.resolveLocalShot(this.local.state, this.offlineShots)
        if (result) this.recordHit(result, now)
        for (const event of this.offlineBots.drainCombatEvents()) {
          this.killFeed.push({ attackerId: event.attackerId, victimId: event.victimId, weaponId: event.weaponId, headshot: false, atMs: now })
          if (this.killFeed.length > 6) this.killFeed.shift()
          this.addTeamDeathmatchScore(event.attackerId, event.victimId)
        }
        this.offlineShots = this.local.state.shotsFired
      }
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
        clientSentAtMs: Date.now() >>> 0,
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

  // ---------- 离线爆破模式（本地权威回合制） ----------

  private updateOfflineDemolition(dt: number, now: number, raw: RawInput): void {
    const bots = this.offlineBots!
    const s = this.local.state

    if (this.round.phase === 2) {
      const healthBeforeBots = s.health
      bots.update(dt, now, s)
      if (s.health < healthBeforeBots) this.recordHurt(healthBeforeBots - s.health, now)
      const result = bots.resolveLocalShot(s, this.offlineShots)
      if (result) {
        if (result.killed) this.grantOfflineMoney(OFFLINE_KILL_REWARD)
        this.recordHit(result, now)
      }
      for (const event of bots.drainCombatEvents()) {
        this.killFeed.push({
          attackerId: event.attackerId,
          victimId: event.victimId,
          weaponId: event.weaponId,
          headshot: false,
          atMs: now,
        })
        if (this.killFeed.length > 6) this.killFeed.shift()
      }
      this.offlineShots = s.shotsFired
    }

    if (this.round.phase === 1 && now >= this.offlineRoundEndAtMs) {
      this.round.phase = 2
      this.round.timeMs = OFFLINE_ROUND_MS
      this.roundUpdatedAtMs = now
      this.offlineActiveUntilMs = now + OFFLINE_ROUND_MS
      this.offlinePlantProgress = 0
      this.offlineDefuseProgress = 0
      return
    }
    if (this.round.phase !== 2) {
      if (this.round.phase === 3 && now >= this.offlineRoundEndAtMs) this.nextOfflineRound(now)
      return
    }

    this.updateOfflineBomb(dt, now, raw)
    if (this.round.phase !== 2) return

    const attackAlive = this.offlineAliveCount(1)
    const defendAlive = this.offlineAliveCount(2)
    if (this.round.bomb !== 2 && attackAlive === 0) {
      this.finishOfflineRound(2, now)
      return
    }
    if (defendAlive === 0) {
      this.finishOfflineRound(1, now)
      return
    }
    if (this.round.bomb === 0 && now >= this.offlineActiveUntilMs) {
      this.finishOfflineRound(2, now)
      return
    }
    if (this.round.bomb === 2 && now - this.offlineBombPlantedAtMs >= OFFLINE_BOMB_MS) {
      this.round.bomb = 4
      this.finishOfflineRound(1, now)
    }
  }

  private updateOfflineBomb(dt: number, now: number, raw: RawInput): void {
    const s = this.local.state
    if (s.health <= 0) return
    const holdingUse = (raw.buttons & BUTTON.USE) !== 0
    const plantSiteIndex = s.team === 1 ? this.offlineSiteIndex(s.position) : -1
    const defuseSiteIndex = s.team === 2 ? this.round.bombSite : -1
    const defuseNear =
      defuseSiteIndex >= 0 &&
      defuseSiteIndex < BOMB_SITES.length &&
      this.offlineDistanceToSite(s.position, defuseSiteIndex) < 2

    if (plantSiteIndex >= 0 && (this.round.bomb === 0 || this.round.bomb === 1) && holdingUse) {
      this.round.bomb = 1
      this.offlinePlantProgress += dt / (OFFLINE_PLANT_MS / 1000)
      if (this.offlinePlantProgress >= 1) {
        this.round.bomb = 2
        this.round.bombSite = plantSiteIndex
        this.round.timeMs = OFFLINE_BOMB_MS
        this.roundUpdatedAtMs = now
        this.offlineBombPlantedAtMs = now
        this.offlinePlantProgress = 0
        this.grantOfflineMoney(OFFLINE_PLANT_BONUS)
      }
    } else if (defuseNear && (this.round.bomb === 2 || this.round.bomb === 3) && holdingUse) {
      this.round.bomb = 3
      this.offlineDefuseProgress += dt / (OFFLINE_DEFUSE_MS / 1000)
      if (this.offlineDefuseProgress >= 1) {
        this.round.bomb = 5
        this.offlineDefuseProgress = 0
        this.grantOfflineMoney(OFFLINE_DEFUSE_BONUS)
        this.finishOfflineRound(2, now)
      }
    } else {
      if (this.round.bomb === 1) {
        this.round.bomb = 0
        this.offlinePlantProgress = 0
      }
      if (this.round.bomb === 3) {
        this.round.bomb = 2
        this.offlineDefuseProgress = 0
      }
    }
  }

  private offlineSiteIndex(position: Vec3): number {
    for (let i = 0; i < BOMB_SITES.length; i += 1) {
      if (this.offlineDistanceToSite(position, i) < 2) return i
    }
    return -1
  }

  private offlineDistanceToSite(position: Vec3, siteIndex: number): number {
    const site = BOMB_SITES[siteIndex]
    if (!site) return Infinity
    return Math.hypot(position.x - site.position.x, position.z - site.position.z)
  }

  private finishOfflineRound(winner: number, now: number): void {
    this.round.phase = 3
    this.round.timeMs = OFFLINE_ROUND_END_MS
    this.roundUpdatedAtMs = now
    this.round.winner = winner
    if (winner === 1) this.round.attackScore += 1
    else if (winner === 2) this.round.defendScore += 1
    const localTeam = this.local.state.team
    if (winner === 1) {
      this.offlineAttackLossStreak = 0
      this.offlineDefendLossStreak += 1
    } else if (winner === 2) {
      this.offlineDefendLossStreak = 0
      this.offlineAttackLossStreak += 1
    }
    if (winner === localTeam) {
      this.grantOfflineMoney(OFFLINE_WIN_REWARD)
    } else {
      const streak = localTeam === 1 ? this.offlineAttackLossStreak : this.offlineDefendLossStreak
      const reward = Math.min(
        OFFLINE_LOSS_CAP,
        OFFLINE_LOSS_BASE + OFFLINE_LOSS_STREAK_BONUS * Math.min(4, streak),
      )
      this.grantOfflineMoney(reward)
    }
    this.offlineRoundEndAtMs = now + OFFLINE_ROUND_END_MS

    const maxRoundsReached = this.round.round >= OFFLINE_DEMOLITION_MAX_ROUNDS
    if (
      this.round.attackScore >= OFFLINE_DEMOLITION_ROUNDS_TO_WIN ||
      this.round.defendScore >= OFFLINE_DEMOLITION_ROUNDS_TO_WIN ||
      maxRoundsReached
    ) {
      let finalWinner = winner
      if (maxRoundsReached && this.round.attackScore !== this.round.defendScore) {
        finalWinner = this.round.attackScore > this.round.defendScore ? 1 : 2
      } else if (maxRoundsReached) {
        finalWinner = 0
      }
      this.matchEnd = {
        winner: finalWinner,
        attackScore: this.round.attackScore,
        defendScore: this.round.defendScore,
      }
      this.round.phase = 4
    }
  }

  private nextOfflineRound(now: number): void {
    const nextRound = this.round.round + 1
    if (nextRound > OFFLINE_DEMOLITION_MAX_ROUNDS) {
      this.matchEnd = {
        winner:
          this.round.attackScore === this.round.defendScore
            ? 0
            : this.round.attackScore > this.round.defendScore
              ? 1
              : 2,
        attackScore: this.round.attackScore,
        defendScore: this.round.defendScore,
      }
      this.round.phase = 4
      return
    }

    const firstHalf = nextRound <= OFFLINE_DEMOLITION_MAX_ROUNDS / 2
    this.round.round = nextRound
    this.offlineBots?.resetForRound(firstHalf)
    this.resetOfflineLocalForRound(firstHalf ? 1 : 2)

    this.round.phase = 1
    this.round.timeMs = OFFLINE_FREEZE_MS
    this.roundUpdatedAtMs = now
    this.offlineRoundEndAtMs = now + OFFLINE_FREEZE_MS
    this.round.bomb = 0
    this.round.winner = 0
    this.offlinePlantProgress = 0
    this.offlineDefuseProgress = 0
  }

  private resetOfflineLocalForRound(team: number): void {
    const spawn = team === 1 ? SPAWN : OFFLINE_DEFEND_SPAWN
    this.local.reset(this.localId, spawn)
    this.local.state.team = team
    this.local.correctView(team === 2 ? 180 : 0, 0)
    this.offlineShots = 0
    this.offlineRespawnAtMs = 0
    this.armor = 0
    this.grenades = { smoke: 0, flash: 0, he: 0 }
    this.offlineWeaponRefund = null
    this.stopSpectating()
  }

  private offlineAliveCount(team: number): number {
    let count = 0
    if (this.local.state.team === team && this.local.state.health > 0) count += 1
    for (const bot of this.offlineBots?.snapshots() ?? []) {
      if (bot.team === team && bot.health > 0) count += 1
    }
    return count
  }

  // ---------- 死亡观战 ----------

  private startSpectating(): void {
    this.spectating = true
    this.spectateGodView = true
    this.spectateTargetId = null
    this.spectatorPos = {
      x: this.local.state.position.x,
      y: this.local.state.position.y + 2.2,
      z: this.local.state.position.z,
    }
    this.spectatorYaw = this.local.state.yaw
    this.spectatorPitch = this.local.state.pitch
  }

  private stopSpectating(): void {
    this.spectating = false
    this.spectateTargetId = null
    this.spectateGodView = true
  }

  private updateSpectator(dt: number, raw: RawInput): void {
    this.spectatorYaw = normalizeDeg(this.spectatorYaw + raw.yawDelta / 100)
    this.spectatorPitch = clampNum(this.spectatorPitch + raw.pitchDelta / 100, -89, 89)

    if (this.spectateGodView) {
      const yawRad = (this.spectatorYaw * Math.PI) / 180
      const forward = { x: -Math.sin(yawRad), z: -Math.cos(yawRad) }
      const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) }
      let mx = 0
      let my = 0
      let mz = 0
      if (raw.buttons & BUTTON.FORWARD) {
        mx += forward.x
        mz += forward.z
      }
      if (raw.buttons & BUTTON.BACK) {
        mx -= forward.x
        mz -= forward.z
      }
      if (raw.buttons & BUTTON.RIGHT) {
        mx += right.x
        mz += right.z
      }
      if (raw.buttons & BUTTON.LEFT) {
        mx -= right.x
        mz -= right.z
      }
      if (raw.buttons & BUTTON.JUMP) my += 1
      if (raw.buttons & BUTTON.CROUCH) my -= 1
      const length = Math.hypot(mx, my, mz) || 1
      const speed = (raw.buttons & BUTTON.SPRINT) ? 16 : 8
      this.spectatorPos.x = clampNum(
        this.spectatorPos.x + (mx / length) * speed * dt,
        ARENA_BOUNDS.min.x + 0.5,
        ARENA_BOUNDS.max.x - 0.5,
      )
      this.spectatorPos.z = clampNum(
        this.spectatorPos.z + (mz / length) * speed * dt,
        ARENA_BOUNDS.min.z + 0.5,
        ARENA_BOUNDS.max.z - 0.5,
      )
      this.spectatorPos.y = clampNum(
        this.spectatorPos.y + (my / length) * speed * dt,
        0.5,
        14,
      )
      return
    }

    const target = this.spectateTargets().find((entity) => entity.id === this.spectateTargetId)
    if (target) {
      this.spectatorPos = {
        x: target.position.x,
        y: target.position.y + 1.6,
        z: target.position.z,
      }
      this.spectatorYaw = target.yaw
      this.spectatorPitch = target.pitch
    } else {
      this.spectateGodView = true
      this.spectateTargetId = null
    }
  }

  private spectatorViewState(): LocalPlayerState {
    const base = this.local.state
    return {
      id: base.id,
      position: { ...this.spectatorPos },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: this.spectatorYaw,
      pitch: this.spectatorPitch,
      onGround: false,
      crouching: false,
      sprinting: false,
      height: base.height,
      health: 0,
      weaponId: base.weaponId,
      ammo: base.ammo,
      reloading: false,
      reloadEndAtMs: 0,
      moveSpeed: 0,
      shotsFired: base.shotsFired,
      charge: base.charge,
      aiming: false,
      team: base.team,
    }
  }

  private spectateTargets(): EntitySnapshot[] {
    const entities = this.connected
      ? this.entities.all()
      : [toSnapshot(this.local.state), ...(this.offlineBots?.snapshots() ?? [])]
    return entities.filter(
      (entity) =>
        entity.team === this.local.state.team &&
        entity.health > 0 &&
        entity.id !== this.localId,
    )
  }

  /** 循环切换到下一个存活队友视角（F）。 */
  cycleSpectateTarget(): void {
    if (!this.spectating) return
    const targets = this.spectateTargets()
    if (targets.length === 0) {
      this.spectateGodView = true
      this.spectateTargetId = null
      return
    }
    this.spectateIndex = (this.spectateIndex + 1) % targets.length
    const target = targets[this.spectateIndex]
    this.spectateTargetId = target.id
    this.spectateGodView = false
  }

  /** 返回上帝自由视角（G）。 */
  setGodView(): void {
    if (!this.spectating) return
    this.spectateGodView = true
    this.spectateTargetId = null
  }

  /** 供渲染层使用的可见实体列表。 */
  visibleEntities(): EntitySnapshot[] {
    if (!this.connected) {
      return [toSnapshot(this.local.state), ...(this.offlineBots?.snapshots() ?? [])]
    }
    return this.interpolator.entitiesAt(performance.now())
  }

  /** 计分板等低频数据的实体最近状态。 */
  knownEntities(): EntitySnapshot[] {
    return this.connected ? this.entities.all() : [toSnapshot(this.local.state), ...(this.offlineBots?.snapshots() ?? [])]
  }

  /**
   * 基础服务器校正（MOVE-002 简化版）：服务器快照中的本地玩家位置与预测值偏差
   * 超过阈值时硬对齐；同时同步血量与队伍（服务器权威）。
   */
  private reconcileLocal(entities: EntitySnapshot[]): void {
    const self = entities.find((e) => e.id === this.localId)
    if (!self) return
    const s = this.local.state
    const previousHealth = s.health
    s.health = self.health
    s.team = self.team
    if (self.health > 0) this.stopSpectating()
    this.local.syncWeapon(self.weaponId, self.ammo, self.reloading)
    if (self.health < previousHealth && previousHealth > 0) {
      this.recordHurt(previousHealth - self.health, performance.now())
    }
    const dx = s.position.x - self.position.x
    const dy = s.position.y - self.position.y
    const dz = s.position.z - self.position.z
    if (Math.hypot(dx, dy, dz) > 0.5) {
      this.local.correctPosition(self.position)
      // 位置硬校正时同步视角：回合重生/传送后避免枪口视角与服务器长期错位。
      this.local.correctView(self.yaw, self.pitch)
    }

    // 视角漂移收敛：仅当服务器视角连续稳定且本地偏差过大时才硬校正，
    // 避免快速甩枪时被延迟快照误拉回。
    const now = performance.now()
    const serverYawMoved = Math.abs(angleDelta(this.lastServerYaw, self.yaw)) > 1
    const serverPitchMoved = Math.abs(self.pitch - this.lastServerPitch) > 1
    const serverViewMoved = serverYawMoved || serverPitchMoved
    if (serverViewMoved) this.lastServerViewAtMs = now
    const serverViewStable = now - this.lastServerViewAtMs > 80 && !serverViewMoved
    const viewYawDelta = angleDelta(s.yaw, self.yaw)
    if (
      serverViewStable &&
      (Math.abs(viewYawDelta) > 8 || Math.abs(self.pitch - s.pitch) > 8)
    ) {
      this.local.correctView(self.yaw, self.pitch)
    }
    this.lastServerYaw = self.yaw
    this.lastServerPitch = self.pitch
    this.lastServerViewAtMs = now
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
          this.rttMs = Math.max(0, Math.round(Date.now() - ev.clientSentAtMs))
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
          if (ev.info.tickRate > 0) this.interpolator.setTickRate(ev.info.tickRate)
          break
        case 'roundState':
          if (ev.phase !== 4 && ev.round === 1) this.matchEnd = null
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
          if (ev.attackerId === this.localId) this.recordHit({ victimId: ev.victimId, damage: 0, killed: true }, now)
          break
        case 'matchEnd':
          this.matchEnd = {
            winner: ev.winner,
            attackScore: ev.attackScore,
            defendScore: ev.defendScore,
          }
          break
        case 'damage':
          if (ev.victimHealth > 0) {
            this.recordHit({ victimId: ev.victimId, damage: ev.damage, killed: false }, now)
          }
          break
        case 'economy':
          this.money = ev.economy.money
          this.armor = ev.economy.armor
          if (ev.economy.playerId === this.localId && ev.economy.weaponId !== this.local.state.weaponId) {
            const weapon = getWeapon(ev.economy.weaponId)
            if (weapon) this.local.syncWeapon(weapon.id, weapon.ammo, false)
          }
          this.grenades = {
            smoke: ev.economy.nSmoke,
            flash: ev.economy.nFlash,
            he: ev.economy.nHe,
          }
          break
        case 'grenadeSpawn':
          this.pendingEffects.push({
            type: 'grenadeSpawn',
            msg: { id: ev.id, kind: ev.kind, ownerId: ev.ownerId, pos: ev.pos, vel: ev.vel },
          })
          break
        case 'grenadeExplode':
          this.pendingEffects.push({
            type: 'grenadeExplode',
            msg: { id: ev.id, kind: ev.kind, pos: ev.pos },
          })
          break
        case 'flash':
          this.flashStrength = ev.strength
          this.flashAtMs = performance.now()
          this.pendingEffects.push({ type: 'flash', strength: ev.strength })
          break
      }
    }
  }

  private recordHit(result: OfflineShotResult, now: number): void {
    this.hitFeedback = { sequence: this.hitFeedback.sequence + 1, kind: result.killed ? 'kill' : 'hit', damage: result.damage, atMs: now }
    this.onHit?.({ killed: result.killed, damage: result.damage })
    if (result.killed) {
      this.killFeed.push({ attackerId: this.localId, victimId: result.victimId, weaponId: this.local.state.weaponId, headshot: false, atMs: now })
      if (this.killFeed.length > 6) this.killFeed.shift()
      this.onKill?.()
      this.addTeamDeathmatchScore(this.localId, result.victimId)
    }
  }

  private recordHurt(damage: number, now: number): void {
    if (damage <= 0) return
    this.hurtFeedback = { sequence: this.hurtFeedback.sequence + 1, damage, atMs: now }
    this.onHurt?.(damage)
  }

  private addTeamDeathmatchScore(attackerId: number, victimId: number): void {
    if (this.online || this.offlineDemolition || this.matchEnd) return
    const attackerTeam = attackerId === this.localId ? this.local.state.team : this.offlineBots?.snapshots().find((bot) => bot.id === attackerId)?.team
    const victimTeam = victimId === this.localId ? this.local.state.team : this.offlineBots?.snapshots().find((bot) => bot.id === victimId)?.team
    if (!attackerTeam || !victimTeam || attackerTeam === victimTeam) return
    if (attackerTeam === 1) this.round.attackScore += 1
    if (attackerTeam === 2) this.round.defendScore += 1
    if (this.round.attackScore >= TEAM_DEATHMATCH_LIMIT || this.round.defendScore >= TEAM_DEATHMATCH_LIMIT) {
      this.matchEnd = {
        winner: this.round.attackScore >= TEAM_DEATHMATCH_LIMIT ? 1 : 2,
        attackScore: this.round.attackScore,
        defendScore: this.round.defendScore,
      }
      this.round.phase = 4
    }
  }

  /** 购买/退款请求。 */
  buyItem(itemId: number): void {
    if (this.offlineDemolition) {
      this.offlineBuy(itemId)
      return
    }
    this.connection?.sendBuy(itemId)
  }

  /** Select a primary weapon in the backpack. 联网/爆破模式走购买契约。 */
  selectPrimaryWeapon(weaponId: number): void {
    if (this.online || this.offlineDemolition) {
      const itemId = weaponId === 1 ? 2 : weaponId === 3 ? 3 : weaponId === 4 ? 4 : weaponId === 6 ? 8 : weaponId === 7 ? 9 : weaponId === 8 ? 10 : 0
      if (itemId !== 0) this.buyItem(itemId)
      return
    }
    this.local.setPrimaryWeapon(weaponId)
  }

  /** 离线爆破：本地权威购买/退款（与服务器经济规则一致）。 */
  private offlineBuy(itemId: number): void {
    if (this.round.phase !== 1 || this.local.state.health <= 0) return
    const item = SHOP_ITEMS.find((entry) => entry.id === itemId)
    if (!item) return

    const spawn = this.local.state.team === 1 ? SPAWN : OFFLINE_DEFEND_SPAWN
    const dx = this.local.state.position.x - spawn.x
    const dz = this.local.state.position.z - spawn.z
    if (dx * dx + dz * dz > OFFLINE_BUY_ZONE_RADIUS * OFFLINE_BUY_ZONE_RADIUS) return

    if (item.weaponId !== undefined) {
      if (this.offlineWeaponRefund === itemId && this.local.primaryWeaponId === item.weaponId) {
        this.local.resetPrimaryWeapon()
        this.offlineWeaponRefund = null
        this.grantOfflineMoney(item.cost)
        return
      }
      if (this.money < item.cost) return
      this.money -= item.cost
      this.local.setPrimaryWeapon(item.weaponId)
      this.offlineWeaponRefund = itemId
      return
    }

    if (item.id === 1) {
      if (this.armor > 0 || this.money < item.cost) return
      this.money -= item.cost
      this.armor = 100
      return
    }

    const slot = item.id === 5 ? 'smoke' : item.id === 6 ? 'flash' : item.id === 7 ? 'he' : null
    if (!slot) return
    if (this.grenades[slot] >= OFFLINE_MAX_GRENADES_PER_TYPE || this.money < item.cost) return
    this.money -= item.cost
    this.grenades[slot] += 1
  }

  private grantOfflineMoney(amount: number): void {
    this.money = Math.min(OFFLINE_MAX_MONEY, this.money + amount)
  }

  get primaryWeaponId(): number {
    return this.local.primaryWeaponId
  }

  /** 引擎每帧消费的客户端效果事件。 */
  drainEffects(): MatchEffect[] {
    const out = this.pendingEffects
    this.pendingEffects = []
    return out
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
    sprinting: s.sprinting,
    health: s.health,
    weaponId: s.weaponId,
    ammo: s.ammo,
    reloading: s.reloading,
    team: s.team,
  }
}

function angleDelta(a: number, b: number): number {
  let delta = (b - a) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

function normalizeDeg(value: number): number {
  let v = value
  while (v > 180) v -= 360
  while (v < -180) v += 360
  return v
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
