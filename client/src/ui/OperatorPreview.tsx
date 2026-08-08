import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  createCharacterInstance,
  disposeCharacterInstance,
  loadOperatorAsset,
  setCharacterMotion,
  type CharacterInstance,
  type OperatorId,
} from '../render/characterAssets'

export function OperatorPreview({ operatorId }: { operatorId: OperatorId }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const character: { instance: CharacterInstance; baseRotation: number }[] = []
    let renderedCharacterFrames = 0

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'operator-preview-canvas'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(31, 1, 0.05, 50)
    camera.position.set(0, 1.35, 5.25)
    camera.lookAt(0, 0.92, 0)

    const hemi = new THREE.HemisphereLight(0xe8edf0, 0x1a2022, 1.7)
    const key = new THREE.DirectionalLight(0xffe4c2, 3.4)
    key.position.set(3, 5, 4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const rim = new THREE.DirectionalLight(0x99b85a, 2.8)
    rim.position.set(-4, 2.8, -3)
    scene.add(hemi, key, rim)

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 4),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.32 }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.015
    shadow.receiveShadow = true
    scene.add(shadow)

    const resize = (): void => {
      const { width, height } = container.getBoundingClientRect()
      const safeWidth = Math.max(1, width)
      const safeHeight = Math.max(1, height)
      renderer.setSize(safeWidth, safeHeight, false)
      camera.aspect = safeWidth / safeHeight
      camera.position.z = safeWidth / safeHeight < 1 ? 6.5 : 5.25
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const clock = new THREE.Clock()
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.05)
      for (const member of character) {
        member.instance.mixer.update(delta)
        member.instance.root.rotation.y = member.baseRotation + Math.sin(clock.elapsedTime * 0.38) * 0.025
      }
      if (character.length > 0) {
        renderedCharacterFrames += 1
        if (renderedCharacterFrames === 2) setLoading(false)
      }
      renderer.render(scene, camera)
    })

    setLoading(true)
    void loadOperatorAsset(operatorId)
      .then((asset) => {
        if (disposed) return
        const instance = createCharacterInstance(asset)
        setCharacterMotion(instance, 'showcase')
        const bounds = new THREE.Box3().setFromObject(instance.root)
        const center = bounds.getCenter(new THREE.Vector3())
        instance.root.position.set(-center.x, 0, -center.z)
        instance.root.scale.multiplyScalar(1.12)
        scene.add(instance.root)
        character.push({ instance, baseRotation: 0 })
      })
      .catch(() => {
        if (!disposed) setLoading(false)
      })

    return () => {
      disposed = true
      observer.disconnect()
      renderer.setAnimationLoop(null)
      for (const member of character) {
        scene.remove(member.instance.root)
        disposeCharacterInstance(member.instance)
      }
      shadow.geometry.dispose()
      ;(shadow.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [operatorId])

  return (
    <div ref={containerRef} className="operator-preview" aria-label="当前干员预览">
      {loading && <div className="operator-loading">干员加载中</div>}
    </div>
  )
}
