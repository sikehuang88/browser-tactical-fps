// 本地玩家：客户端预测 + 后续服务器校正（Reconciliation）。
// 输入帧的视角增量与服务器逐帧叠加方式一致，保证可收敛。

import type { RawInput, Vec3 } from '../core/types'
import { BUTTON } from '../core/input'
import type { MapCollision } from '../game/map'
import { getWeapon } from '../game/weapons/registry'

export interface LocalPlayerState {
  id: number
  position: Vec3 // 脚底位置（米）
  velocity: Vec3
  yaw: number // 度
  pitch: number // 度
  onGround: boolean
  crouching: boolean
  sprinting: boolean
  health: number
  weaponId: number
  ammo: number
  reloading: boolean
  reloadEndAtMs: number
  moveSpeed: number
  /** 累计开火次数（渲染层据此播放曳光/枪口效果）。 */
  shotsFired: number
  /** 激光炮蓄力进度 0..1。 */
  charge: number
  aiming: boolean
  team: number // 1=攻击方 2=防守方（由服务器快照同步）
}

const GRAVITY = 18
const STAND_HEIGHT = 1.8
const CROUCH_HEIGHT = 1.35
const HALF_W = 0.32
const WALK_SPEED = 3.8
const SPRINT_SPEED = 5.4
const CROUCH_SPEED = 1.6
const GROUND_ACCEL = 30
const AIR_ACCEL = 8
const FRICTION = 22
const JUMP_VEL = 5.4
const MAX_PITCH_DEG = 89
const DEFAULT_WEAPON_ID = 2
const SECONDARY_WEAPON_ID = 2
const KNIFE_WEAPON_ID = 5
const LASER_WEAPON_ID = 7
const LASER_CHARGE_MAX_MS = 800
const LASER_CHARGE_MIN_MS = 150

export class LocalPlayer {
  state: LocalPlayerState
  private firearmWeaponId: number
  private secondaryWeaponId = SECONDARY_WEAPON_ID
  private readonly ammoByWeaponId = new Map<number, number>()
  private previousPosition: Vec3
  private previousYaw = 0
  private previousPitch = 0

  constructor(
    id: number,
    spawn: Vec3,
    private readonly collision: MapCollision,
    initialPrimaryWeaponId = DEFAULT_WEAPON_ID,
  ) {
    this.firearmWeaponId = getWeapon(initialPrimaryWeaponId)?.id ?? DEFAULT_WEAPON_ID
    this.state = this.makeState(id, spawn, this.firearmWeaponId)
    this.ammoByWeaponId.set(this.firearmWeaponId, this.state.ammo)
    this.ammoByWeaponId.set(SECONDARY_WEAPON_ID, getWeapon(SECONDARY_WEAPON_ID)?.ammo ?? 12)
    this.previousPosition = { ...this.state.position }
  }

  reset(id: number, spawn: Vec3): void {
    this.state = this.makeState(id, spawn)
    this.nextFireAtMs = 0
    this.lastButtons = 0
    this.recoilShotIndex = 0
    this.firearmWeaponId = DEFAULT_WEAPON_ID
    this.secondaryWeaponId = SECONDARY_WEAPON_ID
    this.ammoByWeaponId.clear()
    this.ammoByWeaponId.set(DEFAULT_WEAPON_ID, getWeapon(DEFAULT_WEAPON_ID)?.ammo ?? 12)
    this.ammoByWeaponId.set(SECONDARY_WEAPON_ID, getWeapon(SECONDARY_WEAPON_ID)?.ammo ?? 12)
    this.previousPosition = { ...this.state.position }
    this.previousYaw = this.state.yaw
    this.previousPitch = this.state.pitch
  }

  private makeState(id: number, spawn: Vec3, weaponId = DEFAULT_WEAPON_ID): LocalPlayerState {
    const weapon = getWeapon(weaponId) ?? getWeapon(DEFAULT_WEAPON_ID)!
    return {
      id,
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      onGround: true,
      crouching: false,
      sprinting: false,
      health: 100,
      weaponId: weapon.id,
      ammo: weapon.ammo,
      reloading: false,
      reloadEndAtMs: 0,
      moveSpeed: 0,
      shotsFired: 0,
      charge: 0,
      aiming: false,
      team: 0,
    }
  }

