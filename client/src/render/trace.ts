import * as THREE from 'three'
import { ARENA_BOUNDS, WALLS, type Aabb } from '../game/map'

export function traceDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): number {
  let distance = maxDistance
  for (const wall of WALLS) {
    const hit = rayAabbDistance(origin, direction, wall)
    if (hit !== null && hit > 0.02) distance = Math.min(distance, hit)
  }
  const boundaryHit = rayAabbDistance(origin, direction, ARENA_BOUNDS)
  if (boundaryHit !== null && boundaryHit > 0.02) distance = Math.min(distance, boundaryHit)
  return distance
}

export function rayAabbDistance(origin: THREE.Vector3, direction: THREE.Vector3, box: Aabb): number | null {
  let near = -Infinity
  let far = Infinity
  for (const axis of ['x', 'y', 'z'] as const) {
    const directionAxis = direction[axis]
    const originAxis = origin[axis]
    if (Math.abs(directionAxis) < 1e-8) {
      if (originAxis < box.min[axis] || originAxis > box.max[axis]) return null
      continue
    }
    let t1 = (box.min[axis] - originAxis) / directionAxis
    let t2 = (box.max[axis] - originAxis) / directionAxis
    if (t1 > t2) [t1, t2] = [t2, t1]
    near = Math.max(near, t1)
    far = Math.min(far, t2)
    if (near > far) return null
  }
  if (far < 0) return null
  return near > 0 ? near : far
}
