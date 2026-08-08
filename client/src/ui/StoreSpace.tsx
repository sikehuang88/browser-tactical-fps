import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Coins, PackageOpen, ShoppingCart, X } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createGameplayModel, disposeGameplayModel, gameplayModelRotationY, type GameplayModelId } from '../render/gameplayAssets'
import { TracerShop } from './TracerShop'

export interface StoreDisplayItem {
  id: string
  title: string
  kind: string
  price: number
  owned?: boolean
  modelId?: GameplayModelId
}

interface StoreSpaceProps {
  items: StoreDisplayItem[]
  credits: number
  ownedItems: string[]
  onBuy: (item: StoreDisplayItem) => void
  onClose: () => void
}

interface ProductDisplay {
  root: THREE.Group
  product: THREE.Group
  ringMaterial: THREE.MeshStandardMaterial
  plinthMaterial: THREE.MeshStandardMaterial
}

const DISPLAY_POSITIONS = [
  new THREE.Vector3(-4.8, 0, -1.0),
  new THREE.Vector3(-2.88, 0, -1.35),
  new THREE.Vector3(-0.96, 0, -1.55),
  new THREE.Vector3(0.96, 0, -1.55),
  new THREE.Vector3(2.88, 0, -1.35),
  new THREE.Vector3(4.8, 0, -1.0),
]

function disposeStandaloneAsset(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}

