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
      seen.add(e.id)
      let group = this.meshes.get(e.id)
      if (!group) {
        group = createPlayerMesh(e.id)
        this.scene.add(group)
        this.meshes.set(e.id, group)
      }
      const h = e.crouching ? 1.35 : 1.8
      group.scale.set(1, h / 1.8, 1)
      group.position.set(e.position.x, e.position.y, e.position.z)
      group.rotation.y = THREE.MathUtils.degToRad(e.yaw)
    }

    // 移除已消失的实体
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

function createPlayerMesh(id: number): THREE.Group {
  const g = new THREE.Group()
  const color = new THREE.Color().setHSL(((id * 0.137) % 1), 0.6, 0.52)
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
  return g
}
