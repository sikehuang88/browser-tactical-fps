import * as THREE from 'three'
import type { LocalPlayerState } from '../prediction/localPlayer'
import { ARENA_BOUNDS, WALLS, type Aabb } from '../game/map'
import { getWeapon } from '../game/weapons/registry'
import {
  createGameplayModel,
  disposeGameplayModel,
  gameplayModelForWeapon,
  gameplayModelRotationY,
  type GameplayModelId,
} from './gameplayAssets'

const TRACER_LIFETIME_MS = 80
const TRACER_MAX_DISTANCE = 120
const LASER_BEAM_LIFETIME_MS = 180
const SHELL_LIFETIME_MS = 1100
const BOB_CYCLES_PER_METER = 1.15
const SWAY_STIFFNESS = 14
const LOCAL_UP = new THREE.Vector3(0, 1, 0)
const MUZZLE_FORWARD = new THREE.Vector3(0, 0, -1)

const FIRST_PERSON_MODEL_CONFIG: Record<GameplayModelId, { scale: number; viewZ: number; position: THREE.Vector3 }> = {
  // X-axis weapon assets share the existing -90 degree orientation. The
  // smaller scales and deeper viewZ keep the full gun inside the lower-right
  // weapon frame instead of clipping into the camera.
  rifle: { scale: 0.78, viewZ: -0.60, position: new THREE.Vector3(0, -0.03, 0) },
  sniper: { scale: 0.85, viewZ: -0.66, position: new THREE.Vector3(0, -0.06, 0) },
  pistol: { scale: 0.66, viewZ: -0.54, position: new THREE.Vector3(0, -0.05, 0) },
  knife: { scale: 0.72, viewZ: -0.48, position: new THREE.Vector3(0.02, -0.03, 0) },
  grenade: { scale: 0.56, viewZ: -0.44, position: new THREE.Vector3(0, -0.04, 0) },
  // These two newly imported assets were authored facing the opposite way.
  // Flip each around Y so the muzzle points toward camera forward (-Z).
  pinkM4: { scale: 0.78, viewZ: -0.60, position: new THREE.Vector3(0, -0.03, 0) },
  laserCannon: { scale: 0.78, viewZ: -0.62, position: new THREE.Vector3(0, -0.05, 0) },
}

