// 投掷物视觉层（WEAPON-005 客户端表现）：飞行模拟、烟雾云、闪光覆盖层。
// 服务器为权威：本类仅按 GrenadeSpawn/Explode 事件做视觉插值与效果。

import * as THREE from 'three'
import type { GrenadeSpawnMsg, GrenadeExplodeMsg } from '../core/net/codec'
import type { Vec3 } from '../core/types'

const GRAVITY = 9.81
const GROUND_Y = 0.12
const RESTITUTION = 0.35

const GRENADE_COLORS: Record<number, number> = {
  1: 0x9aa3ad, // 烟雾 灰
  2: 0xffd166, // 闪光 黄
  3: 0x4ade80, // 高爆 绿
}

interface FlyingGrenade {
  kind: number
  pos: Vec3
  vel: Vec3
  mesh: THREE.Mesh
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

  constructor(private readonly scene: THREE.Scene) {}

  spawn(msg: GrenadeSpawnMsg): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshBasicMaterial({ color: GRENADE_COLORS[msg.kind] ?? 0xffffff }),
    )
    mesh.position.set(msg.pos.x, msg.pos.y, msg.pos.z)
    this.scene.add(mesh)
    this.flying.push({ kind: msg.kind, pos: { ...msg.pos }, vel: { ...msg.vel }, mesh })
  }

  explode(msg: GrenadeExplodeMsg): void {
    // 移除该位置附近的同类手雷
    this.flying = this.flying.filter((g) => {
      const d = Math.hypot(g.pos.x - msg.pos.x, g.pos.y - msg.pos.y, g.pos.z - msg.pos.z)
      if (g.kind === msg.kind && d < 3.0) {
        this.scene.remove(g.mesh)
        g.mesh.geometry.dispose()
        ;(g.mesh.material as THREE.Material).dispose()
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
      if (g.pos.y <= GROUND_Y) {
        g.pos.y = GROUND_Y
        if (g.vel.y < 0) g.vel.y = -g.vel.y * RESTITUTION
        g.vel.x *= 0.7
        g.vel.z *= 0.7
      }
      g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z)
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
      g.mesh.geometry.dispose()
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