  step(dt: number, nowMs: number, raw: RawInput): void {
    const s = this.state
    this.previousPosition = { ...s.position }
    this.previousYaw = s.yaw
    this.previousPitch = s.pitch
    const pressed = raw.buttons & ~this.lastButtons
    this.lastButtons = raw.buttons
    s.yaw = normalizeDeg(s.yaw + raw.yawDelta / 100)
    s.pitch = clamp(s.pitch + raw.pitchDelta / 100, -MAX_PITCH_DEG, MAX_PITCH_DEG)
    s.aiming = raw.aiming && getWeapon(s.weaponId)?.id === 4

    if ((pressed & BUTTON.EQUIP_KNIFE) !== 0) {
      this.switchWeapon(KNIFE_WEAPON_ID)
    } else if ((pressed & BUTTON.EQUIP_SECONDARY) !== 0) {
      this.switchWeapon(this.secondaryWeaponId)
    } else if ((pressed & BUTTON.EQUIP_FIREARM) !== 0) {
      this.switchWeapon(this.firearmWeaponId)
    }

    s.crouching = (raw.buttons & BUTTON.CROUCH) !== 0
    const height = s.crouching ? CROUCH_HEIGHT : STAND_HEIGHT

    let forward = raw.forwardAxis / 127
    let strafe = raw.strafeAxis / 127
    const inputLength = Math.hypot(forward, strafe)
    if (inputLength > 1) {
      forward /= inputLength
      strafe /= inputLength
    }
    const sprint = (raw.buttons & BUTTON.SPRINT) !== 0 && forward > 0.1 && !s.crouching
    const maxSpeed = s.crouching ? CROUCH_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED
    const yawRad = (s.yaw * Math.PI) / 180

    // 相对视角的目标速度（世界空间）：与第一人称相机一致，yaw=0 → -Z，右 = +X
    const wantX = (-forward * Math.sin(yawRad) + strafe * Math.cos(yawRad)) * maxSpeed
    const wantZ = (-forward * Math.cos(yawRad) - strafe * Math.sin(yawRad)) * maxSpeed
    const hasMove = forward * forward + strafe * strafe > 0.01
    const accel = hasMove ? (s.onGround ? GROUND_ACCEL : AIR_ACCEL) : FRICTION
    const [nextVelocityX, nextVelocityZ] = moveToward2D(
      s.velocity.x,
      s.velocity.z,
      wantX,
      wantZ,
      accel * dt,
    )
    s.velocity.x = nextVelocityX
    s.velocity.z = nextVelocityZ
    s.moveSpeed = Math.hypot(s.velocity.x, s.velocity.z)
    s.sprinting = sprint && s.moveSpeed > WALK_SPEED * 0.85

    if ((pressed & BUTTON.JUMP) !== 0 && s.onGround) {
      s.velocity.y = JUMP_VEL
      s.onGround = false
    }
    s.velocity.y -= GRAVITY * dt

    const res = this.collision.step(s.position, s.velocity, dt, HALF_W, height)
    s.position = res.pos
    s.velocity = res.vel
    s.onGround = res.onGround

    this.updateWeapon(dt, nowMs, raw, pressed)
  }

  renderState(alpha: number): LocalPlayerState {
    const t = clamp(alpha, 0, 1)
    const s = this.state
    return {
      ...s,
      position: {
        x: this.previousPosition.x + (s.position.x - this.previousPosition.x) * t,
        y: this.previousPosition.y + (s.position.y - this.previousPosition.y) * t,
        z: this.previousPosition.z + (s.position.z - this.previousPosition.z) * t,
      },
      yaw: lerpAngle(this.previousYaw, s.yaw, t),
      pitch: this.previousPitch + (s.pitch - this.previousPitch) * t,
    }
  }

  correctPosition(position: Vec3): void {
    this.state.position = { ...position }
    this.state.velocity = { x: 0, y: 0, z: 0 }
    this.previousPosition = { ...position }
    this.previousYaw = this.state.yaw
    this.previousPitch = this.state.pitch
  }

