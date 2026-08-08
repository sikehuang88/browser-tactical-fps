import type { EntitySnapshot, Vec3 } from '../core/types'
import type { LocalPlayerState } from '../prediction/localPlayer'
import { ARENA_BOUNDS, WALLS, type MapCollision } from './map'
import { getWeapon } from './weapons/registry'

export interface OfflineBot extends EntitySnapshot {
  isBot: true
  displayName: string
  nextDecisionAt: number
  nextFireAt: number
  state: 'patrol' | 'engage' | 'dead'
  targetId: number
  patrolIndex: number
  respawnAtMs: number
  path: Vec3[]
  pathTarget: string
  pathAtMs: number
  stuckSinceMs: number
  lastPos: Vec3
}

export interface OfflineShotResult {
  victimId: number
  damage: number
  killed: boolean
}

export interface OfflineCombatEvent {
  attackerId: number
  victimId: number
  weaponId: number
  damage: number
  killed: boolean
}

/** Four friendly bots plus five enemy bots; the local player completes team 1. */
const BOT_SPAWNS: Array<{ position: Vec3; team: number }> = [
  { position: { x: -13, y: 0, z: 12 }, team: 1 },
  { position: { x: -8, y: 0, z: 8 }, team: 1 },
  { position: { x: 10, y: 0, z: 14 }, team: 1 },
  { position: { x: 14, y: 0, z: 4 }, team: 1 },
  { position: { x: -13, y: 0, z: -10 }, team: 2 },
  { position: { x: -8, y: 0, z: -10 }, team: 2 },
  { position: { x: 9, y: 0, z: -10 }, team: 2 },
  { position: { x: 13, y: 0, z: -10 }, team: 2 },
  { position: { x: 0, y: 0, z: -12 }, team: 2 },
]

/** 爆破模式：进攻方（4 名队友）出生点。 */
const DEMOLITION_ATTACK_SPAWNS: Vec3[] = [
  { x: -13, y: 0, z: 12 },
  { x: -8, y: 0, z: 8 },
  { x: 10, y: 0, z: 14 },
  { x: 14, y: 0, z: 4 },
]

/** 爆破模式：防守方（5 名敌人）出生点。 */
const DEMOLITION_DEFEND_SPAWNS: Vec3[] = [
  { x: -13, y: 0, z: -10 },
  { x: -8, y: 0, z: -10 },
  { x: 9, y: 0, z: -10 },
  { x: 13, y: 0, z: -10 },
  { x: 0, y: 0, z: -12 },
]

const PATROL_POINTS: Vec3[] = [
  { x: -8, y: 0, z: 5 },
  { x: 8, y: 0, z: 5 },
  { x: 8, y: 0, z: -8 },
  { x: -8, y: 0, z: -8 },
]

export class OfflineBotController {
  private readonly bots: OfflineBot[]
  private readonly combatEvents: OfflineCombatEvent[] = []
  private readonly allowRespawn: boolean

  constructor(
    private readonly collision: MapCollision,
    options: { allowRespawn?: boolean } = {},
  ) {
    this.allowRespawn = options.allowRespawn ?? true
    this.bots = BOT_SPAWNS.map((spawn, index) => ({
      id: 100 + index,
      position: { ...spawn.position },
      yaw: spawn.team === 2 ? 180 : 0,
      pitch: 0,
      moving: false,
      sprinting: false,
      crouching: false,
      health: 100,
      weaponId: spawn.team === 2 && index % 2 === 0 ? 1 : 2,
      ammo: 30,
      reloading: false,
      team: spawn.team,
      isBot: true,
      displayName: `BOT-${String(index + 1).padStart(2, '0')}`,
      nextDecisionAt: 0,
      nextFireAt: 0,
      state: 'patrol',
      targetId: 0,
      patrolIndex: index % PATROL_POINTS.length,
      respawnAtMs: 0,
      path: [],
      pathTarget: '',
      pathAtMs: 0,
      stuckSinceMs: 0,
      lastPos: { ...spawn.position },
    }))
  }

