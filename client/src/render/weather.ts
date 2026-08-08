import * as THREE from 'three'
import { ARENA_BOUNDS } from '../game/map'

type WeatherPhase = {
  name: string
  durationSeconds: number
  cloudiness: number
  precipitation: number
  storm: number
  fog: number
  windX: number
  windZ: number
}

type WeatherState = {
  cloudiness: number
  precipitation: number
  storm: number
  fog: number
  windX: number
  windZ: number
}

const WEATHER_PHASES: WeatherPhase[] = [
  { name: 'overcast-front', durationSeconds: 36, cloudiness: 0.72, precipitation: 0.08, storm: 0.18, fog: 0.18, windX: 1.3, windZ: -0.7 },
  { name: 'rain-band', durationSeconds: 48, cloudiness: 0.95, precipitation: 0.62, storm: 0.46, fog: 0.32, windX: 2.6, windZ: -1.8 },
  { name: 'storm-cell', durationSeconds: 34, cloudiness: 1.0, precipitation: 0.9, storm: 0.82, fog: 0.46, windX: 4.2, windZ: -2.5 },
  { name: 'clearing', durationSeconds: 42, cloudiness: 0.56, precipitation: 0.16, storm: 0.18, fog: 0.2, windX: 1.1, windZ: 0.4 },
]

const INITIAL_STATE: WeatherState = {
  cloudiness: 0.82,
  precipitation: 0.36,
  storm: 0.38,
  fog: 0.28,
  windX: 2.2,
  windZ: -1.2,
}

const CLOUD_LAYER_CONFIGS = [
  { height: 46, scale: 3.0, density: 0.42, speed: 0.018, offsetX: 4.3, offsetY: 1.7 },
  { height: 61, scale: 2.2, density: 0.36, speed: 0.013, offsetX: 12.6, offsetY: 8.1 },
  { height: 78, scale: 1.55, density: 0.3, speed: 0.009, offsetX: -7.4, offsetY: 16.8 },
]

const RAIN_DROP_COUNT = 1200
const RAIN_AREA_PADDING = 18
const RAIN_TOP = 34
const RAIN_HEIGHT = 42

export class DynamicWeatherSystem {
  private readonly root = new THREE.Group()
  private readonly sky: SkyDome
  private readonly clouds: FluidCloudDeck
  private readonly rain: RainField
  private readonly wetSurfaces: WetSurfaceController
  private readonly puddles: PuddleOverlay
  private readonly lightning = new THREE.DirectionalLight(0xbfd7ff, 0)
  private readonly backgroundColor = new THREE.Color()
  private readonly originalBackground: THREE.Color | THREE.Texture | null
  private readonly originalFog: THREE.Scene['fog']
  private readonly fog = new THREE.FogExp2(0x111820, 0.0025)
  private phaseIndex = 0
  private phaseClock = 0
  private elapsed = 0
  private wetness = 0
  private readonly state: WeatherState = { ...INITIAL_STATE }

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'dynamic-weather-system'
    this.root.renderOrder = -10
    this.originalBackground = scene.background instanceof THREE.Color ? scene.background.clone() : scene.background
    this.originalFog = scene.fog

    this.sky = new SkyDome()
    this.clouds = new FluidCloudDeck()
    this.rain = new RainField()
    this.puddles = new PuddleOverlay()
    this.wetSurfaces = new WetSurfaceController(scene)

    this.lightning.position.set(-18, 44, 12)
    this.lightning.target.position.set(0, 0, 0)