export class PlayerView {
  private readonly weapon = new THREE.Group()
  private readonly modelMount = new THREE.Group()
  private readonly fallback = buildFallbackModel()
  private readonly tracers: { mesh: THREE.Mesh; expiresAtMs: number; lifetimeMs: number }[] = []
  private readonly muzzleEffects: MuzzleEffect[] = []
  private readonly shellCasings: ShellCasing[] = []
  private laserChargeGlow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null
  private laserChargeLight: THREE.PointLight | null = null
  private activeModel: THREE.Group | null = null
  private activeModelId: GameplayModelId | null = null
  private requestedModelId: GameplayModelId | null = null
  private muzzleLocal: THREE.Vector3 | null = null
  private loadToken = 0
  private lastShots = 0
  private lastUpdateMs = 0
  private recoilKick = 0
  private swingStartedAtMs = -Infinity
  private bobPhase = 0
  private bobStrength = 0
  private readonly weaponRotation = new THREE.Quaternion()
  private readonly defaultFov: number
  private readonly effectsQuality: 'low' | 'high'

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly scene: THREE.Scene,
    options: { effectsQuality?: 'low' | 'high' } = {},
  ) {
    this.defaultFov = camera.fov
    this.effectsQuality = options.effectsQuality ?? 'high'
    this.modelMount.add(this.fallback)
    this.weapon.add(this.modelMount)
    // Keep the viewmodel in the scene graph so WebGLRenderer always traverses
    // it. Each frame it is placed from the camera transform, while its
    // materials use depthTest=false so map geometry cannot occlude it.
    scene.add(this.weapon)
    this.setWeaponModel(2)
  }

  update(state: LocalPlayerState, nowMs: number): void {
    this.setWeaponModel(state.weaponId)
    // 死亡/回合结束隐藏第一人称枪模，避免死亡画面里枪口悬浮。
    this.weapon.visible = state.health > 0
    const targetFov = state.aiming && state.weaponId === 4 ? this.defaultFov * 0.5 : this.defaultFov
    const fovT = this.lastUpdateMs > 0
      ? 1 - Math.exp(-Math.min((nowMs - this.lastUpdateMs) / 1000, 0.1) * 18)
      : 1
    this.camera.fov += (targetFov - this.camera.fov) * fovT
    this.camera.updateProjectionMatrix()
    const eye = 1.2 + ((state.height - 1.35) / 0.45) * 0.4
    this.camera.position.set(state.position.x, state.position.y + eye, state.position.z)
    this.camera.rotation.set(
      THREE.MathUtils.degToRad(state.pitch),
      THREE.MathUtils.degToRad(state.yaw),
      0,
    )

    const dt = this.lastUpdateMs > 0 ? Math.min((nowMs - this.lastUpdateMs) / 1000, 0.1) : 0
    this.lastUpdateMs = nowMs
    this.recoilKick *= Math.exp(-dt * 20)

    const bobTarget = state.moveSpeed > 0.1 ? 1 : 0
    this.bobStrength += (bobTarget - this.bobStrength) * (1 - Math.exp(-dt * 8))
    this.bobPhase += state.moveSpeed * dt * BOB_CYCLES_PER_METER * Math.PI * 2
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobStrength
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobStrength
    this.weapon.position.copy(this.camera.position)
    this.weapon.quaternion.copy(this.camera.quaternion)
    // 武器姿态带一阶滞后，避免“焊在屏幕上”的轻飘感。
    this.weaponRotation.slerp(this.camera.quaternion, 1 - Math.exp(-dt * SWAY_STIFFNESS))
    this.weapon.quaternion.copy(this.weaponRotation)
    this.weapon.translateX(0.26 + bobX)
    this.weapon.translateY(-0.32 + bobY)
    this.applyViewModelMotion(nowMs)
    this.applyReloadMotion(state, nowMs)
    this.updateLaserCharge(state, nowMs)

    const shots = state.shotsFired
    if (shots < this.lastShots) this.lastShots = shots
    if (shots > this.lastShots) {
      for (let i = 0; i < shots - this.lastShots; i += 1) {
        if (state.weaponId === 5) {
          this.swingStartedAtMs = nowMs
        } else if (state.weaponId === 7) {
          this.recoilKick = Math.min(0.13, this.recoilKick + 0.055)
          this.spawnLaserBeam(nowMs)
        } else {
          this.recoilKick = Math.min(0.13, this.recoilKick + 0.055)
          this.spawnMuzzleFlash(nowMs, state.weaponId)
          if (this.effectsQuality === 'high') {
            this.spawnShellCasing(nowMs, state.weaponId)
            this.spawnTracer(nowMs)
          }
        }
      }
    }
    this.lastShots = shots

    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i]
      const remaining = tracer.expiresAtMs - nowMs
      const material = tracer.mesh.material as THREE.MeshBasicMaterial
      material.opacity = Math.max(0, Math.min(1, remaining / tracer.lifetimeMs))
      if (remaining <= 0) {
        this.scene.remove(tracer.mesh)
        tracer.mesh.geometry.dispose()
        material.dispose()
        this.tracers.splice(i, 1)
      }
    }

    for (let i = this.muzzleEffects.length - 1; i >= 0; i -= 1) {
      const effect = this.muzzleEffects[i]
      const elapsed = nowMs - effect.startedAtMs
      const life = effect.expiresAtMs - effect.startedAtMs
      const progress = THREE.MathUtils.clamp(elapsed / life, 0, 1)
      const flashAlpha = progress < 0.18 ? 1 - progress / 0.18 : 0
      const smokeAlpha = progress < 0.9 ? 0.62 * (1 - progress / 0.9) : 0

      effect.flash.material.opacity = flashAlpha
      effect.flash.scale.setScalar(0.7 + (1 - progress) * 0.8)
      for (let smokeIndex = 0; smokeIndex < effect.smoke.length; smokeIndex += 1) {
        const smoke = effect.smoke[smokeIndex]
        smoke.material.opacity = smokeAlpha * (1 - smokeIndex * 0.16)
        smoke.scale.setScalar(0.45 + progress * (1.8 + smokeIndex * 0.25))
      }
      effect.light.intensity = flashAlpha * 3.2

      if (nowMs >= effect.expiresAtMs) {
        this.scene.remove(effect.flash, effect.light)
        for (const smoke of effect.smoke) this.scene.remove(smoke)
        effect.flash.geometry.dispose()
        for (const smoke of effect.smoke) {
          smoke.geometry.dispose()
          ;(smoke.material as THREE.Material).dispose()
        }
        ;(effect.flash.material as THREE.Material).dispose()
        this.muzzleEffects.splice(i, 1)
      }
    }

    for (let i = this.shellCasings.length - 1; i >= 0; i -= 1) {
      const casing = this.shellCasings[i]
      casing.velocity.y -= 9.8 * dt
      casing.mesh.position.addScaledVector(casing.velocity, dt)
      casing.mesh.rotation.x += casing.angularVelocity.x * dt
      casing.mesh.rotation.y += casing.angularVelocity.y * dt
      casing.mesh.rotation.z += casing.angularVelocity.z * dt

      if (casing.mesh.position.y < 0.035) {
        casing.mesh.position.y = 0.035
        casing.velocity.y *= -0.22
        casing.velocity.x *= 0.72
        casing.velocity.z *= 0.72
        casing.angularVelocity.multiplyScalar(0.82)
      }

      const remaining = casing.expiresAtMs - nowMs
      const material = casing.mesh.material as THREE.MeshStandardMaterial
      material.opacity = THREE.MathUtils.clamp(remaining / 180, 0, 1)
      if (remaining <= 0) {
        this.scene.remove(casing.mesh)
        casing.mesh.geometry.dispose()
        material.dispose()
        this.shellCasings.splice(i, 1)
      }
    }
  }

  dispose(): void {
    this.loadToken += 1
    this.scene.remove(this.weapon)
    if (this.activeModel) disposeGameplayModel(this.activeModel)
    disposeFallback(this.fallback)
    for (const tracer of this.tracers) {
      this.scene.remove(tracer.mesh)
      tracer.mesh.geometry.dispose()
      ;(tracer.mesh.material as THREE.Material).dispose()
    }
    this.tracers.length = 0
    this.removeLaserCharge()
    for (const effect of this.muzzleEffects) {
      this.scene.remove(effect.flash, effect.light)
      for (const smoke of effect.smoke) this.scene.remove(smoke)
      effect.flash.geometry.dispose()
      for (const smoke of effect.smoke) {
        smoke.geometry.dispose()
        ;(smoke.material as THREE.Material).dispose()
      }
      ;(effect.flash.material as THREE.Material).dispose()
    }
    this.muzzleEffects.length = 0
    for (const casing of this.shellCasings) {
      this.scene.remove(casing.mesh)
      casing.mesh.geometry.dispose()
      ;(casing.mesh.material as THREE.Material).dispose()
    }
    this.shellCasings.length = 0
  }

  private setWeaponModel(weaponId: number): void {
    const modelId = gameplayModelForWeapon(weaponId)
    if (modelId === this.activeModelId || modelId === this.requestedModelId) return
    this.requestedModelId = modelId
    this.fallback.visible = true
    if (this.activeModel) this.activeModel.visible = false
    const token = ++this.loadToken

    void createGameplayModel(modelId)
      .then((model) => {
        if (token !== this.loadToken) {
          disposeGameplayModel(model)
          return
        }
        if (this.activeModel) {
          this.modelMount.remove(this.activeModel)
          disposeGameplayModel(this.activeModel)
        }
        configureFirstPersonModel(model, modelId)
        this.activeModel = model
        this.activeModelId = modelId
        this.requestedModelId = null
        this.fallback.visible = false
        this.modelMount.add(model)
        // 必须在挂载后计算枪口，否则漏掉 modelMount 的 viewZ 偏移，特效会落在枪身中间。
        this.muzzleLocal = computeMuzzleLocal(model, this.weapon)
      })
      .catch((error) => {
        if (token !== this.loadToken) return
        this.requestedModelId = null
        if (this.activeModel) this.activeModel.visible = true
        console.warn(`[weapon] Failed to load ${modelId}`, error)
      })
  }

  private applyViewModelMotion(nowMs: number): void {
    const modelId = this.activeModelId ?? this.requestedModelId ?? 'pistol'
    const baseZ = FIRST_PERSON_MODEL_CONFIG[modelId]?.viewZ ?? -0.62
    this.modelMount.position.set(0, 0, baseZ + this.recoilKick)
    this.modelMount.rotation.set(0, 0, 0)
    if (modelId !== 'knife') return

    const swing = (nowMs - this.swingStartedAtMs) / 360
    if (swing >= 0 && swing <= 1) {
      this.modelMount.rotation.z = -Math.sin(swing * Math.PI) * 0.92
      this.modelMount.rotation.x = Math.sin(swing * Math.PI) * 0.18
    }
  }

  /** 换弹过渡表现：下沉 + 侧倾 + 回位（手臂动画接入前的过渡方案）。 */
  private applyReloadMotion(state: LocalPlayerState, nowMs: number): void {
    if (!state.reloading || state.weaponId === 5 || state.reloadEndAtMs <= 0) return
    const weapon = getWeapon(state.weaponId)
    if (!weapon || weapon.reloadMs <= 0) return
    const progress = 1 - Math.max(0, state.reloadEndAtMs - nowMs) / weapon.reloadMs
    if (progress < 0 || progress > 1) return
    const dip = Math.sin(progress * Math.PI)
    this.modelMount.position.y -= dip * 0.14
    this.modelMount.rotation.z += dip * 0.5
    this.modelMount.rotation.x += dip * 0.25
  }

  private spawnTracer(nowMs: number): void {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize()
    const origin = this.camera.position.clone()
    const distance = traceDistance(origin, direction, TRACER_MAX_DISTANCE)
    const muzzle = this.muzzleWorldPosition()
    const end = origin.clone().addScaledVector(direction, distance)
    const segment = end.sub(muzzle)
    const length = segment.length()
    if (length < 0.05) return

    const geometry = new THREE.CylinderGeometry(0.012, 0.012, length, 6, 1, true)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(muzzle).addScaledVector(segment, 0.5)
    mesh.quaternion.setFromUnitVectors(LOCAL_UP, segment.normalize())
    mesh.renderOrder = 3
    this.scene.add(mesh)
    this.tracers.push({ mesh, expiresAtMs: nowMs + TRACER_LIFETIME_MS, lifetimeMs: TRACER_LIFETIME_MS })
  }

  private spawnMuzzleFlash(nowMs: number, weaponId: number): void {
    const modelId = gameplayModelForWeapon(weaponId)
    if (modelId === 'knife' || modelId === 'grenade') return

    const direction = MUZZLE_FORWARD.clone().applyQuaternion(this.camera.quaternion).normalize()
    const muzzle = this.muzzleWorldPosition()

    const flash = new THREE.Mesh(
      new THREE.ConeGeometry(0.085, 0.28, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb21c,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    flash.position.copy(muzzle).addScaledVector(direction, 0.12)
    flash.quaternion.setFromUnitVectors(LOCAL_UP, direction)
    flash.renderOrder = 5

    const smoke = this.effectsQuality === 'high' ? [0, 1, 2].map((index) => {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.09 + index * 0.018, 10, 8),
        new THREE.MeshBasicMaterial({
          color: index === 0 ? 0x6e665e : 0x938a80,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        }),
      )
      puff.position.copy(muzzle)
        .addScaledVector(direction, 0.16 + index * 0.11)
        .addScaledVector(upVector(this.camera.quaternion), (index - 1) * 0.035)
      puff.renderOrder = 4
      return puff
    }) : []

    const light = new THREE.PointLight(0xff9a38, 3.2, 3.2, 2)
    light.position.copy(muzzle)
    light.castShadow = false

    this.scene.add(flash, light, ...smoke)
    this.muzzleEffects.push({
      flash,
      smoke,
      light,
      startedAtMs: nowMs,
      expiresAtMs: nowMs + 260,
    })
  }

  private spawnShellCasing(nowMs: number, weaponId: number): void {
    const modelId = gameplayModelForWeapon(weaponId)
    if (modelId === 'knife' || modelId === 'grenade') return

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize()
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize()
    const forward = MUZZLE_FORWARD.clone().applyQuaternion(this.camera.quaternion).normalize()
    const pistol = modelId === 'pistol'
    const sniper = modelId === 'sniper'
    // 抛壳口在机匣/握把附近，不在枪口：取枪口到枪身 45% 处作为基准。
    const ejectLocal = (this.muzzleLocal ?? new THREE.Vector3(0, -0.03, -0.62))
      .clone()
      .multiplyScalar(0.45)
      .add(new THREE.Vector3(0.06, 0.04, 0.08))
    this.weapon.updateMatrixWorld(true)
    const origin = this.weapon.localToWorld(ejectLocal)

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(pistol ? 0.012 : sniper ? 0.018 : 0.014, pistol ? 0.012 : sniper ? 0.018 : 0.014, pistol ? 0.045 : sniper ? 0.08 : 0.065, 8),
      new THREE.MeshStandardMaterial({
        color: 0xc58b3a,
        metalness: 0.78,
        roughness: 0.28,
        transparent: true,
        opacity: 1,
      }),
    )
    mesh.position.copy(origin)
    mesh.rotation.set(0.4, 0.2, 0.8)
    mesh.renderOrder = 2

    const velocity = right.multiplyScalar(pistol ? 1.25 : sniper ? 1.8 : 1.55)
      .add(up.multiplyScalar(pistol ? 0.85 : sniper ? 1.2 : 1.05))
      .add(forward.multiplyScalar(-0.18))

    this.scene.add(mesh)
    this.shellCasings.push({
      mesh,
      velocity,
      angularVelocity: new THREE.Vector3(8.5, -6.5, 10),
      expiresAtMs: nowMs + SHELL_LIFETIME_MS,
    })
  }

  /** 激光炮专属：枪口蓄力光球 + 光晕。 */
  private updateLaserCharge(state: LocalPlayerState, nowMs: number): void {
    if (state.weaponId !== 7 || state.health <= 0 || state.charge <= 0) {
      this.removeLaserCharge()
      return
    }
    const muzzle = this.muzzleWorldPosition()
    if (!this.laserChargeGlow) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x66e0ff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      this.laserChargeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), material)
      this.laserChargeGlow.renderOrder = 6
      this.laserChargeLight = new THREE.PointLight(0x66e0ff, 0, 4, 2)
      this.scene.add(this.laserChargeGlow, this.laserChargeLight)
    }
    const charge = state.charge
    const pulse = 1 + Math.sin(nowMs * 0.02) * 0.08
    const glow = this.laserChargeGlow
    const light = this.laserChargeLight
    if (!glow || !light) return
    glow.position.copy(muzzle)
    glow.scale.setScalar((0.06 + charge * 0.16) * pulse)
    glow.material.opacity = 0.35 + charge * 0.5
    glow.material.color.setHSL(0.55, 0.9, 0.45 + charge * 0.35)
    light.position.copy(muzzle)
    light.intensity = charge * 3.5
  }

  private removeLaserCharge(): void {
    if (this.laserChargeGlow) {
      this.scene.remove(this.laserChargeGlow)
      this.laserChargeGlow.geometry.dispose()
      this.laserChargeGlow.material.dispose()
      this.laserChargeGlow = null
    }
    if (this.laserChargeLight) {
      this.scene.remove(this.laserChargeLight)
      this.laserChargeLight = null
    }
  }

  /** 激光炮专属曳光：双段青色光束，从真实枪口射向命中点。 */
  private spawnLaserBeam(nowMs: number): void {
    const direction = MUZZLE_FORWARD.clone().applyQuaternion(this.camera.quaternion).normalize()
    const origin = this.camera.position.clone()
    const distance = traceDistance(origin, direction, TRACER_MAX_DISTANCE)
    const muzzle = this.muzzleWorldPosition()
    const end = origin.clone().addScaledVector(direction, distance)
    const segment = end.sub(muzzle)
    const length = segment.length()
    if (length < 0.05) return

    const buildBeam = (radius: number, color: number, opacity: number) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, true)
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(muzzle).addScaledVector(segment, 0.5)
      mesh.quaternion.setFromUnitVectors(LOCAL_UP, segment.clone().normalize())
      mesh.renderOrder = 4
      this.scene.add(mesh)
      this.tracers.push({
        mesh,
        expiresAtMs: nowMs + LASER_BEAM_LIFETIME_MS,
        lifetimeMs: LASER_BEAM_LIFETIME_MS,
      })
    }
    buildBeam(0.045, 0x66e0ff, 0.35)
    buildBeam(0.016, 0xd8fbff, 0.95)
  }

  /** 当前可见枪模的枪口世界坐标（特效对齐用）。 */
  private muzzleWorldPosition(): THREE.Vector3 {
    const local = this.muzzleLocal ?? new THREE.Vector3(0, -0.03, -0.62)
    this.weapon.updateMatrixWorld(true)
    return this.weapon.localToWorld(local.clone())
  }
}

