import * as THREE from 'three'
import type { Vec3 } from '../core/types'

const GROUND_TEXTURE_URL = '/assets/ground/stone-bricks.png'
const GROUND_SIZE = 96
const TILE_SIZE = 24

/** Infinite visual ground made from a repeatable image texture; collision stays in game/map.ts. */
export class GroundTileSystem {
  private readonly root = new THREE.Group()
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private readonly texture: THREE.Texture
  private centerX = Number.NaN
  private centerZ = Number.NaN
  private disposed = false

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'infinite-texture-ground'
    this.texture = new THREE.TextureLoader().load(GROUND_TEXTURE_URL)
    this.texture.wrapS = THREE.RepeatWrapping
    this.texture.wrapT = THREE.RepeatWrapping
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.repeat.set(GROUND_SIZE / TILE_SIZE, GROUND_SIZE / TILE_SIZE)
    this.texture.anisotropy = 8

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({
        map: this.texture,
        color: 0xd2d5d6,
        roughness: 0.88,
        metalness: 0,
      }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = 0.006
    this.ground.receiveShadow = true
    this.root.add(this.ground)
    scene.add(this.root)
  }

  update(playerPosition: Vec3): void {
    if (this.disposed) return
    const centerX = Math.floor(playerPosition.x / TILE_SIZE)
    const centerZ = Math.floor(playerPosition.z / TILE_SIZE)
    if (centerX === this.centerX && centerZ === this.centerZ) return
    this.centerX = centerX
    this.centerZ = centerZ
    this.ground.position.x = centerX * TILE_SIZE
    this.ground.position.z = centerZ * TILE_SIZE
  }

  dispose(): void {
    this.disposed = true
    this.scene.remove(this.root)
    this.ground.geometry.dispose()
    this.ground.material.dispose()
    this.texture.dispose()
  }
}