  reset(): void {
    this.bots.forEach((bot, index) => {
      const spawn = BOT_SPAWNS[index]
      bot.position = { ...spawn.position }
      bot.health = 100
      bot.state = 'patrol'
      bot.nextDecisionAt = 0
      bot.nextFireAt = 0
      bot.moving = false
      bot.targetId = 0
      bot.respawnAtMs = 0
      bot.path = []
      bot.pathTarget = ''
      bot.pathAtMs = 0
      bot.stuckSinceMs = 0
      bot.lastPos = { ...spawn.position }
    })
  }

  /** 爆破模式回合重置：前 5 回合玩家为进攻方，后 5 回合换边。 */
  resetForRound(firstHalf: boolean): void {
    this.bots.forEach((bot, index) => {
      const attackSide = index < DEMOLITION_ATTACK_SPAWNS.length
      const team = firstHalf ? (attackSide ? 1 : 2) : (attackSide ? 2 : 1)
      const spawn = attackSide
        ? DEMOLITION_ATTACK_SPAWNS[index]
        : DEMOLITION_DEFEND_SPAWNS[index - DEMOLITION_ATTACK_SPAWNS.length]
      bot.team = team
      bot.position = { ...spawn }
      bot.yaw = team === 2 ? 180 : 0
      bot.pitch = 0
      bot.health = 100
      bot.state = 'patrol'
      bot.targetId = 0
      bot.nextDecisionAt = 0
      bot.nextFireAt = 0
      bot.moving = false
      bot.sprinting = false
      bot.crouching = false
      bot.reloading = false
      bot.respawnAtMs = 0
      bot.path = []
      bot.pathTarget = ''
      bot.pathAtMs = 0
      bot.stuckSinceMs = 0
      bot.lastPos = { ...spawn }
    })
  }

  update(dt: number, nowMs: number, local: LocalPlayerState): void {
    const targets: Array<LocalPlayerState | OfflineBot> = [local, ...this.bots]
    for (const bot of this.bots) {
      if (bot.health <= 0) {
        bot.state = 'dead'
        bot.moving = false
        if (this.allowRespawn) {
          if (bot.respawnAtMs === 0) bot.respawnAtMs = nowMs + 1800
          if (nowMs >= bot.respawnAtMs) this.respawnBot(bot, nowMs)
        }
        continue
      }
      const enemy = selectBotTarget(bot, local, targets)
      const distance = enemy ? distance3(bot.position, enemy.position) : Infinity
      const wasEngaging = bot.state === 'engage'
      if (enemy && distance < 36) {
        bot.state = 'engage'
        bot.targetId = enemy.id
        if (!wasEngaging) {
          bot.nextFireAt = nowMs + 520 + (bot.id % 4) * 90
        }
      } else if (nowMs >= bot.nextDecisionAt) {
        bot.state = 'patrol'
        bot.targetId = 0
        bot.nextDecisionAt = nowMs + 900 + (bot.id % 5) * 180
      }

      const target = bot.state === 'engage' && enemy ? enemy.position : PATROL_POINTS[bot.patrolIndex]
      const targetKey = `${target.x.toFixed(1)},${target.z.toFixed(1)}`
      if (bot.pathTarget !== targetKey || nowMs - bot.pathAtMs > 700) {
        bot.path = findPath(bot.position, target) ?? []
        bot.pathTarget = targetKey
        bot.pathAtMs = nowMs
      }
      const waypoint = bot.path.length > 0 ? bot.path[0] : target
      const dx = waypoint.x - bot.position.x
      const dz = waypoint.z - bot.position.z
      const distance2D = Math.hypot(dx, dz)
      if (distance2D > 0.45) {
        const speed = bot.state === 'engage' ? 1.55 : 1.1
        const targetYaw = (Math.atan2(dx, -dz) * 180) / Math.PI
        bot.yaw = turnToward(bot.yaw, targetYaw, 220 * dt)
        const moveYaw = (bot.yaw * Math.PI) / 180
        const result = this.collision.step(bot.position, { x: Math.sin(moveYaw) * speed, y: 0, z: -Math.cos(moveYaw) * speed }, dt, 0.32, 1.8)
        bot.position = result.pos
        bot.moving = Math.hypot(result.vel.x, result.vel.z) > 0.1
      } else {
        if (bot.path.length > 0) bot.path.shift()
        bot.moving = false
        if (bot.state === 'patrol' && bot.path.length === 0) bot.patrolIndex = (bot.patrolIndex + 1) % PATROL_POINTS.length
      }

      // 卡墙检测：连续 0.5s 没有位移就清空路径重新寻路。
      const moved = Math.hypot(bot.position.x - bot.lastPos.x, bot.position.z - bot.lastPos.z)
      bot.lastPos = { ...bot.position }
      if (moved < 0.01) {
        if (bot.stuckSinceMs === 0) bot.stuckSinceMs = nowMs
        else if (nowMs - bot.stuckSinceMs > 500) {
          bot.path = []
          bot.pathTarget = ''
          bot.stuckSinceMs = 0
        }
      } else {
        bot.stuckSinceMs = 0
      }

      const weapon = getWeapon(bot.weaponId)
      // Keep rifles effective across the graybox arena while still requiring LOS and aim.
      const fireDistance = Math.min(34, (weapon?.maxRangeM ?? 40) * 0.85)
      if (enemy && distance < fireDistance && nowMs >= bot.nextFireAt && canBotSeeTarget(bot, enemy) && botAimsAtTarget(bot, enemy)) {
        bot.nextFireAt = nowMs + (bot.weaponId === 1 ? 650 : 950)
        const damage = bot.weaponId === 1 ? 7 : 5
        const previousHealth = enemy.health
        enemy.health = Math.max(0, enemy.health - damage)
        if (enemy.health <= 0 && 'respawnAtMs' in enemy) enemy.respawnAtMs = nowMs + 1800
        this.combatEvents.push({ attackerId: bot.id, victimId: enemy.id, weaponId: bot.weaponId, damage: previousHealth - enemy.health, killed: enemy.health <= 0 })
      }
    }
  }

