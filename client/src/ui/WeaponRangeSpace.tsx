import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Crosshair, Gauge, Lock, RotateCcw, Star, Target, X } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  createGameplayModel,
  disposeGameplayModel,
  gameplayModelForWeapon,
  gameplayModelRotationY,
  type GameplayModelId,
} from '../render/gameplayAssets'
import { AudioManager } from '../audio/AudioManager'
import type { WeaponConfig } from '../game/weapons/config'

const RANGE_TARGET_Z = -16
const CAMERA_INSPECT = new THREE.Vector3(0, 1.65, 4.6)
const CAMERA_RANGE = new THREE.Vector3(0, 1.5, 3.2)
const LASER_WEAPON_ID = 7
const LASER_CHARGE_MAX_MS = 800
const LASER_CHARGE_MIN_MS = 150
const LOCAL_UP = new THREE.Vector3(0, 1, 0)

interface WeaponRangeSpaceProps {
  weapons: WeaponConfig[]
  onClose: () => void
}

export function WeaponRangeSpace({ weapons, onClose }: WeaponRangeSpaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState(weapons[0]?.id ?? 1)
  const [mode, setMode] = useState<'inspect' | 'range'>('inspect')
  const [hud, setHud] = useState({ ammo: 0, charge: 0, reloading: false, hitAtMs: 0 })
  const apiRef = useRef<{ selectWeapon: (id: number) => void; setMode: (mode: 'inspect' | 'range') => void } | null>(null)
  const weaponIdRef = useRef(selectedId)

  const weapon = useMemo(
    () => weapons.find((item) => item.id === selectedId) ?? weapons[0],
    [weapons, selectedId],
  )

  useEffect(() => {
    weaponIdRef.current = weapon?.id ?? selectedId
  }, [weapon, selectedId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let currentMode: 'inspect' | 'range' = 'inspect'
    let inspectModel: THREE.Group | null = null
    let rangeModel: THREE.Group | null = null
    let muzzleLocal: THREE.Vector3 | null = null
    let laserChargeGlow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null
    let laserChargeLight: THREE.PointLight | null = null
    let recoil = 0
    let lastShotAtMs = 0
    let reloadEndsAtMs = 0
    let ammo = 0
    let charge = 0
    let mouseDown = false
    let lastFrameMs = 0
    let loadToken = 0
    const beams: Array<{ mesh: THREE.Mesh; expiresAtMs: number; lifetimeMs: number }> = []
    const impacts: Array<{ mesh: THREE.Mesh; expiresAtMs: number }> = []
    const loadedModels: THREE.Group[] = []
    const resources: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = []
    const targetMeshes: THREE.Mesh[] = []

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'weapon-range-canvas'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x070a0c)
    scene.fog = new THREE.FogExp2(0x070a0c, 0.028)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80)
    camera.position.copy(CAMERA_INSPECT)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.15, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.enablePan = false
    controls.minDistance = 2.6
    controls.maxDistance = 8
    controls.maxPolarAngle = Math.PI * 0.55

    const hemi = new THREE.HemisphereLight(0xcad6df, 0x131719, 0.7)
    scene.add(hemi)
    const key = new THREE.SpotLight(0xf2f6ff, 420, 18, Math.PI / 5, 0.5, 1.3)
    key.position.set(-3.4, 5.2, 4.6)
    key.target.position.set(0, 1.1, -4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key, key.target)
    const rim = new THREE.SpotLight(0xb9e368, 260, 16, Math.PI / 5.5, 0.55, 1.25)
    rim.position.set(3.4, 4.2, -1.5)
    rim.target.position.set(0, 1.1, -8)
    scene.add(rim, rim.target)

    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x12181a, roughness: 0.82, metalness: 0.22 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    resources.push(floorMaterial, floor.geometry)

    const stand = new THREE.Group()
    scene.add(stand)
    const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2123, roughness: 0.4, metalness: 0.68 })
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 0.2, 40), pedestalMaterial)
    pedestal.position.y = 0.1
    pedestal.castShadow = true
    pedestal.receiveShadow = true
    stand.add(pedestal)
    resources.push(pedestalMaterial, pedestal.geometry)

    const targetTexture = createTargetTexture()
    resources.push(targetTexture)
    const boardMaterial = new THREE.MeshStandardMaterial({ map: targetTexture, roughness: 0.72 })
    resources.push(boardMaterial)
    for (let i = 0; i < 3; i += 1) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0), boardMaterial)
      board.position.set(-3.4 + i * 3.4, 1.55, RANGE_TARGET_Z)
      board.receiveShadow = true
      scene.add(board)
      targetMeshes.push(board)
    }

    const viewModel = new THREE.Group()
    scene.add(viewModel)

    const currentWeapon = (): WeaponConfig =>
      weapons.find((item) => item.id === weaponIdRef.current) ?? weapons[0]

    const loadWeapon = async (id: number): Promise<void> => {
      const token = ++loadToken
      if (inspectModel) {
        stand.remove(inspectModel)
        disposeGameplayModel(inspectModel)
      }
      if (rangeModel) {
        viewModel.remove(rangeModel)
        disposeGameplayModel(rangeModel)
      }
      inspectModel = null
      rangeModel = null
      muzzleLocal = null
      const modelId = gameplayModelForWeapon(id)
      try {
        const [inspectInstance, rangeInstance] = await Promise.all([
          createGameplayModel(modelId),
          createGameplayModel(modelId),
        ])
        if (disposed) {
          disposeGameplayModel(inspectInstance)
          disposeGameplayModel(rangeInstance)
          return
        }
        if (token !== loadToken) {
          // 已有更新的切换请求，丢弃本次结果，避免新旧模型叠放。
          disposeGameplayModel(inspectInstance)
          disposeGameplayModel(rangeInstance)
          return
        }
        loadedModels.push(inspectInstance, rangeInstance)
        configureInspectModel(inspectInstance, modelId)
        stand.add(inspectInstance)
        inspectModel = inspectInstance

        configureRangeModel(rangeInstance, modelId)
        viewModel.add(rangeInstance)
        rangeModel = rangeInstance
        viewModel.updateMatrixWorld(true)
        muzzleLocal = computeMuzzleLocal(rangeInstance, viewModel)

        ammo = currentWeapon().ammo
        charge = 0
        reloadEndsAtMs = 0
        lastShotAtMs = 0
        removeLaserCharge()
      } catch (error) {
        console.warn(`[range] Failed to load ${modelId}`, error)
      }
    }

    const applyMode = (next: 'inspect' | 'range'): void => {
      currentMode = next
      if (next === 'inspect') {
        controls.enabled = true
        camera.position.copy(CAMERA_INSPECT)
        controls.target.set(0, 1.15, 0)
        stand.visible = true
        viewModel.visible = false
        removeLaserCharge()
      } else {
        controls.enabled = false
        camera.position.copy(CAMERA_RANGE)
        camera.rotation.set(0, 0, 0)
        stand.visible = false
        viewModel.visible = true
        if (!rangeModel) void loadWeapon(weaponIdRef.current)
      }
    }

    apiRef.current = {
      selectWeapon: (id) => void loadWeapon(id),
      setMode: applyMode,
    }

    const audio = new AudioManager()
    const spawnBeam = (weaponId: number): void => {
      viewModel.updateMatrixWorld(true)
      const muzzle = viewModel.localToWorld(
        (muzzleLocal ?? new THREE.Vector3(0.26, -0.32, -0.62)).clone(),
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const hits = raycaster.intersectObjects(targetMeshes, false)
      const end = hits.length > 0
        ? hits[0].point.clone()
        : camera.position.clone().addScaledVector(raycaster.ray.direction, 60)

      const addBeam = (radius: number, color: number, opacity: number, lifetimeMs: number): void => {
        const segment = end.clone().sub(muzzle)
        const length = segment.length()
        if (length < 0.05) return
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
        mesh.quaternion.setFromUnitVectors(LOCAL_UP, segment.normalize())
        mesh.renderOrder = 4
        scene.add(mesh)
        beams.push({ mesh, expiresAtMs: performance.now() + lifetimeMs, lifetimeMs })
        resources.push(geometry, material)
      }

      if (weaponId === LASER_WEAPON_ID) {
        addBeam(0.045, 0x66e0ff, 0.35, 180)
        addBeam(0.016, 0xd8fbff, 0.95, 180)
      } else {
        addBeam(0.013, 0xffe08a, 0.9, 80)
      }

      if (hits.length > 0) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.12, 0.2, 28),
          new THREE.MeshBasicMaterial({
            color: 0xffd166,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        )
        ring.position.copy(hits[0].point).add(new THREE.Vector3(0, 0, 0.02))
        ring.renderOrder = 5
        scene.add(ring)
        impacts.push({ mesh: ring, expiresAtMs: performance.now() + 360 })
        resources.push(ring.geometry, (ring.material as THREE.Material))
        setHud((prev) => ({ ...prev, hitAtMs: performance.now() }))
      }

      const flash = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.26, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: weaponId === LASER_WEAPON_ID ? 0x7df3ff : 0xffb21c,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      const direction = raycaster.ray.direction
      flash.position.copy(muzzle).addScaledVector(direction, 0.12)
      flash.quaternion.setFromUnitVectors(LOCAL_UP, direction)
      flash.renderOrder = 5
      scene.add(flash)
      impacts.push({ mesh: flash, expiresAtMs: performance.now() + 120 })
      resources.push(flash.geometry, (flash.material as THREE.Material))
    }

    const fireOnce = (): void => {
      const spec = currentWeapon()
      const now = performance.now()
      if (ammo <= 0 || now < reloadEndsAtMs || now < lastShotAtMs) return
      if (spec.id === LASER_WEAPON_ID && charge < LASER_CHARGE_MIN_MS / LASER_CHARGE_MAX_MS) return
      ammo -= 1
      lastShotAtMs = now + 60_000 / spec.fireRatePerMin
      recoil = 1
      audio.init()
      audio.play({ type: 'shot', weaponId: spec.id, local: true })
      spawnBeam(spec.id)
      if (ammo === 0) {
        reloadEndsAtMs = now + spec.reloadMs
        audio.play({ type: 'reload', local: true })
      }
    }

    const updateLaserCharge = (dt: number): void => {
      const spec = currentWeapon()
      const now = performance.now()
      if (spec.id !== LASER_WEAPON_ID) {
        charge = 0
        removeLaserCharge()
        return
      }
      if (mouseDown && ammo > 0 && now >= reloadEndsAtMs) {
        charge = Math.min(1, charge + dt / (LASER_CHARGE_MAX_MS / 1000))
      } else if (!mouseDown) {
        if (charge >= LASER_CHARGE_MIN_MS / LASER_CHARGE_MAX_MS) fireOnce()
        charge = 0
      }

      if (charge > 0) {
        viewModel.updateMatrixWorld(true)
        const muzzle = viewModel.localToWorld(
          (muzzleLocal ?? new THREE.Vector3(0.26, -0.32, -0.62)).clone(),
        )
        if (!laserChargeGlow) {
          const material = new THREE.MeshBasicMaterial({
            color: 0x66e0ff,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
          laserChargeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), material)
          laserChargeGlow.renderOrder = 6
          laserChargeLight = new THREE.PointLight(0x66e0ff, 0, 4, 2)
          scene.add(laserChargeGlow, laserChargeLight)
          resources.push(laserChargeGlow.geometry, material)
        }
        const pulse = 1 + Math.sin(now * 0.02) * 0.08
        const glow = laserChargeGlow
        const light = laserChargeLight
        if (!glow || !light) return
        glow.position.copy(muzzle)
        glow.scale.setScalar((0.06 + charge * 0.16) * pulse)
        glow.material.opacity = 0.35 + charge * 0.5
        glow.material.color.setHSL(0.55, 0.9, 0.45 + charge * 0.35)
        light.position.copy(muzzle)
        light.intensity = charge * 3.5
      } else {
        removeLaserCharge()
      }
    }

    const removeLaserCharge = (): void => {
      if (laserChargeGlow) {
        scene.remove(laserChargeGlow)
        laserChargeGlow = null
      }
      if (laserChargeLight) {
        scene.remove(laserChargeLight)
        laserChargeLight = null
      }
    }

    const onMouseDown = (event: MouseEvent): void => {
      if (currentMode !== 'range') return
      event.preventDefault()
      audio.init()
      mouseDown = true
      const spec = currentWeapon()
      if (!spec.automatic && spec.id !== LASER_WEAPON_ID) fireOnce()
    }
    const onMouseUp = (): void => {
      mouseDown = false
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (currentMode !== 'range') return
      if (event.code === 'KeyR') {
        const spec = currentWeapon()
        const now = performance.now()
        if (ammo < spec.ammo && now >= reloadEndsAtMs) {
          reloadEndsAtMs = now + spec.reloadMs
          audio.init()
          audio.play({ type: 'reload', local: true })
        }
      }
    }
    renderer.domElement.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)

    const resize = (): void => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const hudTimer = window.setInterval(() => {
      setHud((prev) => ({
        ammo,
        charge,
        reloading: reloadEndsAtMs > performance.now(),
        hitAtMs: prev.hitAtMs,
      }))
    }, 100)

    renderer.setAnimationLoop(() => {
      const now = performance.now()
      const dt = lastFrameMs > 0 ? Math.min((now - lastFrameMs) / 1000, 0.1) : 0
      lastFrameMs = now

      if (currentMode === 'range') {
        camera.position.copy(CAMERA_RANGE)
        camera.rotation.set(recoil * 0.022, 0, 0)
        viewModel.position.copy(camera.position)
        viewModel.quaternion.copy(camera.quaternion)
        viewModel.translateX(0.26)
        viewModel.translateY(-0.32)
        viewModel.translateZ(-0.62)
        recoil *= Math.exp(-dt * 12)

        const spec = currentWeapon()
        if (spec.automatic && mouseDown) fireOnce()
        updateLaserCharge(dt)

        if (reloadEndsAtMs > 0 && now >= reloadEndsAtMs) {
          ammo = spec.ammo
          reloadEndsAtMs = 0
        }
      }

      for (let i = beams.length - 1; i >= 0; i -= 1) {
        const beam = beams[i]
        const remaining = beam.expiresAtMs - now
        const material = beam.mesh.material as THREE.MeshBasicMaterial
        material.opacity = Math.max(0, Math.min(1, remaining / beam.lifetimeMs))
        if (remaining <= 0) {
          scene.remove(beam.mesh)
          beams.splice(i, 1)
        }
      }
      for (let i = impacts.length - 1; i >= 0; i -= 1) {
        const impact = impacts[i]
        const remaining = impact.expiresAtMs - now
        const material = impact.mesh.material as THREE.Material
        if ('opacity' in material) {
          ;(material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, remaining / 360))
        }
        impact.mesh.scale.setScalar(1 + Math.max(0, remaining / 360) * 0.6)
        if (remaining <= 0) {
          scene.remove(impact.mesh)
          impacts.splice(i, 1)
        }
      }

      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      loadToken += 1
      observer.disconnect()
      window.clearInterval(hudTimer)
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      renderer.setAnimationLoop(null)
      controls.dispose()
      for (const model of loadedModels) {
        model.removeFromParent()
        disposeGameplayModel(model)
      }
      for (const resource of resources) resource.dispose()
      for (const beam of beams) scene.remove(beam.mesh)
      for (const impact of impacts) scene.remove(impact.mesh)
      if (laserChargeGlow) scene.remove(laserChargeGlow)
      if (laserChargeLight) scene.remove(laserChargeLight)
      renderer.dispose()
      renderer.domElement.remove()
      apiRef.current = null
    }
  }, [weapons])

  useEffect(() => {
    apiRef.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    apiRef.current?.selectWeapon(selectedId)
  }, [selectedId])

  if (!weapon) return null

  const hitActive = performance.now() - hud.hitAtMs < 220

  return (
    <div className="weapon-range-screen">
      <div ref={containerRef} className="weapon-range-viewport" />
      <div className="weapon-range-shade" aria-hidden="true" />

      <header className="weapon-range-header">
        <div>
          <span className="weapon-range-kicker">TACTICAL RANGE</span>
          <h1>战术靶场</h1>
          <p>检视与试射武器 · 等级与配件系统开发中</p>
        </div>
        <div className="weapon-range-mode-switch">
          <button className={mode === 'inspect' ? 'active' : ''} onClick={() => setMode('inspect')}>
            <Gauge size={16} />检视
          </button>
          <button className={mode === 'range' ? 'active' : ''} onClick={() => setMode('range')}>
            <Target size={16} />试射
          </button>
        </div>
        <button className="weapon-range-close" onClick={onClose} aria-label="返回大厅" title="返回大厅">
          <X size={20} />
        </button>
      </header>

      <aside className="weapon-range-list">
        <div className="weapon-range-list-title">武器库</div>
        {weapons.map((item) => (
          <button
            key={item.id}
            className={item.id === selectedId ? 'weapon-range-item active' : 'weapon-range-item'}
            onClick={() => setSelectedId(item.id)}
          >
            <span className="weapon-range-item-mark">{String(item.id).padStart(2, '0')}</span>
            <span className="weapon-range-item-copy">
              <strong>{item.displayName}</strong>
              <small>{item.category.toUpperCase()} · {item.damage} DMG</small>
            </span>
            <em>{item.id === selectedId ? '使用中' : '选择'}</em>
          </button>
        ))}
      </aside>

      <aside className="weapon-range-panel">
        <div className="weapon-range-panel-title">
          <Crosshair size={16} />
          <span>{weapon.displayName}</span>
        </div>
        <div className="weapon-range-stats">
          <div><span>类别</span><strong>{weapon.category.toUpperCase()}</strong></div>
          <div><span>伤害</span><strong>{weapon.damage}</strong></div>
          <div><span>射速</span><strong>{weapon.fireRatePerMin} RPM</strong></div>
          <div><span>弹匣</span><strong>{weapon.ammo} / {weapon.reserve}</strong></div>
          <div><span>换弹</span><strong>{(weapon.reloadMs / 1000).toFixed(1)}s</strong></div>
          <div><span>射程</span><strong>{weapon.maxRangeM}m</strong></div>
          <div><span>穿透</span><strong>{weapon.penetrationPower}</strong></div>
          <div><span>护甲比</span><strong>{weapon.armorDamageRatio / 10}%</strong></div>
        </div>

        <div className="weapon-range-upgrade">
          <div className="weapon-range-level">
            <Star size={15} />
            <span>枪械等级</span>
            <strong>LV.1</strong>
            <em>0 / 100 EXP</em>
          </div>
          <div className="weapon-range-xp"><i style={{ width: '0%' }} /></div>
          <div className="weapon-range-attachments">
            {['瞄具', '枪口', '弹匣', '握把'].map((slot) => (
              <div key={slot} className="weapon-range-attachment">
                <Lock size={13} />
                <span>{slot}</span>
                <em>未解锁</em>
              </div>
            ))}
          </div>
          <p className="weapon-range-note">枪械等级与配件系统开发中，先占位。</p>
        </div>

        <div className="weapon-range-actions">
          <button className="weapon-range-reset" onClick={() => apiRef.current?.setMode('inspect')}>
            <RotateCcw size={15} />重置视角
          </button>
          <button
            className="weapon-range-fire"
            onClick={() => setMode('range')}
          >
            <Target size={15} />进入试射
          </button>
        </div>
      </aside>

      {mode === 'range' && (
        <div className="weapon-range-hud">
          <div className={`weapon-range-crosshair ${hitActive ? 'hit' : ''}`}>
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="weapon-range-ammo">
            <strong>{hud.ammo}</strong>
            <span>/{weapon.ammo}</span>
            <em>{hud.reloading ? '换弹中…' : 'R 换弹'}</em>
          </div>
          {weapon.id === LASER_WEAPON_ID && (
            <div className="weapon-range-charge">
              <div><i style={{ width: `${Math.round(hud.charge * 100)}%` }} /></div>
              <span>{hud.charge >= 1 ? '充能完毕' : hud.charge > 0 ? '蓄力中' : '按住蓄力，松手发射'}</span>
            </div>
          )}
          <button className="weapon-range-exit-range" onClick={() => setMode('inspect')}>
            <ArrowLeft size={15} />退出试射
          </button>
        </div>
      )}
    </div>
  )
}