  /** 服务器硬校正视角（回合重生/传送/位置大幅纠偏时使用）。 */
  correctView(yaw: number, pitch: number): void {
    this.state.yaw = normalizeDeg(yaw)
    this.state.pitch = clamp(pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG)
    this.previousYaw = this.state.yaw
    this.previousPitch = this.state.pitch
  }

  private updateWeapon(dt: number, nowMs: number, raw: RawInput, pressed: number): void {
    void dt
    const s = this.state
    const weapon = getWeapon(s.weaponId) ?? getWeapon(DEFAULT_WEAPON_ID)!
    const melee = weapon.category === 'melee'
    if (!melee && s.reloading && nowMs >= s.reloadEndAtMs) {
      s.ammo = weapon.ammo
      s.reloading = false
      this.recoilShotIndex = 0
    }
    // 激光炮：按住蓄力、松手释放（伤害由服务器按蓄力比例结算）。
    if (weapon.id === LASER_WEAPON_ID) {
      const holding = (raw.buttons & BUTTON.ATTACK) !== 0
      if (holding && s.ammo === 0 && !s.reloading) {
        s.reloading = true
        s.reloadEndAtMs = nowMs + weapon.reloadMs
      }
      if (holding && !s.reloading && s.ammo > 0) {
        s.charge = Math.min(1, s.charge + dt / (LASER_CHARGE_MAX_MS / 1000))
      } else {
        if (
          s.charge >= LASER_CHARGE_MIN_MS / LASER_CHARGE_MAX_MS &&
          !s.reloading &&
          s.ammo > 0 &&
          nowMs >= this.nextFireAtMs
        ) {
          s.ammo -= 1
          const kick = recoilForWeapon(weapon.id, this.recoilShotIndex)
          s.pitch = clamp(s.pitch + kick.pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG)
          s.yaw = normalizeDeg(s.yaw + kick.yaw)
          this.recoilShotIndex += 1
          s.shotsFired += 1
          this.nextFireAtMs = nowMs + 60_000 / weapon.fireRatePerMin
        }
        s.charge = 0
      }
      return
    }
    if (!melee && (raw.buttons & BUTTON.RELOAD) !== 0 && !s.reloading && s.ammo < weapon.ammo) {
      s.reloading = true
      s.reloadEndAtMs = nowMs + weapon.reloadMs
    }
    const attack = weapon.automatic
      ? (raw.buttons & BUTTON.ATTACK) !== 0
      : (pressed & BUTTON.ATTACK) !== 0
    // Keep offline prediction in lockstep with the server's empty-magazine behavior.
    if (!melee && attack && !s.reloading && s.ammo === 0) {
      s.reloading = true
      s.reloadEndAtMs = nowMs + weapon.reloadMs
    }
    if (attack && !s.reloading && (melee || s.ammo > 0)) {
      if (nowMs >= this.nextFireAtMs) {
        this.nextFireAtMs = nowMs + 60_000 / weapon.fireRatePerMin
        if (!melee) s.ammo -= 1
        const kick = recoilForWeapon(weapon.id, this.recoilShotIndex)
        s.pitch = clamp(s.pitch + kick.pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG)
        s.yaw = normalizeDeg(s.yaw + kick.yaw)
        this.recoilShotIndex += 1
        s.shotsFired += 1
      }
    }
  }

  private nextFireAtMs = 0
  private lastButtons = 0
  private recoilShotIndex = 0