interface MuzzleEffect {
  flash: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>
  smoke: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
  light: THREE.PointLight
  startedAtMs: number
  expiresAtMs: number
}

function upVector(cameraQuaternion: THREE.Quaternion): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion).normalize()
}

interface ShellCasing {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
  expiresAtMs: number
}

function configureFirstPersonModel(model: THREE.Group, id: GameplayModelId): void {
  const config = FIRST_PERSON_MODEL_CONFIG[id]
  model.rotation.set(0, firstPersonModelRotationY(id), 0)
  model.scale.setScalar(config.scale)
  model.position.copy(config.position)
  model.renderOrder = 1000
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.renderOrder = 1000
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => {
      material.depthTest = false
      material.depthWrite = false
      material.needsUpdate = true
    })
  })
  if (id === 'knife') {
    model.rotation.z = -0.12
  }
}

/** 第一人称枪口朝向：粉色 M4 与巴雷特素材朝向与步枪相反，单独翻转。 */
function firstPersonModelRotationY(id: GameplayModelId): number {
  if (id === 'pinkM4') return -Math.PI / 2
  if (id === 'sniper') return Math.PI / 2
  return gameplayModelRotationY(id)
}

/** 从模型网格中找出最靠前的顶点，换算到 weapon 本地空间作为枪口。 */
function computeMuzzleLocal(model: THREE.Group, weapon: THREE.Group): THREE.Vector3 | null {
  weapon.updateMatrixWorld(true)
  model.updateMatrixWorld(true)
  const toWeaponLocal = new THREE.Matrix4().copy(weapon.matrixWorld).invert()
  let best: THREE.Vector3 | null = null
  const vertex = new THREE.Vector3()
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const positions = object.geometry.attributes.position
    if (!positions) return
    const toLocal = new THREE.Matrix4().multiplyMatrices(toWeaponLocal, object.matrixWorld)
    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(toLocal)
      // 在 weapon 本地空间比较 -Z（枪管方向），与加载瞬间玩家朝向无关。
      if (!best || vertex.z < best.z) best = vertex.clone()
    }
  })
  if (!best) return null
  return best
}

function traceDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): number {
  let distance = maxDistance
  for (const wall of WALLS) {
    const hit = rayAabbDistance(origin, direction, wall)
    if (hit !== null && hit > 0.02) distance = Math.min(distance, hit)
  }
  const boundaryHit = rayAabbDistance(origin, direction, ARENA_BOUNDS)
  if (boundaryHit !== null && boundaryHit > 0.02) distance = Math.min(distance, boundaryHit)
  return distance
}

function rayAabbDistance(origin: THREE.Vector3, direction: THREE.Vector3, box: Aabb): number | null {
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

function buildFallbackModel(): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0x252a31, metalness: 0.5, roughness: 0.55 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.55), material)
  body.renderOrder = 1000
  material.depthTest = false
  material.depthWrite = false
  group.add(body)
  return group
}

function disposeFallback(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const material = object.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
}
