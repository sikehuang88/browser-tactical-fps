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

/** V1：拉伸淡出（低画质档，零额外开销）。 */
export class WhipTracerStyle implements TracerStyle {
  constructor(
    private readonly options: {
      color?: number
      radius?: number
      lifetimeMs?: number
      tailEase?: number
    } = {},
  ) {}

  radius(): number {
    return this.options.radius ?? 0.014
  }

  lifetimeMs(): number {
    return this.options.lifetimeMs ?? 110
  }

  createMaterial(): THREE.Material {
    return new THREE.MeshBasicMaterial({
      color: this.options.color ?? 0xffe08a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const ease = this.options.tailEase ?? 2
    const tail = Math.pow(t, ease)
    const startDistance = tracer.distance * tail
    const length = tracer.distance - startDistance
    layoutBeam(tracer, startDistance, length, this.radius())
    const material = tracer.mesh.material as THREE.MeshBasicMaterial
    material.opacity = Math.pow(1 - t, 1.6)
  }
}

/** V3：着色器曳光（高画质档，头部飞行 + 指数尾迹）。 */
const TRACER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const TRACER_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCoreColor;
  uniform vec3 uGlowColor;
  uniform float uHead;
  uniform float uFalloff;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    float behind = uHead - vUv.y;
    float visible = step(0.0, behind);
    float trail = exp(-behind * uFalloff) * visible;
    float core = exp(-behind * uFalloff * 7.0) * visible;
    vec3 color = mix(uGlowColor, uCoreColor, core);
    float alpha = clamp(trail, 0.0, 1.0) * uFade;
    gl_FragColor = vec4(color, alpha);
  }
`

export class ShaderTracerStyle implements TracerStyle {
  constructor(
    private readonly options: {
      coreColor?: number
      glowColor?: number
      radius?: number
      speedMps?: number
      trailMetres?: number
      fadeMs?: number
    } = {},
  ) {}

  radius(): number {
    return this.options.radius ?? 0.02
  }

  lifetimeMs(spawn: TracerSpawn): number {
    const distance = spawn.impact.distanceTo(spawn.muzzle)
    const speed = this.options.speedMps ?? 900
    return (distance / speed) * 1000 + (this.options.fadeMs ?? 90)
  }

  createMaterial(): THREE.Material {
    return new THREE.ShaderMaterial({
      uniforms: {
        uCoreColor: { value: new THREE.Color(this.options.coreColor ?? 0xfff6d8) },
        uGlowColor: { value: new THREE.Color(this.options.glowColor ?? 0xff9c3c) },
        uHead: { value: 0 },
        uFalloff: { value: 8 },
        uFade: { value: 1 },
      },
      vertexShader: TRACER_VERTEX_SHADER,
      fragmentShader: TRACER_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onSpawn(tracer: ActiveTracer, spawn: TracerSpawn): void {
    const radius = this.radius()
    tracer.mesh.scale.set(radius, tracer.distance, radius)
    tracer.mesh.position
      .copy(tracer.muzzle)
      .addScaledVector(tracer.direction, tracer.distance * 0.5)

    const trail = this.options.trailMetres ?? 12
    const material = tracer.mesh.material as THREE.ShaderMaterial
    material.uniforms.uFalloff.value = tracer.distance / Math.max(trail, 0.5)
    void spawn
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const material = tracer.mesh.material as THREE.ShaderMaterial
    const speed = this.options.speedMps ?? 900
    const elapsedSec = (t * tracer.lifetimeMs) / 1000
    const head = Math.min((speed * elapsedSec) / tracer.distance, 1)
    material.uniforms.uHead.value = head
    material.uniforms.uFade.value = head >= 1 ? Math.pow(1 - t, 2) : 1
  }
}
