// 渲染器：M0 使用 WebGL2（Three.js）。WebGPU 已做特性检测，接入在后续里程碑
// （RENDER-001：WebGPU 不可用时自动回退 WebGL 2，并向用户说明被禁用的画质功能）。

import * as THREE from 'three'

export class Renderer {
  readonly gl: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  constructor(container: HTMLElement, fov = 90) {
    const gpuAvailable =
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      navigator.gpu !== undefined
    console.info(
      gpuAvailable
        ? '[renderer] WebGPU 可用；M0 阶段暂用 WebGL2（TODO(M2): WebGPURenderer 接入）'
        : '[renderer] WebGPU 不可用，使用 WebGL2',
    )

    this.gl = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.shadowMap.enabled = false // M0 灰盒阶段不开阴影
    this.gl.domElement.style.width = '100%'
    this.gl.domElement.style.height = '100%'
    this.gl.domElement.style.display = 'block'
    container.appendChild(this.gl.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0d1117)
    this.scene.fog = new THREE.Fog(0x0d1117, 60, 160)

    this.camera = new THREE.PerspectiveCamera(fov, this.aspect(), 0.05, 200)
    this.camera.rotation.order = 'YXZ'
    this.resize()

    window.addEventListener('resize', this.handleResize)
  }

  setFov(fov: number): void {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }

  /** 每帧渲染前的钩子（后续做后处理/动态分辨率时在此展开）。 */
  begin(): void {}

  render(): void {
    this.gl.render(this.scene, this.camera)
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize)
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
    this.gl.dispose()
    this.gl.domElement.remove()
  }

  private readonly handleResize = (): void => {
    this.resize()
  }

  private aspect(): number {
    return window.innerWidth / window.innerHeight
  }

  private resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.gl.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
}