    this.root.add(this.sky.object, this.clouds.object, this.rain.object, this.puddles.object, this.lightning, this.lightning.target)
    this.scene.add(this.root)
    this.scene.fog = this.fog
  }

  update(deltaSeconds: number, elapsedSeconds: number, camera: THREE.PerspectiveCamera): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1)
    this.elapsed = elapsedSeconds
    this.advancePhase(dt)

    const gust = Math.sin(this.elapsed * 0.19) * 0.16 + Math.sin(this.elapsed * 0.071) * 0.1
    const snapshot: WeatherState = {
      cloudiness: clamp01(this.state.cloudiness + gust * 0.18),
      precipitation: clamp01(this.state.precipitation + Math.sin(this.elapsed * 0.31) * 0.045),
      storm: clamp01(this.state.storm + Math.sin(this.elapsed * 0.11 + 2.2) * 0.075),
      fog: clamp01(this.state.fog + Math.sin(this.elapsed * 0.087 + 0.7) * 0.055),
      windX: this.state.windX + Math.sin(this.elapsed * 0.23) * 0.45,
      windZ: this.state.windZ + Math.cos(this.elapsed * 0.17) * 0.38,
    }

    const rainWetnessTarget = Math.max(snapshot.precipitation * 0.86, snapshot.fog * 0.32)
    const drying = snapshot.precipitation > 0.08 ? 1.7 : 0.24
    this.wetness = approach(this.wetness, rainWetnessTarget, dt, drying)

    this.sky.update(snapshot, this.elapsed, camera)
    this.clouds.update(snapshot, this.elapsed, camera)
    this.rain.update(snapshot, this.elapsed)
    this.puddles.update(snapshot, this.wetness, this.elapsed, camera)
    this.wetSurfaces.update(this.wetness)
    this.updateAtmosphere(snapshot)
    this.updateLightning(snapshot)
  }

  dispose(): void {
    this.scene.background = this.originalBackground
    this.scene.fog = this.originalFog
    this.wetSurfaces.dispose()
    this.sky.dispose()
    this.clouds.dispose()
    this.rain.dispose()
    this.puddles.dispose()
    this.lightning.dispose()
    this.scene.remove(this.root)
  }

  private advancePhase(dt: number): void {
    const target = WEATHER_PHASES[this.phaseIndex]
    this.phaseClock += dt
    if (this.phaseClock >= target.durationSeconds) {
      this.phaseClock = 0
      this.phaseIndex = (this.phaseIndex + 1) % WEATHER_PHASES.length
    }

    const nextTarget = WEATHER_PHASES[this.phaseIndex]
    const blend = 1 - Math.exp(-dt * 0.18)
    this.state.cloudiness = THREE.MathUtils.lerp(this.state.cloudiness, nextTarget.cloudiness, blend)
    this.state.precipitation = THREE.MathUtils.lerp(this.state.precipitation, nextTarget.precipitation, blend)
    this.state.storm = THREE.MathUtils.lerp(this.state.storm, nextTarget.storm, blend)
    this.state.fog = THREE.MathUtils.lerp(this.state.fog, nextTarget.fog, blend)
    this.state.windX = THREE.MathUtils.lerp(this.state.windX, nextTarget.windX, blend)
    this.state.windZ = THREE.MathUtils.lerp(this.state.windZ, nextTarget.windZ, blend)
  }

  private updateAtmosphere(state: WeatherState): void {
    const clear = new THREE.Color(0x121b27)
    const storm = new THREE.Color(0x070a0e)
    const fogged = new THREE.Color(0x27313a)
    this.backgroundColor.copy(clear).lerp(storm, state.storm * 0.74).lerp(fogged, state.fog * 0.24)
    this.scene.background = this.backgroundColor
    this.fog.color.copy(this.backgroundColor).lerp(new THREE.Color(0x6d7378), state.fog * 0.26)
    this.fog.density = 0.002 + state.fog * 0.012 + state.precipitation * 0.003
  }

  private updateLightning(state: WeatherState): void {
    const pulse =
      state.storm > 0.62
        ? Math.pow(Math.max(0, Math.sin(this.elapsed * 2.9) * Math.sin(this.elapsed * 0.47 + 1.4)), 42)
        : 0
    this.lightning.intensity = pulse * state.storm * 5.5
  }
}

class SkyDome {
  readonly object: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>

