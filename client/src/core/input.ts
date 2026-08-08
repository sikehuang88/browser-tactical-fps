import type { RawInput } from './types'

/** 输入按钮位标记，与 proto/fps/v1/net.proto 的 InputButtons 对应。 */
export const BUTTON = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  SPRINT: 1 << 6,
  ATTACK: 1 << 7,
  USE: 1 << 8,
  RELOAD: 1 << 9,
  THROW_SMOKE: 1 << 10,
  THROW_FLASH: 1 << 11,
  THROW_HE: 1 << 12,
  EQUIP_FIREARM: 1 << 13,
  EQUIP_KNIFE: 1 << 14,
  EQUIP_SECONDARY: 1 << 15,
} as const

export interface InputManagerOptions {
  container: HTMLElement
  lockTarget?: HTMLElement
  sensitivity?: number
  onLockChange?: (locked: boolean) => void
}

/**
 * 键盘 + 鼠标输入采集。
 * - 指针锁定时鼠标移动被转为相对增量（厘度），与服务器输入帧格式一致。
 * - 未锁定时移动输入不生效（对局必须锁定指针）。
 */
export class InputManager {
  private readonly container: HTMLElement
  private readonly lockTarget: HTMLElement
  private readonly onLockChange?: (locked: boolean) => void
  private keys = new Set<string>()
  private mouseDX = 0
  private mouseDY = 0
  private mouseLeftPressed = false
  private mouseRightPressed = false
  private wheelDirection = 0
  private sensitivity: number
  private locked = false
  private pointerLocked = false
  private softLock = false
  private gameplayEnabled = true
  private lockAttempt = 0
  private lastMouseX = 0
  private lastMouseY = 0
  private hasMousePosition = false

  constructor(options: InputManagerOptions) {
    this.container = options.container
    this.lockTarget = options.lockTarget ?? options.container
    this.sensitivity = options.sensitivity ?? 0.15
    this.onLockChange = options.onLockChange

    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleKeyUp = this.handleKeyUp.bind(this)
    this.handleMouseMove = this.handleMouseMove.bind(this)
    this.handleMouseDown = this.handleMouseDown.bind(this)
    this.handleMouseUp = this.handleMouseUp.bind(this)
    this.handleWheel = this.handleWheel.bind(this)
    this.handleContextMenu = this.handleContextMenu.bind(this)
    this.handleLockChange = this.handleLockChange.bind(this)
    this.handleClick = this.handleClick.bind(this)

    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    document.addEventListener('mousemove', this.handleMouseMove)
    window.addEventListener('mousedown', this.handleMouseDown)
    window.addEventListener('mouseup', this.handleMouseUp)
    this.container.addEventListener('wheel', this.handleWheel, { passive: false })
    this.container.addEventListener('contextmenu', this.handleContextMenu)
    document.addEventListener('pointerlockchange', this.handleLockChange)
    this.container.addEventListener('click', this.handleClick)
    this.handleLockChange()
  }

  /** 每次引擎 tick 采集一次输入。 */
  sample(currentWeaponId = 2): RawInput {
    if (!this.gameplayEnabled) {
      this.mouseDX = 0
      this.mouseDY = 0
      this.mouseLeftPressed = false
      this.mouseRightPressed = false
      return { buttons: 0, yawDelta: 0, pitchDelta: 0, forwardAxis: 0, strafeAxis: 0, aiming: false }
    }
    const mouseLeft = this.isDown('MouseLeft') || this.mouseLeftPressed
    const mouseRight = this.isDown('MouseRight') || this.mouseRightPressed
    const aiming = mouseRight && currentWeaponId === 4
    // 狙击开镜 FOV 减半，灵敏度同步缩放，保证开镜后准星与命中射线一致。
    const sensitivityScale = aiming ? 0.5 : 1
    const buttons =
      (this.isDown('KeyW') || this.isDown('ArrowUp') ? BUTTON.FORWARD : 0) |
      (this.isDown('KeyS') || this.isDown('ArrowDown') ? BUTTON.BACK : 0) |
      (this.isDown('KeyA') || this.isDown('ArrowLeft') ? BUTTON.LEFT : 0) |
      (this.isDown('KeyD') || this.isDown('ArrowRight') ? BUTTON.RIGHT : 0) |
      (this.isDown('Space') ? BUTTON.JUMP : 0) |
      (this.isDown('ControlLeft') || this.isDown('ControlRight') ? BUTTON.CROUCH : 0) |
      (this.isDown('ShiftLeft') || this.isDown('ShiftRight') ? BUTTON.SPRINT : 0) |
      (mouseLeft ? BUTTON.ATTACK : 0) |
      (this.isDown('KeyE') ? BUTTON.USE : 0) |
      (this.isDown('KeyR') ? BUTTON.RELOAD : 0) |
      (this.isDown('Digit4') ? BUTTON.THROW_HE : 0) |
      (this.isDown('Digit5') ? BUTTON.THROW_FLASH : 0) |
      (this.isDown('Digit6') ? BUTTON.THROW_SMOKE : 0) |
      (this.isDown('Digit1') ? BUTTON.EQUIP_FIREARM : 0) |
      (this.isDown('Digit2') ? BUTTON.EQUIP_SECONDARY : 0) |
      (this.isDown('Digit3') ? BUTTON.EQUIP_KNIFE : 0)

    const buttonsWithWheel = buttons | this.weaponButtonFromWheel(currentWeaponId)

    // 只有指针锁定时才产生视角增量（避免 HUD 上误触发）
    // Three.js camera yaw rotates its -Z view vector left for positive angles,
    // so screen-right mouse movement needs a negative world yaw delta.
    const yawDelta = this.locked ? Math.round(-this.mouseDX * this.sensitivity * 100 * sensitivityScale) : 0
    const pitchDelta = this.locked ? Math.round(-this.mouseDY * this.sensitivity * 100 * sensitivityScale) : 0
    this.mouseDX = 0
    this.mouseDY = 0
    this.mouseLeftPressed = false
    this.mouseRightPressed = false

    const forwardAxis = ((buttonsWithWheel & BUTTON.FORWARD ? 1 : 0) - (buttonsWithWheel & BUTTON.BACK ? 1 : 0)) * 127
    const strafeAxis = ((buttonsWithWheel & BUTTON.RIGHT ? 1 : 0) - (buttonsWithWheel & BUTTON.LEFT ? 1 : 0)) * 127

    return { buttons: buttonsWithWheel, yawDelta, pitchDelta, forwardAxis, strafeAxis, aiming }
  }

