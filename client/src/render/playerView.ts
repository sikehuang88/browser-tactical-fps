// 第一人称视角：摄像机跟随本地预测状态，附带简易武器视图与枪口曳光（M0 视觉反馈）。

import * as THREE from 'three'
import type { LocalPlayerState } from '../prediction/localPlayer'

const EYE_STAND = 1.6
const EYE_CROUCH = 1.2

export class PlayerView {
  private readonly camera: THREE.PerspectiveCamera
  private readonly scene: THREE.Scene
  private readonly weapon: THREE.Group
  private readonly tracers: { mesh: THREE.Mesh; life: number }[] = []
  private lastShots = 0

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.camera = camera
    this.scene = scene
    this.weapon = buildWeaponModel()
    scene.add(this.weapon)
  }

  update(state: LocalPlayerState, nowMs: number): void {
    const eye = state.crouching ? EYE_CROUCH : EYE_STAND
    this.camera.position.set(state.position.x, state.position.y + eye, state.position.z)
    // 约定：pitch 为正朝上（与服务器命中射线 forward_dir 一致）
    this.camera.rotation.set(
      THREE.MathUtils.degToRad(state.pitch),
      THREE.MathUtils.degToRad(state.yaw),
      0,
    )

    // 武器视图跟随摄像机并轻微摆动
    this.weapon.position.copy(this.camera.position)
    this.weapon.quaternion.copy(this.camera.quaternion)
    const bob = state.moveSpeed > 0.1 ? Math.sin(nowMs * 0.008) * 0.012 : 0
    this.weapon.translateX(0.19 + bob)
    this.weapon.translateY(-0.17 + Math.abs(Math.cos(nowMs * 0.008)) * 0.012)

    // 开火时生成曳光（shotsFired 为累计计数，增量触发）
    const shots = state.shotsFired
    if (shots > this.lastShots) {
      for (let i = 0; i < shots - this.lastShots; i++) this.spawnTracer()
    }
    this.lastShots = shots

    // 曳光衰减
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]
      t.life -= 16.7
      const mat = t.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, t.life / 120)
      if (t.life <= 0) {
        this.scene.remove(t.mesh)
        t.mesh.geometry.dispose()
        mat.dispose()
        this.tracers.splice(i, 1)
      }
    }
  }

  private spawnTracer(): void {
    const geo = new THREE.CylinderGeometry(0.015, 0.015, 10, 6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 })
    const mesh = new THREE.Mesh(geo, mat)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    mesh.position.copy(this.camera.position).addScaledVector(dir, 5)
    mesh.quaternion.copy(this.camera.quaternion)
    this.scene.add(mesh)
    this.tracers.push({ mesh, life: 120 })
  }
}

function buildWeaponModel(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0x262a33, metalness: 0.5, roughness: 0.55 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.5), mat)
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.45), mat)
  barrel.position.z = -0.46
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), mat)
  mag.position.set(0, -0.13, 0.04)
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.22), mat)
  stock.position.z = 0.34
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), mat)
  sight.position.set(0, 0.09, -0.08)
  g.add(body, barrel, mag, stock, sight)
  return g
}
