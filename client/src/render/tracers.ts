import * as THREE from 'three'

/** Unit cylinder along +Y, open-ended, radius 1, height 1. Shared, never disposed. */
const UNIT_BEAM = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
const LOCAL_UP = new THREE.Vector3(0, 1, 0)

export interface TracerSpawn {
  muzzle: THREE.Vector3
  impact: THREE.Vector3
  weaponId: number
  /** True when the shot came from the local player's own weapon. */
  local: boolean
}

export interface ActiveTracer {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>
  muzzle: THREE.Vector3
  direction: THREE.Vector3
  distance: number
  startedAtMs: number
  lifetimeMs: number
  local: boolean
}

export interface TracerStyle {
  radius(spawn: TracerSpawn): number
  lifetimeMs(spawn: TracerSpawn): number
  createMaterial(): THREE.Material
  onSpawn?(tracer: ActiveTracer, spawn: TracerSpawn): void
  onUpdate(tracer: ActiveTracer, t: number): void
}

export class TracerSystem {
  private readonly active: ActiveTracer[] = []
  private readonly pool: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>[] = []

  constructor(
    private readonly scene: THREE.Scene,
    private style: TracerStyle,
  ) {}

  setStyle(style: TracerStyle): void {
    this.style = style
    for (const mesh of this.pool) mesh.material.dispose()
    this.pool.length = 0
  }

  spawn(spawn: TracerSpawn, nowMs: number): void {
    const segment = spawn.impact.clone().sub(spawn.muzzle)
    const distance = segment.length()
    if (distance < 0.05) return

    const direction = segment.clone().divideScalar(distance)
    const mesh = this.pool.pop() ?? this.createMesh()
    mesh.visible = true
    mesh.quaternion.setFromUnitVectors(LOCAL_UP, direction)

    const tracer: ActiveTracer = {
      mesh,
      muzzle: spawn.muzzle.clone(),
      direction,
      distance,
      startedAtMs: nowMs,
      lifetimeMs: this.style.lifetimeMs(spawn),
      local: spawn.local,
    }

    const radius = this.style.radius(spawn)
    mesh.scale.set(radius, distance, radius)
    this.style.onSpawn?.(tracer, spawn)
    this.style.onUpdate(tracer, 0)

    this.scene.add(mesh)
    this.active.push(tracer)
  }

  update(nowMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const tracer = this.active[i]
      const t = (nowMs - tracer.startedAtMs) / tracer.lifetimeMs
      if (t >= 1) {
        this.recycle(tracer)
        this.active.splice(i, 1)
        continue
      }
      this.style.onUpdate(tracer, t)
    }
  }

  dispose(): void {
    for (const tracer of this.active) {
      this.scene.remove(tracer.mesh)
      tracer.mesh.material.dispose()
    }
    this.active.length = 0
    for (const mesh of this.pool) mesh.material.dispose()
    this.pool.length = 0
  }

  private createMesh(): THREE.Mesh<THREE.CylinderGeometry, THREE.Material> {
    const mesh = new THREE.Mesh(UNIT_BEAM, this.style.createMaterial())
    mesh.renderOrder = 3
    mesh.frustumCulled = false
    return mesh
  }

  private recycle(tracer: ActiveTracer): void {
    this.scene.remove(tracer.mesh)
    tracer.mesh.visible = false
    this.pool.push(tracer.mesh)
  }
}

export function layoutBeam(
  tracer: ActiveTracer,
  startDistance: number,
  length: number,
  radius: number,
): void {
  const { mesh, muzzle, direction } = tracer
  mesh.scale.set(radius, Math.max(length, 0.001), radius)
  mesh.position.copy(muzzle).addScaledVector(direction, startDistance + length * 0.5)
}