  drainCombatEvents(): OfflineCombatEvent[] {
    const events = [...this.combatEvents]
    this.combatEvents.length = 0
    return events
  }

  resolveLocalShot(local: LocalPlayerState, previousShots: number): OfflineShotResult | null {
    if (local.shotsFired <= previousShots || local.health <= 0) return null
    const weapon = getWeapon(local.weaponId)
    if (!weapon) return null
    for (const bot of this.bots) {
      if (bot.health <= 0 || bot.team === local.team) continue
      const fromY = local.position.y + (local.crouching ? 1.2 : 1.6)
      const toY = bot.position.y + 1.2
      const dx = bot.position.x - local.position.x
      const dy = toY - fromY
      const dz = bot.position.z - local.position.z
      const distance = Math.hypot(dx, dy, dz)
      if (distance > weapon.maxRangeM) continue
      const yawRad = (local.yaw * Math.PI) / 180
      const pitchRad = (local.pitch * Math.PI) / 180
      const forwardX = -Math.sin(yawRad) * Math.cos(pitchRad)
      const forwardY = Math.sin(pitchRad)
      const forwardZ = -Math.cos(yawRad) * Math.cos(pitchRad)
      const dot = (dx * forwardX + dy * forwardY + dz * forwardZ) / Math.max(distance, 0.001)
      if (dot < 0.985) continue
      if (!lineOfSight(local.position, bot.position)) continue
      const previousHealth = bot.health
      bot.health = Math.max(0, bot.health - weapon.damage)
      return { victimId: bot.id, damage: previousHealth - bot.health, killed: bot.health <= 0 }
    }
    return null
  }

  snapshots(): OfflineBot[] {
    return this.bots.map((bot) => ({ ...bot, position: { ...bot.position } }))
  }