  syncWeapon(weaponId: number, ammo: number, reloading: boolean): void {
    const s = this.state
    const resolvedId = getWeapon(weaponId)?.id ?? DEFAULT_WEAPON_ID
    const weaponChanged = resolvedId !== s.weaponId
    if (weaponChanged || reloading) s.charge = 0
    s.weaponId = resolvedId
    if (resolvedId !== KNIFE_WEAPON_ID) {
      if (weaponChanged) {
        if (resolvedId === SECONDARY_WEAPON_ID) {
          this.secondaryWeaponId = resolvedId
        } else {
          this.firearmWeaponId = resolvedId
        }
        this.ammoByWeaponId.set(resolvedId, ammo)
        s.ammo = ammo
      } else if (reloading || ammo < s.ammo || (s.reloading && !reloading)) {
        // 只接受服务器“已消耗弹药/换弹完成”的方向，避免延迟快照把预测值往回拨。
        this.ammoByWeaponId.set(resolvedId, ammo)
        s.ammo = ammo
      }
      const magSize = getWeapon(resolvedId)?.ammo ?? s.ammo
      // 服务器确认换弹开始；若服务器快照仍显示旧状态且本地弹药未回满，则保留本地换弹。
      s.reloading = reloading || (s.reloading && ammo < magSize)
      if (!s.reloading) s.reloadEndAtMs = 0
    } else {
      s.reloading = false
      if (!reloading) s.reloadEndAtMs = 0
    }
  }

  /** Offline loadout selection. Online loadouts remain server-authoritative. */
  setPrimaryWeapon(weaponId: number): boolean {
    const spec = getWeapon(weaponId)
    if (!spec || !['rifle', 'smg', 'sniper', 'shotgun'].includes(spec.category)) return false
    this.firearmWeaponId = spec.id
    this.ammoByWeaponId.set(spec.id, spec.ammo)
    this.switchWeapon(spec.id)
    return true
  }

  /** 退款/回合重置后回到初始手枪。 */
  resetPrimaryWeapon(): void {
    const pistol = getWeapon(DEFAULT_WEAPON_ID)!
    this.firearmWeaponId = pistol.id
    this.ammoByWeaponId.set(pistol.id, pistol.ammo)
    this.switchWeapon(pistol.id)
  }

  get primaryWeaponId(): number {
    return this.firearmWeaponId
  }

  private switchWeapon(weaponId: number): void {
    const s = this.state
    const resolved = getWeapon(weaponId)?.id ?? DEFAULT_WEAPON_ID
    if (s.weaponId !== KNIFE_WEAPON_ID) {
      this.ammoByWeaponId.set(s.weaponId, s.ammo)
    }
    s.weaponId = resolved
    s.reloading = false
    s.reloadEndAtMs = 0
    s.charge = 0
    this.nextFireAtMs = 0
    this.recoilShotIndex = 0
    s.aiming = false
    if (resolved !== KNIFE_WEAPON_ID) {
      const spec = getWeapon(resolved) ?? getWeapon(DEFAULT_WEAPON_ID)!
      s.ammo = this.ammoByWeaponId.get(resolved) ?? spec.ammo
    }
  }
}

interface RecoilKick {
  pitch: number
  yaw: number
}

function recoilForWeapon(weaponId: number, shotIndex: number): RecoilKick {
  const n = shotIndex % 6
  switch (weaponId) {
    case 1:
      return { pitch: 1.15 + n * 0.1, yaw: [0.2, -0.28, 0.32, -0.2, 0.26, -0.15][n] }
    case 3:
      return { pitch: 0.72 + n * 0.07, yaw: [0.38, -0.48, 0.54, -0.42, 0.5, -0.34][n] }
    case 4:
      return { pitch: 3.4, yaw: n % 2 === 0 ? 0.16 : -0.16 }
    case 2:
      return { pitch: 1.05, yaw: n % 2 === 0 ? 0.2 : -0.2 }
    case 6:
      return { pitch: 1.25 + n * 0.11, yaw: [0.22, -0.3, 0.34, -0.23, 0.28, -0.18][n] }
    case 7:
      return { pitch: 2.25, yaw: n % 2 === 0 ? 0.24 : -0.24 }
    default:
      return { pitch: 0, yaw: 0 }
  }
}

function moveToward2D(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  maxDelta: number,
): [number, number] {
  const dx = targetX - currentX
  const dz = targetZ - currentZ
  const distance = Math.hypot(dx, dz)
  if (distance <= maxDelta || distance === 0) return [targetX, targetZ]
  const scale = maxDelta / distance
  return [currentX + dx * scale, currentZ + dz * scale]
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return a + delta * t
}

function normalizeDeg(v: number): number {
  while (v > 180) v -= 360
  while (v < -180) v += 360
  return v
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
