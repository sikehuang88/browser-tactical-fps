import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type OperatorId = 'vanguard' | 'sentinel'
export type CharacterMotion = 'idle' | 'walk' | 'run' | 'showcase'

export interface CharacterAsset {
  id: OperatorId
  scene: THREE.Group
  clips: THREE.AnimationClip[]
  idleClip: THREE.AnimationClip
  walkClip: THREE.AnimationClip
  runClip: THREE.AnimationClip
  showcaseClip: THREE.AnimationClip
}

export interface CharacterInstance {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  currentAction: THREE.AnimationAction
  asset: CharacterAsset
}

const ASSET_URLS: Record<OperatorId, string> = {
  vanguard: '/assets/characters/operator-vanguard.glb',
  sentinel: '/assets/characters/operator-sentinel.glb',
}

const draco = new DRACOLoader()
draco.setDecoderPath('/draco/gltf/')
draco.preload()
const loader = new GLTFLoader()
loader.setDRACOLoader(draco)

const assetCache = new Map<OperatorId, Promise<CharacterAsset>>()

/** Load one rigged operator and normalize its floor height to the game world. */
export function loadOperatorAsset(id: OperatorId): Promise<CharacterAsset> {
  const cached = assetCache.get(id)
  if (cached) return cached

  const promise = loader
    .loadAsync(ASSET_URLS[id])
    .then((gltf) => prepareAsset(id, gltf))
    .catch((error) => {
      assetCache.delete(id)
      throw error
    })
  assetCache.set(id, promise)
  return promise
}

/** Create an independent skinned clone so every player gets its own mixer. */
export function createCharacterInstance(asset: CharacterAsset): CharacterInstance {
  const root = cloneSkeleton(asset.scene) as THREE.Group
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry = object.geometry.clone()
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material.clone())
    } else {
      object.material = object.material.clone()
    }
    object.castShadow = true
    object.receiveShadow = true
  })

  const mixer = new THREE.AnimationMixer(root)
  const actions = new Map<string, THREE.AnimationAction>()
  for (const clip of asset.clips) actions.set(clip.name, mixer.clipAction(clip))

  const instance: CharacterInstance = {
    root,
    mixer,
    actions,
    currentAction: actions.get(asset.idleClip.name)!,
    asset,
  }
  instance.currentAction.reset().play()
  return instance
}

export function setCharacterMotion(instance: CharacterInstance, motion: CharacterMotion): void {
  const clip = motion === 'run'
    ? instance.asset.runClip
    : motion === 'walk'
      ? instance.asset.walkClip
    : motion === 'showcase'
      ? instance.asset.showcaseClip
      : instance.asset.idleClip
  const next = instance.actions.get(clip.name)
  if (!next) return

  const playbackRate = motion === 'run' ? 1.08 : motion === 'walk' ? 1 : 1
  if (next === instance.currentAction) {
    next.setEffectiveTimeScale(playbackRate)
    return
  }

  next.reset().setEffectiveTimeScale(playbackRate).setEffectiveWeight(1)
  next.crossFadeFrom(instance.currentAction, 0.2, true).play()
  instance.currentAction = next
}

export function disposeCharacterInstance(instance: CharacterInstance): void {
  instance.mixer.stopAllAction()
  instance.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const material = object.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
}

function prepareAsset(id: OperatorId, gltf: GLTF): CharacterAsset {
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  const height = Math.max(0.1, bounds.max.y - bounds.min.y)
  root.scale.setScalar(1.8 / height)
  root.updateMatrixWorld(true)
  const normalizedBounds = new THREE.Box3().setFromObject(root)
  root.position.y -= normalizedBounds.min.y

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.castShadow = true
    object.receiveShadow = true
  })

  const fallback = new THREE.AnimationClip('__rest__', 1, [])
  const analyzed = gltf.animations.map((clip) => {
    const travel = rootTravel(clip)
    return {
      clip: stripRootMotion(clip),
      travel,
      speed: travel / Math.max(clip.duration, 0.001),
    }
  })
  const processed = analyzed.length > 0 ? analyzed : [{ clip: fallback, travel: 0, speed: 0 }]
  const idle = chooseIdleClip(processed)
  const locomotion = processed
    .filter((item) => item.travel > 0.25 && !isOneShotClip(item.clip.name))
    .sort((a, b) => a.speed - b.speed)
  const walk = locomotion[0] ?? idle
  const run = locomotion[locomotion.length - 1] ?? walk
  const clips = processed.map((item) => item.clip)
  return {
    id,
    scene: root,
    clips,
    idleClip: idle.clip,
    walkClip: walk.clip,
    runClip: run.clip,
    showcaseClip: idle.clip,
  }
}

function chooseIdleClip(items: Array<{ clip: THREE.AnimationClip; travel: number; speed: number }>): { clip: THREE.AnimationClip; travel: number; speed: number } {
  const named = items.find((item) => {
    const name = item.clip.name.toLowerCase()
    return /(idle|aim|stand|breath|rifle.?aim)/.test(name) && !isOneShotClip(name)
  })
  if (named) return named

  const safe = items.filter((item) => !isOneShotClip(item.clip.name))
  return (safe.length > 0 ? safe : items).reduce((best, item) => (item.travel < best.travel ? item : best))
}

function isOneShotClip(name: string): boolean {
  return /(jump|fire|shoot|reload|hit|reaction|death|die|grenade|toss|melee|attack|fall|land)/i.test(name)
}

function rootTravel(clip: THREE.AnimationClip): number {
  const track = clip.tracks.find((item) => item.name.endsWith('Hip.position'))
  if (!track || track.values.length < 3) return 0
  const values = track.values
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[i + axis])
      max[axis] = Math.max(max[axis], values[i + axis])
    }
  }
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
}

/** Remove baked Hip root travel because the authoritative physics moves the entity group. */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const output = clip.clone()
  const track = output.tracks.find((item) => item.name.endsWith('Hip.position'))
  if (!track || track.values.length < 3) return output

  const values = track.values as unknown as { length: number; [index: number]: number }
  const ranges = [0, 1, 2].map((axis) => {
    let min = Infinity
    let max = -Infinity
    for (let i = axis; i < values.length; i += 3) {
      min = Math.min(min, values[i])
      max = Math.max(max, values[i])
    }
    return max - min
  })
  const travelAxis = ranges.indexOf(Math.max(...ranges))
  const anchor = values[travelAxis]
  for (let i = travelAxis; i < values.length; i += 3) values[i] = anchor
  return output
}