  private respawnBot(bot: OfflineBot, nowMs: number): void {
    const spawn = BOT_SPAWNS[bot.id - 100]
    bot.position = { ...spawn.position }
    bot.health = 100
    bot.state = 'patrol'
    bot.targetId = 0
    bot.nextDecisionAt = nowMs + 350
    bot.nextFireAt = nowMs + 900
    bot.moving = false
    bot.respawnAtMs = 0
    bot.path = []
    bot.pathTarget = ''
    bot.pathAtMs = 0
    bot.stuckSinceMs = 0
    bot.lastPos = { ...spawn.position }
  }
}

function selectBotTarget(bot: OfflineBot, local: LocalPlayerState, targets: Array<LocalPlayerState | OfflineBot>): (LocalPlayerState | OfflineBot) | null {
  // Enemy bots explicitly prioritize the human player so the offline match reads as 5v5.
  if (bot.team === 2 && local.health > 0 && distance3(bot.position, local.position) <= 36) {
    return local
  }
  let closest: LocalPlayerState | OfflineBot | null = null
  let closestDistance = Infinity
  for (const target of targets) {
    if (target.id === bot.id || target.health <= 0 || target.team === bot.team) continue
    const distance = distance3(bot.position, target.position)
    if (distance < closestDistance) {
      closest = target
      closestDistance = distance
    }
  }
  return closest
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function canBotSeeTarget(bot: OfflineBot, target: LocalPlayerState | OfflineBot): boolean {
  return lineOfSight(bot.position, target.position)
}

function lineOfSight(from: Vec3, to: Vec3): boolean {
  const start = { x: from.x, y: from.y + 1.45, z: from.z }
  const end = { x: to.x, y: to.y + 1.2, z: to.z }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const length = Math.hypot(dx, dy, dz)
  if (length < 0.001) return true
  const step = 0.22
  for (let distance = step; distance < length; distance += step) {
    const t = distance / length
    const x = start.x + dx * t
    const y = start.y + dy * t
    const z = start.z + dz * t
    if (WALLS.some((wall) => x > wall.min.x && x < wall.max.x && z > wall.min.z && z < wall.max.z && y > wall.min.y && y < wall.max.y)) {
      return false
    }
  }
  return true
}

// ---------- 网格寻路（防穿墙） ----------

const NAV_CELL = 0.5
const GRID_MIN = -28
const GRID_MAX = 28
const GRID_SIZE = Math.round((GRID_MAX - GRID_MIN) / NAV_CELL) // 112
const BOT_HALF_W = 0.32
const BOT_HEIGHT = 1.8
const NAV_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

function findPath(start: Vec3, goal: Vec3): Vec3[] | null {
  const [sx, sz] = worldToCell(start)
  const [gx, gz] = nearestWalkableCell(goal)
  const startIdx = cellIndex(sx, sz)
  const goalIdx = cellIndex(gx, gz)
  if (startIdx === goalIdx) return []
  if (!cellWalkable(sx, sz) || !cellWalkable(gx, gz)) return null

  const open: number[] = [startIdx]
  const cameFrom = new Map<number, number>()
  const gScore = new Map<number, number>([[startIdx, 0]])
  const fScore = new Map<number, number>([[startIdx, heuristic(sx, sz, gx, gz)]])
  const closed = new Set<number>()

  while (open.length > 0) {
    let best = 0
    for (let i = 1; i < open.length; i += 1) {
      if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[best]) ?? Infinity)) best = i
    }
    const current = open.splice(best, 1)[0]
    if (current === goalIdx) {
      const path: Vec3[] = []
      let node = current
      while (node !== startIdx) {
        path.push(cellToWorld(node % GRID_SIZE, Math.floor(node / GRID_SIZE)))
        const parent = cameFrom.get(node)
        if (parent === undefined) break
        node = parent
      }
      path.reverse()
      return path
    }
    closed.add(current)
    const cix = current % GRID_SIZE
    const ciz = Math.floor(current / GRID_SIZE)
    for (const [dix, diz] of NAV_NEIGHBORS) {
      const nix = cix + dix
      const niz = ciz + diz
      if (nix < 0 || nix >= GRID_SIZE || niz < 0 || niz >= GRID_SIZE) continue
      // 对角线移动要求两侧都可行走，避免切角穿墙。
      if (dix !== 0 && diz !== 0) {
        if (!cellWalkable(cix + dix, ciz) || !cellWalkable(cix, ciz + diz)) continue
      }
      const next = cellIndex(nix, niz)
      if (closed.has(next) || !cellWalkable(nix, niz)) continue
      const cost = dix !== 0 && diz !== 0 ? 1.414 : 1
      const tentative = (gScore.get(current) ?? Infinity) + cost
      if (tentative < (gScore.get(next) ?? Infinity)) {
        cameFrom.set(next, current)
        gScore.set(next, tentative)
        fScore.set(next, tentative + heuristic(nix, niz, gx, gz))
        if (!open.includes(next)) open.push(next)
      }
    }
  }
  return null
}

