// 灰盒测试地图：碰撞数据（AABB）单一来源。
// 客户端与服务器共用同一碰撞规格（服务器权威校验，M0 服务器实现移动时复用本数据格式）。

import type { Vec3 } from '../core/types'

export interface Aabb {
  min: Vec3
  max: Vec3
}

export const GROUND_Y = 0
export const SPAWN: Vec3 = { x: 0, y: GROUND_Y, z: 24 }

/** 竞技区边界（48m × 48m）。 */
export const ARENA_BOUNDS: Aabb = {
  min: { x: -28, y: -1, z: -28 },
  max: { x: 28, y: 10, z: 28 },
}

/** 边界墙（用于渲染）。 */
export const BOUNDS_WALLS: Aabb[] = [
  { min: { x: -28, y: 0, z: -28 }, max: { x: -27, y: 5, z: 28 } },
  { min: { x: 27, y: 0, z: -28 }, max: { x: 28, y: 5, z: 28 } },
  { min: { x: -28, y: 0, z: -28 }, max: { x: 28, y: 5, z: -27 } },
  { min: { x: -28, y: 0, z: 27 }, max: { x: 28, y: 5, z: 28 } },
]

/** 原创沙漠城镇爆破骨架：长道 A、短道 B、中路广场 C。 */
export const WALLS: Aabb[] = [
  // 长道外墙与 A 点房区，保留南北两端门洞。
  { min: { x: -24, y: 0, z: -22 }, max: { x: -19, y: 4.5, z: -5 } },
  { min: { x: -24, y: 0, z: 3 }, max: { x: -19, y: 4.5, z: 22 } },
  { min: { x: -19, y: 0, z: -22 }, max: { x: -8, y: 3.6, z: -20 } },
  { min: { x: -19, y: 0, z: -14 }, max: { x: -8, y: 3.6, z: -12 } },
  { min: { x: -19, y: 0, z: -6 }, max: { x: -8, y: 3.6, z: -4 } },
  // 短道外墙与 B 点房区。
  { min: { x: 19, y: 0, z: -22 }, max: { x: 24, y: 4.5, z: -5 } },
  { min: { x: 19, y: 0, z: 3 }, max: { x: 24, y: 4.5, z: 22 } },
  { min: { x: 8, y: 0, z: -22 }, max: { x: 19, y: 3.6, z: -20 } },
  { min: { x: 8, y: 0, z: -14 }, max: { x: 19, y: 3.6, z: -12 } },
  { min: { x: 8, y: 0, z: -6 }, max: { x: 19, y: 3.6, z: -4 } },
  // 中路 C 广场掩体与交叉火力。
  { min: { x: -5, y: 0, z: -8 }, max: { x: -1, y: 1.3, z: -2 } },
  { min: { x: 1, y: 0, z: 2 }, max: { x: 5, y: 1.3, z: 8 } },
  { min: { x: -12, y: 0, z: 9 }, max: { x: -5, y: 2.4, z: 12 } },
  { min: { x: 5, y: 0, z: 9 }, max: { x: 12, y: 2.4, z: 12 } },
  // 南北出生区掩体。
  { min: { x: -11, y: 0, z: 21 }, max: { x: -3, y: 1.4, z: 24 } },
  { min: { x: 3, y: 0, z: 21 }, max: { x: 11, y: 1.4, z: 24 } },
  { min: { x: -11, y: 0, z: -24 }, max: { x: -3, y: 1.4, z: -21 } },
  { min: { x: 3, y: 0, z: -24 }, max: { x: 11, y: 1.4, z: -21 } },
]

export const BOMB_SITES: Array<{ id: 'A' | 'B' | 'C'; position: Vec3 }> = [
  { id: 'A', position: { x: -14, y: 0, z: -10 } },
  { id: 'B', position: { x: 14, y: 0, z: -10 } },
  { id: 'C', position: { x: 0, y: 0, z: 0 } },
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
    const minX = this.bounds.min.x + halfW
    const maxX = this.bounds.max.x - halfW
    if (out.x < minX) {
      out.x = minX
      if (vx < 0) vx = 0
    } else if (out.x > maxX) {
      out.x = maxX
      if (vx > 0) vx = 0
    }

    // Z 轴
    out.z += vz * dt
    for (const w of this.walls) {
      if (overlaps(out.x, out.y, out.z, halfW, height, w)) {
        out.z = vz > 0 ? w.min.z - halfW : w.max.z + halfW
        vz = 0
      }
    }
    const minZ = this.bounds.min.z + halfW
    const maxZ = this.bounds.max.z - halfW
    if (out.z < minZ) {
      out.z = minZ
      if (vz < 0) vz = 0
    } else if (out.z > maxZ) {
      out.z = maxZ
      if (vz > 0) vz = 0
    }

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
