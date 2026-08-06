// 灰盒测试地图（M0）。碰撞数据来自 game/map.ts 单一来源，渲染层只读。

import * as THREE from 'three'
import { BOUNDS_WALLS, WALLS, ARENA_BOUNDS } from '../game/map'
import type { Aabb } from '../game/map'

export function buildGrayBoxScene(scene: THREE.Scene): void {
  // 地面
  const size = ARENA_BOUNDS.max.x - ARENA_BOUNDS.min.x
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.95, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(0, 0, 0)
  scene.add(ground)

  // 边界墙
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.9 })
  for (const aabb of BOUNDS_WALLS) {
    scene.add(boxFromAabb(aabb, wallMat))
  }

  // 掩体（与碰撞体一一对应）
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x586274, roughness: 0.8 })
  for (const aabb of WALLS) {
    scene.add(boxFromAabb(aabb, coverMat))
  }

  // 目标点标记（M0 仅视觉占位，爆破逻辑后续）
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xff6b35, emissive: 0x662000 })
  for (const p of [{ x: -14, z: -14 }, { x: 14, z: 14 }]) {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 24), markerMat)
    marker.position.set(p.x, 0.06, p.z)
    scene.add(marker)
  }

  // 辅助网格
  const grid = new THREE.GridHelper(size, 24, 0x4a5468, 0x2a3140)
  grid.position.y = 0.01
  scene.add(grid)

  // 灯光
  const hemi = new THREE.HemisphereLight(0xffffff, 0x404854, 0.85)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xffffff, 1.4)
  dir.position.set(24, 40, 12)
  scene.add(dir)
}

function boxFromAabb(aabb: Aabb, mat: THREE.Material): THREE.Mesh {
  const sx = aabb.max.x - aabb.min.x
  const sy = aabb.max.y - aabb.min.y
  const sz = aabb.max.z - aabb.min.z
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
  mesh.position.set((aabb.min.x + aabb.max.x) / 2, (aabb.min.y + aabb.max.y) / 2, (aabb.min.z + aabb.max.z) / 2)
  return mesh
}
