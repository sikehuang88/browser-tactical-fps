// 灰盒测试地图（M0）。碰撞数据来自 game/map.ts 单一来源，渲染层只读。

import * as THREE from 'three'
import { BOMB_SITES, BOUNDS_WALLS, WALLS, ARENA_BOUNDS } from '../game/map'
import type { Aabb } from '../game/map'
import { GroundTileSystem } from './groundTiles'

export function buildGrayBoxScene(scene: THREE.Scene): GroundTileSystem {
  // Ground is provided by GroundTileSystem using the tileable stone-brick image.
  const size = ARENA_BOUNDS.max.x - ARENA_BOUNDS.min.x

  // 边界墙
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.9 })
  for (const aabb of BOUNDS_WALLS) {
    scene.add(boxFromAabb(aabb, wallMat))
  }

  // Desert-town blockout: sun-baked plaster, sandstone and darker wood accents.
  const coverMat = new THREE.MeshStandardMaterial({ color: 0xb58a62, roughness: 0.9 })
  for (const aabb of WALLS) {
    scene.add(boxFromAabb(aabb, coverMat))
  }

  // Three bomb-site markers: A long, B short, C mid courtyard.
  const siteColors = { A: 0xd95f3b, B: 0x3e91bd, C: 0xd3a23e } as const
  for (const site of BOMB_SITES) {
    const color = siteColors[site.id]
    const markerMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 })
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 32), markerMat)
    marker.position.set(site.position.x, 0.06, site.position.z)
    scene.add(marker)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.65, 1.75, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(site.position.x, 0.075, site.position.z)
    scene.add(ring)
  }

  // Three-lane desert-town flow: long, short, and mid courtyard.
  const centerZone = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.035, 34),
    new THREE.MeshStandardMaterial({ color: 0xa77c55, roughness: 0.98 }),
  )
  centerZone.position.set(0, 0.02, 0)
  centerZone.receiveShadow = true
  scene.add(centerZone)

  const laneLineMat = new THREE.MeshBasicMaterial({ color: 0x6b4933, transparent: true, opacity: 0.55 })
  for (const x of [-13, 13]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 34), laneLineMat)
    line.position.set(x, 0.045, 0)
    scene.add(line)
  }

  const spawnPadMat = new THREE.MeshStandardMaterial({ color: 0x896343, emissive: 0x2b160b, roughness: 0.78 })
  for (const z of [-25, 25]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 2.5), spawnPadMat)
    pad.position.set(0, 0.04, z)
    pad.receiveShadow = true
    scene.add(pad)
  }

  // 辅助网格
  const grid = new THREE.GridHelper(size, 24, 0x4a5468, 0x2a3140)
  grid.position.y = 0.01
  scene.add(grid)

  // 灯光
  scene.background = new THREE.Color(0xd8b17c)
  const hemi = new THREE.HemisphereLight(0xffe0af, 0x5b3824, 1.0)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xffffff, 1.4)
  dir.position.set(-18, 42, 14)
  dir.castShadow = true
  dir.shadow.mapSize.set(1024, 1024)
  dir.shadow.camera.left = -48
  dir.shadow.camera.right = 48
  dir.shadow.camera.top = 48
  dir.shadow.camera.bottom = -48
  dir.shadow.camera.far = 120
  scene.add(dir)

  return new GroundTileSystem(scene)
}

function boxFromAabb(aabb: Aabb, mat: THREE.Material): THREE.Mesh {
  const sx = aabb.max.x - aabb.min.x
  const sy = aabb.max.y - aabb.min.y
  const sz = aabb.max.z - aabb.min.z
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
  mesh.position.set((aabb.min.x + aabb.max.x) / 2, (aabb.min.y + aabb.max.y) / 2, (aabb.min.z + aabb.max.z) / 2)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