  constructor() {
    this.object = new THREE.Mesh(
      new THREE.SphereGeometry(185, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uStorm: { value: 0 },
          uFog: { value: 0 },
          uHorizonGlow: { value: 0.45 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldDirection;

          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform float uTime;
          uniform float uStorm;
          uniform float uFog;
          uniform float uHorizonGlow;
          varying vec3 vWorldDirection;

          float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
          }

          void main() {
            float up = clamp(vWorldDirection.y * 0.5 + 0.5, 0.0, 1.0);
            float horizon = pow(1.0 - abs(vWorldDirection.y), 2.2);
            float skyGrain = noise(vWorldDirection.xz * 6.0 + uTime * 0.015) * 0.025;
            vec3 clearTop = vec3(0.03, 0.07, 0.12);
            vec3 clearHorizon = vec3(0.23, 0.29, 0.34);
            vec3 stormTop = vec3(0.012, 0.016, 0.021);
            vec3 stormHorizon = vec3(0.12, 0.15, 0.17);
            vec3 topColor = mix(clearTop, stormTop, uStorm);
            vec3 horizonColor = mix(clearHorizon, stormHorizon, uStorm);
            vec3 color = mix(horizonColor, topColor, smoothstep(0.12, 0.95, up));
            color += horizon * uHorizonGlow * vec3(0.05, 0.06, 0.065) * (1.0 - uStorm * 0.45);
            color = mix(color, vec3(0.18, 0.2, 0.21), uFog * 0.18);
            color += skyGrain;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    )
    this.object.name = 'weather-sky-dome'
    this.object.frustumCulled = false
    this.object.renderOrder = -100
  }

  update(state: WeatherState, time: number, camera: THREE.PerspectiveCamera): void {
    this.object.position.copy(camera.position)
    this.object.material.uniforms.uTime.value = time
    this.object.material.uniforms.uStorm.value = state.storm
    this.object.material.uniforms.uFog.value = state.fog
    this.object.material.uniforms.uHorizonGlow.value = 0.38 + (1 - state.cloudiness) * 0.28
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.object.material.dispose()
  }
}

class FluidCloudDeck {
  readonly object = new THREE.Group()
  private readonly layers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = []

  constructor() {
    this.object.name = 'weather-fluid-cloud-deck'
    for (const config of CLOUD_LAYER_CONFIGS) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uCoverage: { value: 0.7 },
          uDensity: { value: config.density },
          uStorm: { value: 0.4 },
          uScale: { value: config.scale },
          uSpeed: { value: config.speed },
          uWind: { value: new THREE.Vector2(1, 0) },
          uLayerOffset: { value: new THREE.Vector2(config.offsetX, config.offsetY) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform float uTime;
          uniform float uCoverage;
          uniform float uDensity;
          uniform float uStorm;
          uniform float uScale;
          uniform float uSpeed;
          uniform vec2 uWind;
          uniform vec2 uLayerOffset;
          varying vec2 vUv;

          float hash(vec2 p) {
            p = fract(p * vec2(127.1, 311.7));
            p += dot(p, p + 74.7);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
          }

          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
            for (int i = 0; i < 5; i++) {
              value += noise(p) * amplitude;
              p = rot * p * 2.03 + 12.17;
              amplitude *= 0.5;
            }
            return value;
          }

          void main() {
            vec2 centered = (vUv - 0.5) * uScale;
            vec2 flow = normalize(uWind + vec2(0.001)) * uTime * uSpeed;
            vec2 baseUv = centered + flow + uLayerOffset;
            vec2 warp = vec2(
              fbm(baseUv * 0.72 + vec2(uTime * 0.018, -uTime * 0.012)),
              fbm(baseUv * 0.77 + vec2(-uTime * 0.015, uTime * 0.017))
            );
            vec2 fluidUv = baseUv + (warp - 0.5) * (1.6 + uStorm * 1.25);
            float body = fbm(fluidUv);
            float detail = fbm(fluidUv * 2.7 + warp * 1.8);
            float curl = fbm(vec2(body, detail) * 3.2 + baseUv);
            float density = body * 0.62 + detail * 0.28 + curl * 0.1;
            float threshold = mix(0.78, 0.38, uCoverage);
            float cloud = smoothstep(threshold, threshold + 0.23, density);
            float edge = smoothstep(0.72, 0.22, length(vUv - 0.5));
            float underside = smoothstep(0.28, 0.92, density + uStorm * 0.12);
            vec3 bright = vec3(0.78, 0.82, 0.8);
            vec3 shadow = vec3(0.26, 0.31, 0.34);
            vec3 storm = vec3(0.12, 0.15, 0.18);
            vec3 color = mix(bright, shadow, underside);
            color = mix(color, storm, uStorm * 0.78);
            float alpha = cloud * edge * uDensity * mix(0.62, 1.16, uCoverage);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      })
      const layer = new THREE.Mesh(new THREE.PlaneGeometry(360, 360, 1, 1), material)
      layer.rotation.x = -Math.PI / 2
      layer.position.y = config.height
      layer.renderOrder = -40 + this.layers.length
      layer.frustumCulled = false
      this.object.add(layer)
      this.layers.push(layer)
    }
  }

