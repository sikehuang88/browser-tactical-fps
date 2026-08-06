// 本地玩家：客户端预测 + 后续服务器校正（Reconciliation）。
// 输入帧的视角增量与服务器逐帧叠加方式一致，保证可收敛。

import type { RawInput, Vec3 } from '../core/types'
import { BUTTON } from '../core/input'
import type { MapCollision } from '../game/map'

export interface LocalPlayerState {
  id: number
  position: Vec3 // 脚底位置（米）
  velocity: Vec3
  yaw: number // 度
  pitch: number // 度
  onGround: boolean
  crouching: boolean
  health: number
  weaponId: number
  ammo: number
  reloading: boolean
  reloadEndAtMs: number
  moveSpeed: number
  /** 累计开火次数（渲染层据此播放曳光/枪口效果）。 */
  shotsFired: number
}

const GRAVITY = 9.81
const STAND_HEIGHT = 1.8
const CROUCH_HEIGHT = 1.35
const HALF_W = 0.32
const WALK_SPEED = 3.8
const SPRINT_SPEED = 5.4
const CROUCH_SPEED = 1.6
const ACCEL = 40
const FRICTION = 24
const JUMP_VEL = 4.6
const MAX_PITCH_DEG = 89
const FIRE_INTERVAL_MS = 100 // 600 rpm 步枪
const RELOAD_MS = 2200
const MAG_SIZE = 30

export class LocalPlayer {
  state: LocalPlayerState

  constructor(
    id: number,
    spawn: Vec3,
    private readonly collision: MapCollision,
  ) {
    this.state = this.makeState(id, spawn)
  }

  reset(id: number, spawn: Vec3): void {
    this.state = this.makeState(id, spawn)
  }

  private makeState(id: number, spawn: Vec3): LocalPlayerState {
    return {
      id,
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      onGround: true,
      crouching: false,
      health: 100,
      weaponId: 1,
      ammo: MAG_SIZE,
      reloading: false,
      reloadEndAtMs: 0,
      moveSpeed: 0,
      shotsFired: 0,
    }
  }

  step(dt: number, nowMs: number, raw: RawInput): void {
    const s = this.state
    s.yaw = normalizeDeg(s.yaw + raw.yawDelta / 100)
    s.pitch = clamp(s.pitch + raw.pitchDelta / 100, -MAX_PITCH_DEG, MAX_PITCH_DEG)

    s.crouching = (raw.buttons & BUTTON.CROUCH) !== 0
    const height = s.crouching ? CROUCH_HEIGHT : STAND_HEIGHT

    const forward = raw.forwardAxis / 127
    const strafe = raw.strafeAxis / 127
    const sprint = (raw.buttons & BUTTON.SPRINT) !== 0 && !s.crouching
    const maxSpeed = s.crouching ? CROUCH_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED
    const yawRad = (s.yaw * Math.PI) / 180

    // 相对视角的目标速度（世界空间）
    const wantX = (forward * Math.sin(yawRad) + strafe * Math.cos(yawRad)) * maxSpeed
    const wantZ = (forward * Math.cos(yawRad) - strafe * Math.sin(yawRad)) * maxSpeed
    const hasMove = forward * forward + strafe * strafe > 0.01
    const accel = hasMove ? ACCEL : FRICTION
    s.velocity.x = approach(s.velocity.x, wantX, accel * dt)
    s.velocity.z = approach(s.velocity.z, wantZ, accel * dt)
    s.moveSpeed = Math.hypot(s.velocity.x, s.velocity.z)

    if ((raw.buttons & BUTTON.JUMP) !== 0 && s.onGround) {
      s.velocity.y = JUMP_VEL
      s.onGround = false
    }
    s.velocity.y -= GRAVITY * dt

    const res = this.collision.step(s.position, s.velocity, dt, HALF_W, height)
    s.position = res.pos
    s.velocity = res.vel
    s.onGround = res.onGround

    this.updateWeapon(dt, nowMs, raw)
  }

  private updateWeapon(dt: number, nowMs: number, raw: RawInput): void {
    void dt
    const s = this.state
    if (s.reloading && nowMs >= s.reloadEndAtMs) {
      s.ammo = MAG_SIZE
      s.reloading = false
    }
    if ((raw.buttons & BUTTON.RELOAD) !== 0 && !s.reloading && s.ammo < MAG_SIZE) {
      s.reloading = true
      s.reloadEndAtMs = nowMs + RELOAD_MS
    }
    if ((raw.buttons & BUTTON.ATTACK) !== 0 && !s.reloading && s.ammo > 0) {
      if (nowMs >= this.nextFireAtMs) {
        this.nextFireAtMs = nowMs + FIRE_INTERVAL_MS
        s.ammo -= 1
        s.shotsFired += 1
      }
    }
  }

  private nextFireAtMs = 0
}

function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current
  if (Math.abs(d) <= maxDelta) return target
  return current + Math.sign(d) * maxDelta
}

function normalizeDeg(v: number): number {
  while (v > 180) v -= 360
  while (v < -180) v += 360
  return v
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