function nearestWalkableCell(goal: Vec3): [number, number] {
  const [gx, gz] = worldToCell(goal)
  if (cellWalkable(gx, gz)) return [gx, gz]
  for (let radius = 1; radius <= 8; radius += 1) {
    for (let dix = -radius; dix <= radius; dix += 1) {
      for (let diz = -radius; diz <= radius; diz += 1) {
        if (Math.max(Math.abs(dix), Math.abs(diz)) !== radius) continue
        const nx = gx + dix
        const nz = gz + diz
        if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE && cellWalkable(nx, nz)) return [nx, nz]
      }
    }
  }
  return [gx, gz]
}

function worldToCell(v: Vec3): [number, number] {
  const ix = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((v.x - GRID_MIN) / NAV_CELL)))
  const iz = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((v.z - GRID_MIN) / NAV_CELL)))
  return [ix, iz]
}

function cellToWorld(ix: number, iz: number): Vec3 {
  return { x: GRID_MIN + (ix + 0.5) * NAV_CELL, y: 0, z: GRID_MIN + (iz + 0.5) * NAV_CELL }
}

function cellIndex(ix: number, iz: number): number {
  return iz * GRID_SIZE + ix
}

function cellWalkable(ix: number, iz: number): boolean {
  return !isBlockedAt(cellToWorld(ix, iz))
}

function isBlockedAt(pos: Vec3): boolean {
  if (
    pos.x + BOT_HALF_W > ARENA_BOUNDS.max.x ||
    pos.x - BOT_HALF_W < ARENA_BOUNDS.min.x ||
    pos.z + BOT_HALF_W > ARENA_BOUNDS.max.z ||
    pos.z - BOT_HALF_W < ARENA_BOUNDS.min.z
  ) {
    return true
  }
  return WALLS.some(
    (wall) =>
      pos.x + BOT_HALF_W > wall.min.x &&
      pos.x - BOT_HALF_W < wall.max.x &&
      BOT_HEIGHT > wall.min.y &&
      0 < wall.max.y &&
      pos.z + BOT_HALF_W > wall.min.z &&
      pos.z - BOT_HALF_W < wall.max.z,
  )
}

function heuristic(ix: number, iz: number, gx: number, gz: number): number {
  return Math.hypot(ix - gx, iz - gz)
}

function turnToward(current: number, target: number, maxDelta: number): number {
  let delta = (target - current) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const next = current + Math.max(-maxDelta, Math.min(maxDelta, delta))
  return ((next + 540) % 360) - 180
}

function botAimsAtTarget(bot: OfflineBot, target: LocalPlayerState | OfflineBot): boolean {
  const dx = target.position.x - bot.position.x
  const dz = target.position.z - bot.position.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.001) return true
  const forwardX = -Math.sin((bot.yaw * Math.PI) / 180)
  const forwardZ = -Math.cos((bot.yaw * Math.PI) / 180)
  const dot = (dx * forwardX + dz * forwardZ) / distance
  return dot >= Math.cos((14 * Math.PI) / 180)
}
