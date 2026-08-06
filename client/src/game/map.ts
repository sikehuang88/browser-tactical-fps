// 灰盒测试地图：碰撞数据（AABB）单一来源。
// 客户端与服务器共用同一碰撞规格（服务器权威校验，M0 服务器实现移动时复用本数据格式）。

import type { Vec3 } from '../core/types'

export interface Aabb {
  min: Vec3
  max: Vec3
}

export const GROUND_Y = 0
export const SPAWN: Vec3 = { x: 0, y: GROUND_Y, z: 8 }

/** 竞技区边界（48m × 48m）。 */
export const ARENA_BOUNDS: Aabb = {
  min: { x: -24, y: -1, z: -24 },
  max: { x: 24, y: 8, z: 24 },
}

/** 边界墙（用于渲染）。 */
export const BOUNDS_WALLS: Aabb[] = [
  { min: { x: -24, y: 0, z: -24 }, max: { x: -23, y: 4, z: 24 } },
  { min: { x: 23, y: 0, z: -24 }, max: { x: 24, y: 4, z: 24 } },
  { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 4, z: -23 } },
  { min: { x: -24, y: 0, z: 23 }, max: { x: 24, y: 4, z: 24 } },
]

/** 内部掩体。 */
export const WALLS: Aabb[] = [
  { min: { x: -8, y: 0, z: -2 }, max: { x: -6, y: 2.4, z: 4 } },
  { min: { x: 6, y: 0, z: -6 }, max: { x: 9, y: 2.2, z: -4 } },
  { min: { x: -4, y: 0, z: 10 }, max: { x: -1, y: 3, z: 12 } },
  { min: { x: 3, y: 0, z: 4 }, max: { x: 5, y: 1.2, z: 7 } },
  { min: { x: -12, y: 0, z: -8 }, max: { x: -10, y: 4, z: -6 } },
  { min: { x: -2, y: 0, z: -12 }, max: { x: 1, y: 2, z: -9 } },
]

function overlaps(x: number, y: number, z: number, halfW: number, height: number, w: Aabb): boolean {
  return (
    x + halfW > w.min.x &&
    x - halfW < w.max.x &&
    y + height > w.min.y &&
    y < w.max.y &&
    z + halfW > w.min.z &&
    z - halfW < w.max.z
  )
}

/**
 * 轴分离的 AABB 碰撞：逐轴移动并解析，支持地面与墙体。
 * position.y 表示脚底高度。为 M0 服务器权威移动的参照实现（对应 MOVE-001）。
 */
export class MapCollision {
  constructor(
    private readonly walls: Aabb[],
    private readonly bounds: Aabb,
    private readonly groundY: number,
  ) {}

  step(
    pos: Vec3,
    vel: Vec3,
    dt: number,
    halfW: number,
    height: number,
  ): { pos: Vec3; vel: Vec3; onGround: boolean } {
    const out = { x: pos.x, y: pos.y, z: pos.z }
    let vx = vel.x
    let vy = vel.y
    let vz = vel.z
    let onGround = false

    // X 轴
    out.x += vx * dt
    for (const w of this.walls) {
      if (overlaps(out.x, out.y, out.z, halfW, height, w)) {
        out.x = vx > 0 ? w.min.x - halfW : w.max.x + halfW
        vx = 0
      }
    }
    out.x = clampAxis(out.x, this.bounds.min.x + halfW, this.bounds.max.x - halfW)

    // Z 轴
    out.z += vz * dt
    for (const w of this.walls) {
      if (overlaps(out.x, out.y, out.z, halfW, height, w)) {
        out.z = vz > 0 ? w.min.z - halfW : w.max.z + halfW
        vz = 0
      }
    }
    out.z = clampAxis(out.z, this.bounds.min.z + halfW, this.bounds.max.z - halfW)

    // Y 轴（地面）
    out.y += vy * dt
    if (out.y <= this.groundY) {
      out.y = this.groundY
      vy = 0
      onGround = true
    }

    return { pos: { x: out.x, y: out.y, z: out.z }, vel: { x: vx, y: vy, z: vz }, onGround }
  }

  ground(): number {
    return this.groundY
  }
}

export const DEFAULT_COLLISION = new MapCollision(WALLS, ARENA_BOUNDS, GROUND_Y)

function clampAxis(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