function configureInspectModel(model: THREE.Group, id: GameplayModelId): void {
  model.scale.setScalar(0.92)
  model.rotation.set(0, firstPersonRotationY(id), 0)
  model.position.set(0, 1.14, 0)
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.castShadow = true
    object.receiveShadow = true
  })
}

function configureRangeModel(model: THREE.Group, id: GameplayModelId): void {
  model.scale.setScalar(0.78)
  model.rotation.set(0, firstPersonRotationY(id), 0)
  model.position.set(0, 0, 0)
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
}

function firstPersonRotationY(id: GameplayModelId): number {
  if (id === 'pinkM4') return -Math.PI / 2
  if (id === 'sniper') return Math.PI / 2
  return gameplayModelRotationY(id)
}

function computeMuzzleLocal(model: THREE.Group, parent: THREE.Group): THREE.Vector3 | null {
  model.updateMatrixWorld(true)
  let best: THREE.Vector3 | null = null
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const positions = object.geometry.attributes.position
    if (!positions) return
    const vertex = new THREE.Vector3()
    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
      if (!best || vertex.z < best.z) best = vertex.clone()
    }
  })
  if (!best) return null
  parent.updateMatrixWorld(true)
  return parent.worldToLocal(best)
}

function createTargetTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#1d2426'
    ctx.fillRect(0, 0, size, size)
    const rings = [
      { r: 118, color: '#e8edf0' },
      { r: 96, color: '#2a3134' },
      { r: 74, color: '#e8edf0' },
      { r: 52, color: '#2a3134' },
      { r: 30, color: '#ef7d18' },
      { r: 12, color: '#ffd166' },
    ]
    for (const ring of rings) {
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, ring.r, 0, Math.PI * 2)
      ctx.fillStyle = ring.color
      ctx.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