  update(state: WeatherState, time: number, camera: THREE.PerspectiveCamera): void {
    const wind = new THREE.Vector2(state.windX, state.windZ)
    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i]
      const uniforms = layer.material.uniforms
      layer.position.x = camera.position.x
      layer.position.z = camera.position.z
      uniforms.uTime.value = time
      uniforms.uCoverage.value = state.cloudiness
      uniforms.uStorm.value = state.storm
      uniforms.uWind.value.copy(wind)
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.geometry.dispose()
      layer.material.dispose()
    }
    this.layers.length = 0
  }
}

class RainField {
  readonly object: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly positions = new Float32Array(RAIN_DROP_COUNT * 2 * 3)
  private readonly seeds = new Float32Array(RAIN_DROP_COUNT * 4)
  private readonly minX = ARENA_BOUNDS.min.x - RAIN_AREA_PADDING
  private readonly maxX = ARENA_BOUNDS.max.x + RAIN_AREA_PADDING
  private readonly minZ = ARENA_BOUNDS.min.z - RAIN_AREA_PADDING
  private readonly maxZ = ARENA_BOUNDS.max.z + RAIN_AREA_PADDING

  constructor() {
    for (let i = 0; i < RAIN_DROP_COUNT; i += 1) {
      this.seeds[i * 4] = hash01(i * 17 + 11)
      this.seeds[i * 4 + 1] = hash01(i * 31 + 23)
      this.seeds[i * 4 + 2] = hash01(i * 47 + 41)
      this.seeds[i * 4 + 3] = hash01(i * 71 + 5)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.computeBoundingSphere()
    const material = new THREE.LineBasicMaterial({
      color: 0x9fb8c7,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    })
    this.object = new THREE.LineSegments(geometry, material)
    this.object.name = 'weather-rain-field'
    this.object.frustumCulled = false
    this.object.renderOrder = 2
  }

  update(state: WeatherState, time: number): void {
    const intensity = clamp01(state.precipitation)
    this.object.visible = intensity > 0.025
    this.object.material.opacity = intensity * (0.26 + state.storm * 0.2)
    if (!this.object.visible) return

    const width = this.maxX - this.minX
    const depth = this.maxZ - this.minZ
    const fallSpeed = 15 + state.storm * 10 + intensity * 8
    const streak = 0.9 + intensity * 1.9 + state.storm * 0.75
    const windX = state.windX * 0.055
    const windZ = state.windZ * 0.055

    for (let i = 0; i < RAIN_DROP_COUNT; i += 1) {
      const sx = this.seeds[i * 4]
      const sz = this.seeds[i * 4 + 1]
      const sy = this.seeds[i * 4 + 2]
      const phase = this.seeds[i * 4 + 3]
      const activeGate = hash01(i * 13 + Math.floor(time * 0.45))
      const visibleScale = activeGate < intensity * 0.9 + 0.1 ? 1 : 0
      const windDrift = time * 0.75
      const x = wrap(this.minX + sx * width + state.windX * windDrift + phase * 7, this.minX, this.maxX)
      const z = wrap(this.minZ + sz * depth + state.windZ * windDrift - phase * 5, this.minZ, this.maxZ)
      const y = RAIN_TOP - ((time * fallSpeed + sy * RAIN_HEIGHT) % RAIN_HEIGHT)
      const base = i * 6
      this.positions[base] = x
      this.positions[base + 1] = y
      this.positions[base + 2] = z
      this.positions[base + 3] = x - windX * streak * visibleScale
      this.positions[base + 4] = y - streak * visibleScale
      this.positions[base + 5] = z - windZ * streak * visibleScale
    }

    const attribute = this.object.geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.needsUpdate = true
    this.object.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, RAIN_TOP * 0.5, 0), 92)
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.object.material.dispose()
  }
}