export function StoreSpace({ items, credits, ownedItems, onBuy, onClose }: StoreSpaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const displaysRef = useRef(new Map<string, ProductDisplay>())
  const selectedIdRef = useRef(items[2]?.id ?? items[0]?.id ?? '')
  const ownedItemsRef = useRef(ownedItems)
  const onCloseRef = useRef(onClose)
  const [selectedId, setSelectedId] = useState(selectedIdRef.current)
  const [loading, setLoading] = useState(true)
  const [previewWeapon, setPreviewWeapon] = useState<{ item: StoreDisplayItem; modelId: GameplayModelId } | null>(null)
  const [tracerShopOpen, setTracerShopOpen] = useState(false)

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId],
  )
  const selectedOwned = selectedItem ? ownedItems.includes(selectedItem.id) : false
  const canBuy = Boolean(selectedItem) && !selectedOwned && credits >= selectedItem.price

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    ownedItemsRef.current = ownedItems
  }, [ownedItems])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let dragged = false
    let pointerDown = false
    let startX = 0
    let startY = 0
    let hoveredId = ''
    const resources: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = []
    const loadedModels: THREE.Object3D[] = []
    let storePropAsset: THREE.Object3D | null = null
    const interactiveMeshes: THREE.Object3D[] = []
    const displays = displaysRef.current
    displays.clear()

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'store-space-canvas'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x070a0c)
    scene.fog = new THREE.FogExp2(0x070a0c, 0.035)

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 60)
    camera.position.set(0, 2.35, 8.4)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.05, -0.9)
    controls.enableDamping = true
    controls.dampingFactor = 0.055
    controls.enablePan = false
    controls.minDistance = 5.7
    controls.maxDistance = 9.6
    controls.minPolarAngle = 1.03
    controls.maxPolarAngle = 1.48
    controls.minAzimuthAngle = -0.72
    controls.maxAzimuthAngle = 0.72

    const targetGoal = controls.target.clone()
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const makeStandard = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
      const material = new THREE.MeshStandardMaterial(parameters)
      resources.push(material)
      return material
    }
    const makeGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
      resources.push(geometry)
      return geometry
    }
    const addBox = (
      size: [number, number, number],
      position: [number, number, number],
      material: THREE.Material,
      castShadow = true,
    ): THREE.Mesh => {
      const geometry = makeGeometry(new THREE.BoxGeometry(...size))
      const uv = geometry.getAttribute('uv')
      if (uv && !geometry.getAttribute('uv2')) geometry.setAttribute('uv2', uv.clone())
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(...position)
      mesh.castShadow = castShadow
      mesh.receiveShadow = true
      scene.add(mesh)
      return mesh
    }

    const storeLoader = new GLTFLoader()
    const storeDraco = new DRACOLoader()
    storeDraco.setDecoderPath('/draco/gltf/')
    storeLoader.setDRACOLoader(storeDraco)

    const textureLoader = new THREE.TextureLoader()
    const configureTexture = (texture: THREE.Texture, colorTexture = false): THREE.Texture => {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(2.2, 2.2)
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8)
      if (colorTexture) texture.colorSpace = THREE.SRGBColorSpace
      resources.push(texture)
      return texture
    }
    const pbrColor = configureTexture(textureLoader.load('/assets/store/pbr/base-color.png'), true)
    const pbrRoughness = configureTexture(textureLoader.load('/assets/store/pbr/roughness.png'))
    const pbrMetallic = configureTexture(textureLoader.load('/assets/store/pbr/metallic.png'))
    const pbrNormal = configureTexture(textureLoader.load('/assets/store/pbr/normal.png'))
    const pbrHeight = configureTexture(textureLoader.load('/assets/store/pbr/height.png'))
    const pbrAo = configureTexture(textureLoader.load('/assets/store/pbr/ao.png'))

    const concrete = makeStandard({
      color: 0xffffff,
      map: pbrColor,
      roughness: 0.82,
      roughnessMap: pbrRoughness,
      metalness: 0.62,
      metalnessMap: pbrMetallic,
      normalMap: pbrNormal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      bumpMap: pbrHeight,
      bumpScale: 0.035,
      aoMap: pbrAo,
      aoMapIntensity: 0.82,
    })
    const darkMetal = makeStandard({ color: 0x111719, roughness: 0.48, metalness: 0.72 })
    const trimMetal = makeStandard({ color: 0x3a4242, roughness: 0.38, metalness: 0.82 })
    const greenEmissive = makeStandard({ color: 0x789b3f, emissive: 0x2d420d, emissiveIntensity: 1.5, roughness: 0.36, metalness: 0.2 })

    addBox([16, 0.24, 16], [0, -0.12, -1], concrete, false)
    addBox([16, 6.5, 0.32], [0, 3.1, -5.2], concrete, false)
    addBox([0.32, 6.5, 12], [-7.6, 3.1, 0], concrete, false)
    addBox([0.32, 6.5, 12], [7.6, 3.1, 0], concrete, false)
    addBox([16, 0.18, 12], [0, 6.25, 0], darkMetal, false)

    for (let x = -6.6; x <= 6.6; x += 1.2) {
      addBox([0.035, 0.012, 13], [x, 0.018, -0.4], trimMetal, false)
    }
    for (let z = -4.4; z <= 5.2; z += 1.2) {
      addBox([15, 0.012, 0.035], [0, 0.02, z], trimMetal, false)
    }

    addBox([11.8, 0.16, 0.3], [0, 4.9, -4.98], darkMetal, false)
    for (let x = -5.4; x <= 5.4; x += 1.8) {
      addBox([0.06, 4.8, 0.08], [x, 2.42, -4.78], trimMetal, false)
      addBox([1.45, 0.035, 0.11], [x, 3.72, -4.7], greenEmissive, false)
    }

    const counter = addBox([4.8, 1.08, 1.05], [0, 0.54, -4.25], darkMetal)
    counter.geometry.translate(0, 0, 0)
    addBox([5.1, 0.12, 1.22], [0, 1.12, -4.25], trimMetal)
    addBox([2.2, 0.02, 0.03], [0, 0.72, -3.7], greenEmissive, false)

    const normalizeStoreProp = (root: THREE.Group): THREE.Group => {
      root.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(root)
      const size = bounds.getSize(new THREE.Vector3())
      const longest = Math.max(size.x, size.y, size.z, 0.001)
      const scale = 4.9 / longest
      root.scale.setScalar(scale)
      root.updateMatrixWorld(true)
      const scaledBounds = new THREE.Box3().setFromObject(root)
      root.position.set(-scaledBounds.getCenter(new THREE.Vector3()).x, -scaledBounds.min.y, -4.0 - scaledBounds.max.z)
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.castShadow = true
        object.receiveShadow = true
        if (Array.isArray(object.material)) object.material.forEach((material) => { material.needsUpdate = true })
        else object.material.needsUpdate = true
      })
      return root
    }

    const storePropGroup = new THREE.Group()
    storePropGroup.position.set(0, 0, 0)
    storePropGroup.visible = false
    scene.add(storePropGroup)

    void storeLoader.loadAsync('/assets/store/商店军械台.glb')
      .then(({ scene: asset }) => {
        if (disposed) {
          disposeStandaloneAsset(asset)
          return
        }
        const normalized = normalizeStoreProp(asset)
        storePropGroup.add(normalized)
        storePropGroup.visible = true
        counter.visible = false
        storePropAsset = asset
      })
      .catch(() => {
        storePropGroup.visible = false
      })

    const ceilingTracks = [-2.9, 0, 2.9]
    for (const x of ceilingTracks) {
      addBox([0.18, 0.18, 7.6], [x, 5.75, -0.6], darkMetal, false)
      for (const z of [-3.3, -1.1, 1.2]) {
        const fixture = addBox([0.48, 0.22, 0.68], [x, 5.55, z], trimMetal, false)
        fixture.rotation.x = 0.08
      }
    }

    const ambient = new THREE.HemisphereLight(0xb6c5c8, 0x111617, 0.78)
    const frontFill = new THREE.DirectionalLight(0xb8c8ce, 1.4)
    frontFill.position.set(0, 4, 7)
    scene.add(ambient, frontFill)

    const key = new THREE.SpotLight(0xe9f1df, 180, 18, Math.PI / 5.5, 0.62, 1.6)
    key.position.set(-3.8, 5.4, 3.8)
    key.target.position.set(-1.2, 0.8, -1.2)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key, key.target)

    const rim = new THREE.SpotLight(0xb9e368, 140, 16, Math.PI / 6, 0.7, 1.4)
    rim.position.set(4.4, 5.2, -0.4)
    rim.target.position.set(1.2, 0.7, -1.5)
    rim.castShadow = true
    rim.shadow.mapSize.set(768, 768)
    scene.add(rim, rim.target)

    const warm = new THREE.PointLight(0xe29b57, 32, 9, 1.8)
    warm.position.set(0, 1.8, -4.3)
    scene.add(warm)

    const createLabelSprite = (title: string, subtitle: string): THREE.Sprite => {
      const canvas = document.createElement('canvas')
      canvas.width = 768
      canvas.height = 192
      const context = canvas.getContext('2d')
      if (context) {
        context.fillStyle = 'rgba(6, 10, 11, 0.94)'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.strokeStyle = '#708746'
        context.lineWidth = 5
        context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
        context.fillStyle = '#eef2ef'
        context.font = '700 48px "Microsoft YaHei", sans-serif'
        context.fillText(title, 38, 78)
        context.fillStyle = '#9aa59f'
        context.font = '30px "Microsoft YaHei", sans-serif'
        context.fillText(subtitle, 38, 137)
      }
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      resources.push(texture)
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
      resources.push(material)
      const sprite = new THREE.Sprite(material)
      sprite.scale.set(1.7, 0.425, 1)
      return sprite
    }

    const createCrateProduct = (): THREE.Group => {
      const group = new THREE.Group()
      const body = new THREE.Mesh(makeGeometry(new THREE.BoxGeometry(1.1, 0.72, 0.78)), darkMetal)
      body.castShadow = true
      group.add(body)
      for (const x of [-0.46, 0.46]) {
        const rail = new THREE.Mesh(makeGeometry(new THREE.BoxGeometry(0.1, 0.82, 0.88)), trimMetal)
        rail.position.x = x
        group.add(rail)
      }
      const vialMaterial = makeStandard({ color: 0xb9e368, emissive: 0x6d9c1f, emissiveIntensity: 2.2, roughness: 0.18 })
      for (const x of [-0.24, 0, 0.24]) {
        const vial = new THREE.Mesh(makeGeometry(new THREE.CylinderGeometry(0.075, 0.075, 0.48, 16)), vialMaterial)
        vial.position.set(x, 0.52, 0)
        vial.castShadow = true
        group.add(vial)
      }
      return group
    }

    const createPassProduct = (): THREE.Group => {
      const group = new THREE.Group()
      const cardMaterial = makeStandard({ color: 0x222b2d, roughness: 0.28, metalness: 0.72 })
      const card = new THREE.Mesh(makeGeometry(new THREE.BoxGeometry(1.1, 0.68, 0.08)), cardMaterial)
      card.rotation.y = -0.18
      card.rotation.x = -0.08
      card.castShadow = true
      group.add(card)
      const strip = new THREE.Mesh(makeGeometry(new THREE.BoxGeometry(0.82, 0.12, 0.03)), greenEmissive)
      strip.position.set(0, -0.12, 0.055)
      card.add(strip)
      const chip = new THREE.Mesh(makeGeometry(new THREE.BoxGeometry(0.22, 0.18, 0.03)), trimMetal)
      chip.position.set(-0.3, 0.13, 0.055)
      card.add(chip)
      return group
    }

    const createBadgeProduct = (): THREE.Group => {
      const group = new THREE.Group()
      const shape = new THREE.Shape()
      shape.moveTo(0, 0.7)
      shape.lineTo(0.55, 0.42)
      shape.lineTo(0.45, -0.35)
      shape.lineTo(0, -0.75)
      shape.lineTo(-0.45, -0.35)
      shape.lineTo(-0.55, 0.42)
      shape.closePath()
      const geometry = makeGeometry(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2 }))
      geometry.center()
      const badgeMaterial = makeStandard({ color: 0xb5914c, roughness: 0.25, metalness: 0.88 })
      const badge = new THREE.Mesh(geometry, badgeMaterial)
      badge.castShadow = true
      badge.rotation.y = -0.2
      group.add(badge)
      const center = new THREE.Mesh(makeGeometry(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24)), greenEmissive)
      center.rotation.x = Math.PI / 2
      center.position.z = 0.12
      group.add(center)
      return group
    }

    items.forEach((item, index) => {
      const position = DISPLAY_POSITIONS[index] ?? new THREE.Vector3((index - 1.5) * 2.1, 0, -1.1)
      const root = new THREE.Group()
      root.position.copy(position)
      root.userData.storeItemId = item.id
      scene.add(root)

      const plinthMaterial = makeStandard({ color: 0x1a2123, roughness: 0.46, metalness: 0.62, emissive: 0x000000 })
      const plinth = new THREE.Mesh(makeGeometry(new THREE.CylinderGeometry(0.88, 1.05, 0.68, 8)), plinthMaterial)
      plinth.position.y = 0.34
      plinth.castShadow = true
      plinth.receiveShadow = true
      plinth.userData.storeItemId = item.id
      root.add(plinth)

      const ringMaterial = makeStandard({ color: 0x7b914a, emissive: 0x354810, emissiveIntensity: 1.2, roughness: 0.32, metalness: 0.5 })
      const ring = new THREE.Mesh(makeGeometry(new THREE.TorusGeometry(0.68, 0.025, 8, 48)), ringMaterial)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.7
      ring.userData.storeItemId = item.id
      root.add(ring)

      const product = new THREE.Group()
      product.position.y = 1.42
      product.userData.storeItemId = item.id
      root.add(product)
      const procedural = item.id === 'boost-xp'
        ? createCrateProduct()
        : item.id === 'slot-token'
          ? createPassProduct()
          : item.id === 'founder-badge'
            ? createBadgeProduct()
            : new THREE.Group()
      product.add(procedural)

      const label = createLabelSprite(item.title, item.price === 0 ? '已列装' : `${item.price.toLocaleString()} 战备点`)
      label.position.set(0, 0.92, 0)
      label.userData.storeItemId = item.id
      root.add(label)

      root.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) interactiveMeshes.push(object)
      })
      displays.set(item.id, { root, product, ringMaterial, plinthMaterial })
    })

    const attachModel = async (itemId: string, modelId: GameplayModelId, scale: number, rotation: [number, number, number]): Promise<void> => {
      try {
        const model = await createGameplayModel(modelId)
        if (disposed) {
          disposeGameplayModel(model)
          return
        }
        const display = displays.get(itemId)
        if (!display) {
          disposeGameplayModel(model)
          return
        }
        model.scale.setScalar(scale)
        model.rotation.set(rotation[0], gameplayModelRotationY(modelId), rotation[2])
        model.position.y = 0.08
        model.userData.storeItemId = itemId
        model.traverse((object) => {
          object.userData.storeItemId = itemId
          if (object instanceof THREE.Mesh) interactiveMeshes.push(object)
        })
        display.product.add(model)
        loadedModels.push(model)
      } catch (error) {
        console.warn(`[store] Failed to load ${modelId} for ${itemId}`, error)
        // Keep the shop usable if an optional model fails to load.
      }
    }

    const addWallModel = async (modelId: GameplayModelId, position: [number, number, number], scale: number, rotation: [number, number, number]): Promise<void> => {
      try {
        const model = await createGameplayModel(modelId)
        if (disposed) {
          disposeGameplayModel(model)
          return
        }
        model.position.set(...position)
        model.scale.setScalar(scale)
        model.rotation.set(rotation[0], gameplayModelRotationY(modelId), rotation[2])
        scene.add(model)
        loadedModels.push(model)
      } catch {
        // The room remains complete without optional wall inventory.
      }
    }

    void Promise.all([
      ...items
        .filter((item): item is StoreDisplayItem & { modelId: GameplayModelId } => Boolean(item.modelId))
        .map((item) => attachModel(item.id, item.modelId, item.modelId === 'laserCannon' ? 2.35 : 2.22, [0.05, -0.28, 0.08])),
      addWallModel('pistol', [-3.1, 3.08, -4.48], 1.15, [0.08, 0.06, -0.08]),
      addWallModel('knife', [0, 3.05, -4.48], 1.25, [0.04, 0.1, -0.42]),
      addWallModel('rifle', [3.1, 3.08, -4.48], 1.7, [0.05, -0.05, 0.05]),
    ]).finally(() => {
      if (!disposed) setLoading(false)
    })

    const resolveItemId = (object: THREE.Object3D | null): string => {
      let current = object
      while (current) {
        if (typeof current.userData.storeItemId === 'string') return current.userData.storeItemId
        current = current.parent
      }
      return ''
    }

    const updatePointer = (event: PointerEvent): void => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    const pickItem = (event: PointerEvent): string => {
      updatePointer(event)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(interactiveMeshes, true)[0]
      return resolveItemId(hit?.object ?? null)
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (pointerDown && Math.hypot(event.clientX - startX, event.clientY - startY) > 5) dragged = true
      hoveredId = pickItem(event)
      renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'grab'
    }
    const handlePointerDown = (event: PointerEvent): void => {
      pointerDown = true
      dragged = false
      startX = event.clientX
      startY = event.clientY
      renderer.domElement.style.cursor = 'grabbing'
    }
    const handlePointerUp = (event: PointerEvent): void => {
      pointerDown = false
      renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'grab'
      if (dragged) return
      const itemId = pickItem(event)
      if (!itemId) return
      const display = displays.get(itemId)
      if (!display) return
      setSelectedId(itemId)
      targetGoal.set(display.root.position.x * 0.42, 1.15, display.root.position.z)
    }
    const handlePointerLeave = (): void => {
      pointerDown = false
      hoveredId = ''
      renderer.domElement.style.cursor = 'grab'
    }
    const handleDoubleClick = (event: MouseEvent): void => {
      const itemId = pickItem(event as unknown as PointerEvent)
      const item = items.find((entry) => entry.id === itemId)
      if (item?.modelId) setPreviewWeapon({ item, modelId: item.modelId })
    }
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('dblclick', handleDoubleClick)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const currentIndex = Math.max(0, items.findIndex((item) => item.id === selectedIdRef.current))
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const nextIndex = (currentIndex + direction + items.length) % items.length
      const next = items[nextIndex]
      const display = displays.get(next.id)
      setSelectedId(next.id)
      if (display) targetGoal.set(display.root.position.x * 0.42, 1.15, display.root.position.z)
    }
    window.addEventListener('keydown', handleKeyDown)

    const resize = (): void => {
      const { width, height } = container.getBoundingClientRect()
      const safeWidth = Math.max(1, width)
      const safeHeight = Math.max(1, height)
      renderer.setSize(safeWidth, safeHeight, false)
      camera.aspect = safeWidth / safeHeight
      camera.fov = safeWidth / safeHeight < 1 ? 68 : 52
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const clock = new THREE.Clock()
    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime()
      controls.target.lerp(targetGoal, 0.055)
      controls.update()
      displays.forEach((display, id) => {
        const selected = id === selectedIdRef.current
        const hovered = id === hoveredId
        const owned = ownedItemsRef.current.includes(id)
        display.product.rotation.y += selected ? 0.0042 : 0.0018
        display.product.position.y = 1.42 + Math.sin(elapsed * 1.45 + display.root.position.x) * (selected ? 0.055 : 0.022)
        display.ringMaterial.emissiveIntensity = selected ? 3.2 : hovered ? 2.4 : owned ? 0.65 : 1.15
        display.ringMaterial.color.setHex(owned ? 0x5b6561 : selected ? 0xc5ed78 : 0x7b914a)
        display.plinthMaterial.emissive.setHex(selected ? 0x18230b : 0x000000)
        display.plinthMaterial.emissiveIntensity = selected ? 1.35 : 0
      })
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('keydown', handleKeyDown)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('dblclick', handleDoubleClick)
      renderer.setAnimationLoop(null)
      controls.dispose()
      storeDraco.dispose()
      if (storePropAsset) disposeStandaloneAsset(storePropAsset)
      for (const model of loadedModels) disposeGameplayModel(model)
      for (const resource of resources) resource.dispose()
      displays.clear()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [items])

  const selectItem = (item: StoreDisplayItem): void => {
    setSelectedId(item.id)
  }

  return (
    <section className="store-space" aria-label="三维战备补给站">
      <div ref={containerRef} className={previewWeapon ? 'store-space-viewport preview-hidden' : 'store-space-viewport'} />
      <div className="store-space-shade" aria-hidden="true" />

      <header className="store-space-header">
        <div className="store-space-title">
          <span><PackageOpen size={24} /></span>
          <div><strong>军需仓库</strong><small>TACTICAL QUARTERMASTER</small></div>
        </div>
        <div className="store-space-actions">
          <div className="store-space-balance"><Coins size={17} /><span>战备点</span><strong>{credits.toLocaleString()}</strong></div>
          <button className="store-space-tracer" onClick={() => setTracerShopOpen(true)} title="曳光弹商店">
            曳光弹
          </button>
          <button className="store-space-close" onClick={onClose} aria-label="离开补给站" title="离开补给站"><X size={21} /></button>
        </div>
      </header>

      {tracerShopOpen && (
        <TracerShop onClose={() => setTracerShopOpen(false)} />
      )}

      {loading && <div className="store-space-loading">军械陈列装载中</div>}

      <div className="store-space-checkout">
        <div className="store-space-selector" role="tablist" aria-label="商品陈列">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={item.id === selectedId ? 'active' : ''}
              onClick={() => selectItem(item)}
              role="tab"
              aria-selected={item.id === selectedId}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>

        {selectedItem && (
          <div className="store-space-purchase">
            <button className="store-space-back" onClick={onClose} aria-label="返回大厅"><ArrowLeft size={19} /></button>
            <div className="store-space-product-copy">
              <small>{selectedItem.kind}</small>
              <strong>{selectedItem.title}</strong>
              <span>{selectedOwned ? '已列装至账户' : selectedItem.price === 0 ? '免费领取' : `${selectedItem.price.toLocaleString()} 战备点`}</span>
            </div>
            <button
              className="store-space-buy"
              onClick={() => onBuy(selectedItem)}
              disabled={!canBuy}
            >
              <ShoppingCart size={19} />
              <span>{selectedOwned ? '已拥有' : credits < selectedItem.price ? '战备点不足' : selectedItem.price === 0 ? '领取' : '确认采购'}</span>
            </button>
          </div>
        )}
      </div>
      {previewWeapon && (
        <WeaponPreviewSpace
          item={previewWeapon.item}
          modelId={previewWeapon.modelId}
          onClose={() => setPreviewWeapon(null)}
        />
      )}
    </section>
  )
}

