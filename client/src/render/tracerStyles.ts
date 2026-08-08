// Tracer style implementations. Each one is driven entirely by a TracerVisual
// coming from the server catalog, so retuning a cosmetic never needs a client
// release.

import * as THREE from 'three'
import type { TracerVisual } from '../core/tracerShop'
import { layoutBeam, type ActiveTracer, type TracerSpawn, type TracerStyle } from './tracers'

/** Beam appears at full length, then the tail retracts toward the impact. */
export class WhipTracerStyle implements TracerStyle {
  constructor(private readonly visual: TracerVisual) {}

  radius(): number {
    return this.visual.radiusM
  }

  lifetimeMs(): number {
    return this.visual.lifetimeMs
  }

  createMaterial(): THREE.Material {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.visual.coreColor),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    // Squared easing makes the tail linger, then snap; linear reads as mushy.
    const tail = t * t
    const startDistance = tracer.distance * tail
    layoutBeam(tracer, startDistance, tracer.distance - startDistance, this.visual.radiusM)
    const material = tracer.mesh.material as THREE.MeshBasicMaterial
    material.opacity = Math.pow(1 - t, 1.6)
  }
}

/**
 * A fixed-length streak that flies from muzzle to impact at bullet speed, then
 * drains into the impact point. Hit resolution stays hitscan on the server;
 * only the visual has travel time.
 */
export class TravelingTracerStyle implements TracerStyle {
  constructor(private readonly visual: TracerVisual) {}

  radius(): number {
    return this.visual.radiusM
  }

  lifetimeMs(spawn: TracerSpawn): number {
    const distance = spawn.impact.distanceTo(spawn.muzzle)
    const travelMs = ((distance + this.visual.trailM) / this.visual.speedMps) * 1000
    return travelMs + this.visual.lifetimeMs
  }

  createMaterial(): THREE.Material {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.visual.coreColor),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const travelled = this.visual.speedMps * ((t * tracer.lifetimeMs) / 1000)
    // The head stops at the impact point while the tail keeps going, so the
    // streak drains instead of vanishing.
    const head = Math.min(travelled, tracer.distance)
    const tail = Math.max(0, Math.min(travelled - this.visual.trailM, tracer.distance))
    const length = head - tail
    if (length <= 0) {
      tracer.mesh.visible = false
      return
    }
    tracer.mesh.visible = true
    layoutBeam(tracer, tail, length, this.visual.radiusM)
    const material = tracer.mesh.material as THREE.MeshBasicMaterial
    material.opacity = head >= tracer.distance ? Math.max(0, length / this.visual.trailM) : 1
  }
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// vUv.y runs 0 -> 1 from the muzzle end to the impact end of the cylinder.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3  uCoreColor;
  uniform vec3  uGlowColor;
  uniform float uHead;
  uniform float uFalloff;
  uniform float uFade;
  varying vec2  vUv;

  void main() {
    float behind = uHead - vUv.y;
    float visible = step(0.0, behind);
    float trail = exp(-max(behind, 0.0) * uFalloff) * visible;
    float core  = exp(-max(behind, 0.0) * uFalloff * 7.0) * visible;
    gl_FragColor = vec4(mix(uGlowColor, uCoreColor, core), clamp(trail, 0.0, 1.0) * uFade);
  }
`

/**
 * Static full-length geometry; the head position and the exponential falloff
 * live in the fragment shader, so a frame costs three uniform writes.
 */
export class ShaderTracerStyle implements TracerStyle {
  constructor(private readonly visual: TracerVisual) {}

  radius(): number {
    return this.visual.radiusM
  }

  lifetimeMs(spawn: TracerSpawn): number {
    const distance = spawn.impact.distanceTo(spawn.muzzle)
    return (distance / this.visual.speedMps) * 1000 + this.visual.lifetimeMs
  }

  createMaterial(): THREE.Material {
    return new THREE.ShaderMaterial({
      uniforms: {
        uCoreColor: { value: new THREE.Color(this.visual.coreColor) },
        uGlowColor: { value: new THREE.Color(this.visual.glowColor) },
        uHead: { value: 0 },
        uFalloff: { value: 8 },
        uFade: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onSpawn(tracer: ActiveTracer): void {
    // Geometry spans the whole shot once and never moves again.
    const radius = this.visual.radiusM
    tracer.mesh.scale.set(radius, tracer.distance, radius)
    tracer.mesh.position
      .copy(tracer.muzzle)
      .addScaledVector(tracer.direction, tracer.distance * 0.5)

    // Convert the trail length from metres into the 0..1 uv space of this beam,
    // so a point-blank shot and a 100 m shot both read correctly.
    const material = tracer.mesh.material as THREE.ShaderMaterial
    material.uniforms.uFalloff.value = tracer.distance / Math.max(this.visual.trailM, 0.5)
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const material = tracer.mesh.material as THREE.ShaderMaterial
    const travelled = this.visual.speedMps * ((t * tracer.lifetimeMs) / 1000)
    const head = Math.min(travelled / tracer.distance, 1)
    material.uniforms.uHead.value = head
    material.uniforms.uFade.value = head >= 1 ? Math.pow(1 - t, 2) : 1
  }
}

/**
 * Build the renderer for an equipped cosmetic.
 *
 * `effectsQuality` may downgrade an expensive style to the cheap one, but it
 * must never remove the tracer: requirements 8 forbids quality settings from
 * creating a competitive information advantage.
 */
export function createTracerStyle(
  visual: TracerVisual,
  effectsQuality: 'low' | 'high',
): TracerStyle {
  if (effectsQuality === 'low') return new WhipTracerStyle(visual)
  switch (visual.style) {
    case 'shader':
      return new ShaderTracerStyle(visual)
    case 'traveling':
      return new TravelingTracerStyle(visual)
    default:
      return new WhipTracerStyle(visual)
  }
}
