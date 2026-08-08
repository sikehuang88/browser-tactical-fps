import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { TracerVisual } from '../core/tracerShop'
import { TracerSystem } from '../render/tracers'
import { createTracerStyle } from '../render/tracerStyles'

const PREVIEW_MUZZLE = new THREE.Vector3(-6, 0, 0)
const PREVIEW_IMPACT = new THREE.Vector3(6, 0, 0)
const REPEAT_INTERVAL_MS = 900

/**
 * 商店预览：用与对局完全相同的 TracerSystem 和样式实现渲染，
 * 所以预览里看到的就是装备后打出来的效果，不会出现"图文不符"。
 */
export function TracerPreview({ visual }: { visual: TracerVisual }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.set(0, 2.4, 9)
    camera.lookAt(0, 0, 0)

    const tracers = new TracerSystem(scene, createTracerStyle(visual, 'high'))

    const resize = (): void => {
      const { clientWidth, clientHeight } = host
      if (clientWidth === 0 || clientHeight === 0) return
      renderer.setSize(clientWidth, clientHeight, false)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    let frame = 0
    let nextShotAtMs = 0
    const loop = (nowMs: number): void => {
      frame = requestAnimationFrame(loop)
      if (nowMs >= nextShotAtMs) {
        nextShotAtMs = nowMs + REPEAT_INTERVAL_MS
        tracers.spawn(
          { muzzle: PREVIEW_MUZZLE, impact: PREVIEW_IMPACT, weaponId: 1, local: true },
          nowMs,
        )
      }
      tracers.update(nowMs)
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      tracers.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [visual])

  return <div className="tracer-preview" ref={hostRef} aria-label="曳光弹预览" />
}
