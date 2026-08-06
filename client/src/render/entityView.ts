// 远端玩家实体视图：为每个非本地实体维护简单胶囊/箱体网格，随快照插值结果更新。

import * as THREE from 'three'
import type { EntitySnapshot } from '../core/types'

export class EntityView {
  private readonly meshes = new Map<number, THREE.Group>()

  constructor(private readonly scene: THREE.Scene) {}

  update(entities: EntitySnapshot[], localId: number): void {
    const seen = new Set<number>()

    for (const e of entities) {
      if (e.id === localId) continue
      if (e.health <= 0) continue // 死亡实体不渲染（计分板仍保留）
      seen.add(e.id)
      let group = this.meshes.get(e.id)
      if (!group) {
        group = createPlayerMesh(e.team)
        this.scene.add(group)
        this.meshes.set(e.id, group)
      } else if (group.userData.team !== e.team) {
        // 换边后重着色
        recolorGroup(group, e.team)
        group.userData.team = e.team
      }
      const h = e.crouching ? 1.35 : 1.8
      group.scale.set(1, h / 1.8, 1)
      group.position.set(e.position.x, e.position.y, e.position.z)
      group.rotation.y = THREE.MathUtils.degToRad(e.yaw)
    }

    // 移除已消失或已死亡的实体
    for (const [id, group] of this.meshes) {
      if (seen.has(id)) continue
      this.disposeGroup(group)
      this.scene.remove(group)
      this.meshes.delete(id)
    }
  }

  clear(): void {
    for (const [, group] of this.meshes) {
      this.disposeGroup(group)
      this.scene.remove(group)
    }
    this.meshes.clear()
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
  }
}

const TEAM_COLORS = [
  0x8b949e, // 未分配
  0xff9a3c, // 攻击方（橙）
  0x4a8fff, // 防守方（蓝）
]

function teamColor(team: number): THREE.Color {
  const c = TEAM_COLORS[team] ?? TEAM_COLORS[0]
  return new THREE.Color(c)
}

function createPlayerMesh(team: number): THREE.Group {
  const g = new THREE.Group()
  const color = teamColor(team)
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  const headMat = new THREE.MeshStandardMaterial({
    color: color.clone().offsetHSL(0, 0, 0.12),
    roughness: 0.8,
  })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.2, 0.38), bodyMat)
  body.position.y = 0.6
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), headMat)
  head.position.y = 1.52
  g.add(body, head)
  g.userData.team = team
  return g
}

function recolorGroup(g: THREE.Group, team: number): void {
  const color = teamColor(team)
  g.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material.color.copy(color)
    }
  })
}
