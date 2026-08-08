// 投掷物视觉层（WEAPON-005 客户端表现）：飞行模拟、烟雾云、闪光覆盖层。
// 服务器为权威：本类仅按 GrenadeSpawn/Explode 事件做视觉插值与效果。

import * as THREE from 'three'
import type { GrenadeSpawnMsg, GrenadeExplodeMsg } from '../core/net/codec'
import type { Vec3 } from '../core/types'
import { ARENA_BOUNDS, WALLS, type Aabb } from '../game/map'
import {
  createGameplayModel,
  disposeGameplayModel,
  loadGameplayModel,
} from './gameplayAssets'

const GRAVITY = 9.81
const GROUND_Y = 0.12
const RESTITUTION = 0.35
const HORIZ_DAMP = 0.7
const GRENADE_RADIUS = 0.12

const GRENADE_COLORS: Record<number, number> = {
  1: 0x9aa3ad, // 烟雾 灰
  2: 0xffd166, // 闪光 黄
  3: 0x4ade80, // 高爆 绿
}

interface FlyingGrenade {
  id: number
  kind: number
  pos: Vec3
  vel: Vec3
  mesh: THREE.Group
}

interface SmokeCloud {
  mesh: THREE.Mesh
  bornAtMs: number
  lifeMs: number
}

export class GrenadeView {
  private flying: FlyingGrenade[] = []
  private smokes: SmokeCloud[] = []
  private flashStrength = 0
  private flashAtMs = 0
  private flashEl: HTMLDivElement | null = null

  constructor(private readonly scene: THREE.Scene) {
    void loadGameplayModel('grenade').catch((error) => {
      console.warn('[grenade] Failed to preload model', error)
    })
  }

  spawn(msg: GrenadeSpawnMsg): void {
    const mesh = new THREE.Group()
    mesh.position.set(msg.pos.x, msg.pos.y, msg.pos.z)
    this.scene.add(mesh)
    const flying = { id: msg.id, kind: msg.kind, pos: { ...msg.pos }, vel: { ...msg.vel }, mesh }
    this.flying.push(flying)

    void createGameplayModel('grenade')
      .then((model) => {
        if (!this.flying.includes(flying)) {
          disposeGameplayModel(model)
          return
        }
        model.scale.setScalar(0.24)
        tintGrenade(model, msg.kind)
        mesh.add(model)
      })
      .catch((error) => console.warn('[grenade] Failed to load model', error))
  }