  setSensitivity(v: number): void {
    this.sensitivity = v
  }

  setGameplayEnabled(enabled: boolean): void {
    this.gameplayEnabled = enabled
    if (!enabled) {
      this.keys.clear()
      this.mouseDX = 0
      this.mouseDY = 0
      this.mouseLeftPressed = false
      this.mouseRightPressed = false
      this.wheelDirection = 0
    }
  }

  /** 请求锁定指针（进入对局时调用）。 */
  requestLock(): void {
    if (this.locked) return
    if (
      !('pointerLockElement' in document) ||
      typeof this.lockTarget.requestPointerLock !== 'function'
    ) {
      this.activateSoftLock()
      return
    }
    const attempt = ++this.lockAttempt
    try {
      const result = this.lockTarget.requestPointerLock()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => {
          if (attempt === this.lockAttempt && !this.locked) {
            this.activateSoftLock()
          }
        })
      }
    } catch {
      this.activateSoftLock()
      return
    }
    // Some embedded Chromium builds fail without dispatching a useful event.
    window.setTimeout(() => {
      if (attempt === this.lockAttempt && !this.locked && document.pointerLockElement !== this.lockTarget) {
        this.activateSoftLock()
      }
    }, 180)
  }

  get isLocked(): boolean {
    return this.locked
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    document.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mousedown', this.handleMouseDown)
    window.removeEventListener('mouseup', this.handleMouseUp)
    document.removeEventListener('pointerlockchange', this.handleLockChange)
    this.container.removeEventListener('click', this.handleClick)
    this.container.removeEventListener('wheel', this.handleWheel)
    this.container.removeEventListener('contextmenu', this.handleContextMenu)
    if (document.pointerLockElement === this.lockTarget) {
      document.exitPointerLock?.()
    }
  }

  private isDown(code: string): boolean {
    return this.keys.has(code)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') e.preventDefault()
    this.keys.add(e.code)
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code)
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.locked && e.button === 0) {
      this.keys.add('MouseLeft')
      this.mouseLeftPressed = true
      e.preventDefault()
    }
    if (this.locked && e.button === 2) {
      this.keys.add('MouseRight')
      this.mouseRightPressed = true
      e.preventDefault()
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.keys.delete('MouseLeft')
    if (e.button === 2) this.keys.delete('MouseRight')
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.locked) return
    if (this.pointerLocked) {
      this.mouseDX += e.movementX
      this.mouseDY += e.movementY
    } else if (this.softLock) {
      if (this.hasMousePosition) {
        this.mouseDX += e.clientX - this.lastMouseX
        this.mouseDY += e.clientY - this.lastMouseY
      }
      this.lastMouseX = e.clientX
      this.lastMouseY = e.clientY
      this.hasMousePosition = true
    }
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.locked) return
    e.preventDefault()
    if (e.deltaY !== 0) this.wheelDirection = e.deltaY < 0 ? 1 : -1
  }

  private handleContextMenu(e: MouseEvent): void {
    if (this.locked) e.preventDefault()
  }

  private weaponButtonFromWheel(currentWeaponId: number): number {
    if (this.wheelDirection === 0) return 0
    const cycle = currentWeaponId === 5
      ? [BUTTON.EQUIP_FIREARM, BUTTON.EQUIP_SECONDARY]
      : currentWeaponId === 2
        ? [BUTTON.EQUIP_KNIFE, BUTTON.EQUIP_FIREARM]
        : [BUTTON.EQUIP_SECONDARY, BUTTON.EQUIP_KNIFE]
    const button = this.wheelDirection > 0 ? cycle[0] : cycle[1]
    this.wheelDirection = 0
    return button
  }

  private handleLockChange(): void {
    if (document.pointerLockElement === this.lockTarget) {
      this.pointerLocked = true
      this.softLock = false
      this.locked = true
    } else if (this.softLock) {
      // Embedded browsers may reject Pointer Lock; retain canvas-relative mouse control.
      this.pointerLocked = false
      this.locked = true
    } else {
      this.pointerLocked = false
      this.locked = false
    }
    this.keys.clear()
    this.mouseDX = 0
    this.mouseDY = 0
    this.mouseLeftPressed = false
    this.mouseRightPressed = false
    this.wheelDirection = 0
    this.hasMousePosition = false
    this.onLockChange?.(this.locked)
  }

  private activateSoftLock(): void {
    this.softLock = true
    this.pointerLocked = false
    this.locked = true
    this.hasMousePosition = false
    this.onLockChange?.(true)
  }

  private handleClick(): void {
    if (!this.locked) this.requestLock()
  }
}