function WeaponPreviewSpace({
  item,
  modelId,
  onClose,
}: {
  item: StoreDisplayItem
  modelId: GameplayModelId
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    const resources: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = []
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'weapon-preview-canvas'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x070a0d)
    scene.fog = new THREE.Fog(0x070a0d, 7, 22)
    const camera = new THREE.PerspectiveCamera(36, 1, 0.08, 40)
    camera.position.set(0.2, 1.25, 5.3)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.08, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.045
    controls.enablePan = false
    controls.minDistance = 3.4
    controls.maxDistance = 7.8
    controls.minPolarAngle = 0.9
    controls.maxPolarAngle = 1.72
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.65

    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = new RoomEnvironment()
    const environmentTarget = pmrem.fromScene(environment, 0.04)
    scene.environment = environmentTarget.texture

    const hemi = new THREE.HemisphereLight(0xcad6df, 0x131719, 0.75)
    scene.add(hemi)
    const key = new THREE.SpotLight(0xf2f6ff, 420, 16, Math.PI / 5.5, 0.5, 1.35)
    key.position.set(-3.4, 4.8, 4.2)
    key.target.position.set(0, 1.0, 0)
    key.castShadow = true
    key.shadow.mapSize.set(1536, 1536)
    key.shadow.bias = -0.0002
    key.shadow.normalBias = 0.025
    scene.add(key, key.target)
    const rim = new THREE.SpotLight(0xb9e368, 330, 15, Math.PI / 6.2, 0.58, 1.25)
    rim.position.set(3.3, 3.8, -1.5)
    rim.target.position.set(0, 1.0, 0)
    scene.add(rim, rim.target)
    const warm = new THREE.PointLight(0xe39a57, 75, 8, 1.8)
    warm.position.set(-2.7, 1.2, 2.3)
    scene.add(warm)

    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x111719, roughness: 0.42, metalness: 0.7, envMapIntensity: 0.82 })
    const floorGeometry = new THREE.CircleGeometry(3.7, 64)
    resources.push(floorMaterial, floorGeometry)
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xb9e368, emissive: 0x4d6f18, emissiveIntensity: 1.8, roughness: 0.25, metalness: 0.45 })
    const ringGeometry = new THREE.TorusGeometry(1.46, 0.018, 8, 96)
    resources.push(ringMaterial, ringGeometry)
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.014
    scene.add(ring)

    const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x171f21, roughness: 0.34, metalness: 0.76, envMapIntensity: 1.05 })
    const pedestalGeometry = new THREE.CylinderGeometry(1.24, 1.44, 0.25, 64)
    resources.push(pedestalMaterial, pedestalGeometry)
    const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial)
    pedestal.position.y = 0.13
    pedestal.castShadow = true
    pedestal.receiveShadow = true
    scene.add(pedestal)

    const weaponRoot = new THREE.Group()
    weaponRoot.position.y = 0.34
    scene.add(weaponRoot)
    let loadedModel: THREE.Group | null = null

    void createGameplayModel(modelId)
      .then((model) => {
        if (disposed) {
          disposeGameplayModel(model)
          return
        }
        model.scale.setScalar(modelId === 'sniper' ? 3.65 : 3.1)
        model.rotation.set(0.02, gameplayModelRotationY(modelId) - 0.34, 0.04)
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.castShadow = true
          object.receiveShadow = true
          const material = Array.isArray(object.material) ? object.material : [object.material]
          material.forEach((entry) => {
            entry.envMapIntensity = 1.35
            entry.needsUpdate = true
          })
        })
        weaponRoot.add(model)
        loadedModel = model
        const bounds = new THREE.Box3().setFromObject(model)
        const center = bounds.getCenter(new THREE.Vector3())
        model.position.sub(center)
        model.position.y += 0.18
        if (!disposed) setLoading(false)
      })
      .catch(() => {
        if (!disposed) setLoading(false)
      })

    const resize = (): void => {
      const { width, height } = container.getBoundingClientRect()
      const safeWidth = Math.max(1, width)
      const safeHeight = Math.max(1, height)
      renderer.setSize(safeWidth, safeHeight, false)
      camera.aspect = safeWidth / safeHeight
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    const clock = new THREE.Clock()
    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime()
      controls.update()
      ring.rotation.z = elapsed * 0.08
      ringMaterial.emissiveIntensity = 1.65 + Math.sin(elapsed * 2.1) * 0.35
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('keydown', handleKeyDown)
      renderer.setAnimationLoop(null)
      controls.dispose()
      if (loadedModel) disposeGameplayModel(loadedModel)
      environmentTarget.dispose()
      pmrem.dispose()
      environment.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const material = Array.isArray(object.material) ? object.material : [object.material]
        material.forEach((entry) => entry.dispose())
      })
      resources.forEach((resource) => resource.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [modelId])

  return (
    <div className="weapon-preview-space" aria-label={`${item.title}武器预览`}>
      <div ref={containerRef} className="weapon-preview-viewport" />
      <div className="weapon-preview-vignette" aria-hidden="true" />
      <header className="weapon-preview-header">
        <div><small>武器全息检视 / FULL INSPECTION</small><strong>{item.title}</strong><span>{item.kind} · PBR MATERIAL RESPONSE</span></div>
        <button className="weapon-preview-close" onClick={onClose} aria-label="返回商店"><ArrowLeft size={20} /><span>返回商店</span></button>
      </header>
      {loading && <div className="weapon-preview-loading">加载武器模型与光源映射</div>}
      <footer className="weapon-preview-footer">
        <span>拖拽旋转</span><i /> <span>滚轮缩放</span><i /> <span>ESC 返回</span>
      </footer>
    </div>
  )
}