  explode(msg: GrenadeExplodeMsg): void {
    // Server entity IDs make simultaneous same-type grenades unambiguous.
    this.flying = this.flying.filter((g) => {
      if (g.id === msg.id) {
        this.scene.remove(g.mesh)
        disposeGameplayModel(g.mesh)
        return false
      }
      return true
    })

    if (msg.kind === 1) {
      // 烟雾云
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xcfd6dd,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      )
      mesh.position.set(msg.pos.x, 1.4, msg.pos.z)
      this.scene.add(mesh)
      this.smokes.push({ mesh, bornAtMs: performance.now(), lifeMs: 15000 })
    } else if (msg.kind === 2) {
      // 闪光爆点小光晕（致盲由 FLASH 消息触发覆盖层）
      this.burst(msg.pos, 0xffd166)
    } else if (msg.kind === 3) {
      // 爆炸火球
      this.burst(msg.pos, 0xff9a3c)
    }
  }

  /** FLASH 消息：设置致盲强度（覆盖层淡出）。 */
  setFlash(strength: number): void {
    this.flashStrength = Math.max(this.flashStrength, strength)
    this.flashAtMs = performance.now()
  }

  /** 当前闪光覆盖层透明度（0..1）。 */
  flashOpacity(nowMs: number): number {
    if (this.flashStrength <= 0) return 0
    const elapsed = nowMs - this.flashAtMs
    const dur = 1800
    if (elapsed >= dur) {
      this.flashStrength = 0
      return 0
    }
    const fall = 1 - elapsed / dur
    return (this.flashStrength / 100) * (0.25 + 0.75 * fall)
  }

  update(dt: number): void {
    // 飞行手雷
    for (const g of this.flying) {
      g.vel.y -= GRAVITY * dt
      g.pos.x += g.vel.x * dt
      g.pos.y += g.vel.y * dt
      g.pos.z += g.vel.z * dt
      resolveWalls(g, WALLS)
      if (g.pos.y <= GROUND_Y) {
        g.pos.y = GROUND_Y
        if (g.vel.y < 0) g.vel.y = -g.vel.y * RESTITUTION
        g.vel.x *= HORIZ_DAMP
        g.vel.z *= HORIZ_DAMP
      }
      resolveBounds(g)
      g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z)
      g.mesh.rotation.x += dt * (4 + Math.abs(g.vel.z) * 0.15)
      g.mesh.rotation.z += dt * (3 + Math.abs(g.vel.x) * 0.15)
    }

    // 烟雾淡出
    const now = performance.now()
    this.smokes = this.smokes.filter((s) => {
      const age = now - s.bornAtMs
      if (age >= s.lifeMs) {
        this.scene.remove(s.mesh)
        s.mesh.geometry.dispose()
        ;(s.mesh.material as THREE.Material).dispose()
        return false
      }
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = age > s.lifeMs - 2000 ? 0.4 * ((s.lifeMs - age) / 2000) : 0.4
      return true
    })
  }

  /** 更新闪光覆盖层 DOM（透明度跟随 opacity 淡出）。 */
  syncFlashOverlay(nowMs: number): void {
    const opacity = this.flashOpacity(nowMs)
    if (opacity <= 0.01) {
      if (this.flashEl) {
        this.flashEl.remove()
        this.flashEl = null
      }
      return
    }
    if (!this.flashEl) {
      this.flashEl = document.createElement('div')
      this.flashEl.style.position = 'fixed'
      this.flashEl.style.inset = '0'
      this.flashEl.style.background = '#ffffff'
      this.flashEl.style.pointerEvents = 'none'
      this.flashEl.style.zIndex = '45'
      document.body.appendChild(this.flashEl)
    }
    this.flashEl.style.opacity = String(opacity)
  }

  dispose(): void {
    for (const g of this.flying) {
      this.scene.remove(g.mesh)
      disposeGameplayModel(g.mesh)
    }
    this.flying = []
    for (const s of this.smokes) {
      this.scene.remove(s.mesh)
      s.mesh.geometry.dispose()
    }
    this.smokes = []
    this.flashEl?.remove()
    this.flashEl = null
  }

  private burst(pos: Vec3, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 12, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    )
    mesh.position.set(pos.x, pos.y, pos.z)
    this.scene.add(mesh)
    const start = performance.now()
    const life = 400
    const tick = () => {
      const age = performance.now() - start
      if (age >= life) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        return
      }
      const f = age / life
      mesh.scale.setScalar(1 + f * 4)
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f)
      requestAnimationFrame(tick)
    }
    tick()
  }
}

function tintGrenade(model: THREE.Object3D, kind: number): void {
  const tint = new THREE.Color(GRENADE_COLORS[kind] ?? 0xffffff)
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.lerp(tint, 0.16)
      }
    }
  })
}

function resolveWalls(g: FlyingGrenade, walls: Aabb[]): void {
  for (const wall of walls) {
    if (!pointInAabb(g.pos, wall)) continue
    const center = {
      x: (wall.min.x + wall.max.x) * 0.5,
      y: (wall.min.y + wall.max.y) * 0.5,
      z: (wall.min.z + wall.max.z) * 0.5,
    }
    const dx = Math.abs(g.pos.x - center.x)
    const dy = Math.abs(g.pos.y - center.y)
    const dz = Math.abs(g.pos.z - center.z)
    if (dx >= dy && dx >= dz) {
      g.pos.x = g.pos.x < center.x ? wall.min.x - GRENADE_RADIUS : wall.max.x + GRENADE_RADIUS
      g.vel.x = -g.vel.x * RESTITUTION
    } else if (dy >= dx && dy >= dz) {
      g.pos.y = g.pos.y < center.y ? wall.min.y - GRENADE_RADIUS : wall.max.y + GRENADE_RADIUS
      g.vel.y = -g.vel.y * RESTITUTION
    } else {
      g.pos.z = g.pos.z < center.z ? wall.min.z - GRENADE_RADIUS : wall.max.z + GRENADE_RADIUS
      g.vel.z = -g.vel.z * RESTITUTION
    }
  }
}

function resolveBounds(g: FlyingGrenade): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    if (g.pos[axis] < ARENA_BOUNDS.min[axis]) {
      g.pos[axis] = ARENA_BOUNDS.min[axis]
      g.vel[axis] = Math.abs(g.vel[axis]) * RESTITUTION
    } else if (g.pos[axis] > ARENA_BOUNDS.max[axis]) {
      g.pos[axis] = ARENA_BOUNDS.max[axis]
      g.vel[axis] = -Math.abs(g.vel[axis]) * RESTITUTION
    }
  }
}

function pointInAabb(pos: Vec3, wall: Aabb): boolean {
  return pos.x > wall.min.x && pos.x < wall.max.x
    && pos.y > wall.min.y && pos.y < wall.max.y
    && pos.z > wall.min.z && pos.z < wall.max.z
}