class PuddleOverlay {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

  constructor() {
    const size = ARENA_BOUNDS.max.x - ARENA_BOUNDS.min.x
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uWetness: { value: 0 },
          uRain: { value: 0 },
          uStorm: { value: 0 },
          uCameraPos: { value: new THREE.Vector3() },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorldPosition;

          void main() {
            vUv = uv;
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform float uTime;
          uniform float uWetness;
          uniform float uRain;
          uniform float uStorm;
          uniform vec3 uCameraPos;
          varying vec2 vUv;
          varying vec3 vWorldPosition;

          float hash(vec2 p) {
            p = fract(p * vec2(269.5, 183.3));
            p += dot(p, p + 42.23);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
          }

          void main() {
            float receiver = smoothstep(0.44, 0.76, noise(vUv * 10.0 + vec2(2.7, 5.1)));
            vec2 rippleUv = vWorldPosition.xz * 1.6;
            float rippleA = sin(length(fract(rippleUv + uTime * 0.6) - 0.5) * 34.0 - uTime * 13.0);
            float rippleB = sin((rippleUv.x + rippleUv.y) * 9.0 + uTime * 18.0);
            float ripple = smoothstep(0.36, 1.0, rippleA * 0.5 + rippleB * 0.22 + 0.5);
            float distanceFade = 1.0 - smoothstep(10.0, 46.0, distance(uCameraPos.xz, vWorldPosition.xz));
            float alpha = uWetness * receiver * distanceFade * (0.08 + uRain * 0.18);
            vec3 color = mix(vec3(0.05, 0.07, 0.08), vec3(0.36, 0.46, 0.5), ripple * uRain);
            color = mix(color, vec3(0.12, 0.17, 0.2), uStorm * 0.45);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    )
    this.object.name = 'weather-puddle-overlay'
    this.object.rotation.x = -Math.PI / 2
    this.object.position.set(0, 0.028, 0)
    this.object.renderOrder = 1
  }

  update(state: WeatherState, wetness: number, time: number, camera: THREE.PerspectiveCamera): void {
    this.object.visible = wetness > 0.035
    this.object.material.uniforms.uTime.value = time
    this.object.material.uniforms.uWetness.value = wetness
    this.object.material.uniforms.uRain.value = state.precipitation
    this.object.material.uniforms.uStorm.value = state.storm
    this.object.material.uniforms.uCameraPos.value.copy(camera.position)
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.object.material.dispose()
  }
}

class WetSurfaceController {
  private readonly records: { material: THREE.MeshStandardMaterial; color: THREE.Color; roughness: number; metalness: number }[] = []

  constructor(scene: THREE.Scene) {
    const seen = new Set<THREE.MeshStandardMaterial>()
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue
        seen.add(material)
        this.records.push({
          material,
          color: material.color.clone(),
          roughness: material.roughness,
          metalness: material.metalness,
        })
      }
    })
  }

  update(wetness: number): void {
    const wetColor = new THREE.Color(0x121820)
    for (const record of this.records) {
      record.material.color.copy(record.color).lerp(wetColor, wetness * 0.34)
      record.material.roughness = THREE.MathUtils.lerp(record.roughness, Math.min(record.roughness, 0.36), wetness)
      record.material.metalness = THREE.MathUtils.lerp(record.metalness, Math.max(record.metalness, 0.08), wetness * 0.24)
    }
  }

  dispose(): void {
    for (const record of this.records) {
      record.material.color.copy(record.color)
      record.material.roughness = record.roughness
      record.material.metalness = record.metalness
    }
    this.records.length = 0
  }
}

function approach(current: number, target: number, dt: number, speed: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-dt * speed))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function hash01(value: number): number {
  const s = Math.sin(value * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

function wrap(value: number, min: number, max: number): number {
  const range = max - min
  return ((((value - min) % range) + range) % range) + min
}
