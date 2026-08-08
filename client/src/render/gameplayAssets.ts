import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

export type GameplayModelId = 'rifle' | 'sniper' | 'pistol' | 'knife' | 'grenade' | 'pinkM4' | 'laserCannon'

const MODEL_URLS: Record<GameplayModelId, string> = {
  rifle: '/assets/weapons/assault-rifle.glb',
  sniper: '/assets/weapons/barrett.glb',
  pistol: '/assets/weapons/pistol.glb',
  knife: '/assets/weapons/tactical-knife.glb',
  grenade: '/assets/throwables/grenade.glb',
  pinkM4: '/assets/weapons/m4-pink.glb',
  laserCannon: '/assets/weapons/laser-cannon.glb',
}

const draco = new DRACOLoader()
draco.setDecoderPath('/draco/gltf/')
draco.preload()

const loader = new GLTFLoader()
loader.setDRACOLoader(draco)

const modelCache = new Map<GameplayModelId, Promise<THREE.Group>>()

/** Load and normalize a static gameplay model so its longest axis is one world unit. */
export function loadGameplayModel(id: GameplayModelId): Promise<THREE.Group> {
  const cached = modelCache.get(id)
  if (cached) return cached

  const promise = loader.loadAsync(MODEL_URLS[id])
    .then(({ scene }) => normalizeModel(scene))
    .catch((error) => {
      modelCache.delete(id)
      throw error
    })
  modelCache.set(id, promise)
  return promise
}

/** Clone materials per instance while sharing immutable geometry and textures. */
export async function createGameplayModel(id: GameplayModelId): Promise<THREE.Group> {
  const source = await loadGameplayModel(id)
  const instance = source.clone(true)
  instance.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone()
    object.castShadow = true
    object.receiveShadow = true
  })
  return instance
}

export function disposeGameplayModel(instance: THREE.Object3D): void {
  instance.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
}

export function gameplayModelForWeapon(weaponId: number): GameplayModelId {
  if (weaponId === 6) return 'pinkM4'
  if (weaponId === 7) return 'laserCannon'
  if (weaponId === 4) return 'sniper'
  if (weaponId === 2) return 'pistol'
  if (weaponId === 5) return 'knife'
  return 'rifle'
}

export function gameplayModelRotationY(id: GameplayModelId): number {
  if (id === 'pinkM4') return Math.PI / 2
  if (id === 'laserCannon') return Math.PI
  return -Math.PI / 2
}

function normalizeModel(scene: THREE.Group): THREE.Group {
  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(scene)
  const size = bounds.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z, 0.001)
  const center = bounds.getCenter(new THREE.Vector3())
  const scale = 1 / longest

  // Normalize every asset to the same weapon pivot: centered on X/Z with the
  // lowest point at Y=0. GLB exporters frequently place the origin at an end
  // of the weapon, which otherwise makes first-person offsets inconsistent.
  scene.scale.setScalar(scale)
  scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
  scene.updateMatrixWorld(true)

  const normalized = new THREE.Group()
  normalized.add(scene)
  return normalized
}
