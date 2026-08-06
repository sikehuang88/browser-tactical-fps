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
} as const

export interface InputManagerOptions {
  container: HTMLElement
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
  private readonly onLockChange?: (locked: boolean) => void
  private keys = new Set<string>()
  private mouseDX = 0
  private mouseDY = 0
  private sensitivity: number
  private locked = false

  constructor(options: InputManagerOptions) {
    this.container = options.container
    this.sensitivity = options.sensitivity ?? 0.15
    this.onLockChange = options.onLockChange

    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleKeyUp = this.handleKeyUp.bind(this)
    this.handleMouseMove = this.handleMouseMove.bind(this)
    this.handleLockChange = this.handleLockChange.bind(this)
    this.handleClick = this.handleClick.bind(this)

    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    document.addEventListener('mousemove', this.handleMouseMove)
    document.addEventListener('pointerlockchange', this.handleLockChange)
    this.container.addEventListener('click', this.handleClick)
  }

  /** 每次引擎 tick 采集一次输入。 */
  sample(): RawInput {
    const buttons =
      (this.isDown('KeyW') || this.isDown('ArrowUp') ? BUTTON.FORWARD : 0) |
      (this.isDown('KeyS') || this.isDown('ArrowDown') ? BUTTON.BACK : 0) |
      (this.isDown('KeyA') || this.isDown('ArrowLeft') ? BUTTON.LEFT : 0) |
      (this.isDown('KeyD') || this.isDown('ArrowRight') ? BUTTON.RIGHT : 0) |
      (this.isDown('Space') ? BUTTON.JUMP : 0) |
      (this.isDown('ControlLeft') || this.isDown('ControlRight') ? BUTTON.CROUCH : 0) |
      (this.isDown('ShiftLeft') || this.isDown('ShiftRight') ? BUTTON.SPRINT : 0) |
      (this.isDown('MouseLeft') ? BUTTON.ATTACK : 0) |
      (this.isDown('KeyE') ? BUTTON.USE : 0) |
      (this.isDown('KeyR') ? BUTTON.RELOAD : 0) |
      (this.isDown('Digit4') ? BUTTON.THROW_HE : 0) |
      (this.isDown('Digit5') ? BUTTON.THROW_FLASH : 0) |
      (this.isDown('Digit6') ? BUTTON.THROW_SMOKE : 0)

    // 只有指针锁定时才产生视角增量（避免 HUD 上误触发）
    const yawDelta = this.locked ? Math.round(this.mouseDX * this.sensitivity * 100) : 0
    const pitchDelta = this.locked ? Math.round(-this.mouseDY * this.sensitivity * 100) : 0
    this.mouseDX = 0
    this.mouseDY = 0

    const forwardAxis = (buttons & BUTTON.FORWARD ? 1 : 0) - (buttons & BUTTON.BACK ? 1 : 0)
    const strafeAxis = (buttons & BUTTON.RIGHT ? 1 : 0) - (buttons & BUTTON.LEFT ? 1 : 0)

    return { buttons, yawDelta, pitchDelta, forwardAxis, strafeAxis }
  }

  setSensitivity(v: number): void {
    this.sensitivity = v
  }

  /** 请求锁定指针（进入对局时调用）。 */
  requestLock(): void {
    this.container.requestPointerLock?.()
  }

  get isLocked(): boolean {
    return this.locked
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    document.removeEventListener('mousemove', this.handleMouseMove)
    document.removeEventListener('pointerlockchange', this.handleLockChange)
    this.container.removeEventListener('click', this.handleClick)
  }

  private isDown(code: string): boolean {
    return this.keys.has(code)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') e.preventDefault()
    this.keys.add(e.code)
    if (e.code === 'MouseLeft') this.keys.add('MouseLeft')
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code)
    if (e.code === 'MouseLeft') this.keys.delete('MouseLeft')
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.locked) return
    this.mouseDX += e.movementX
    this.mouseDY += e.movementY
  }

  private handleLockChange(): void {
    this.locked = document.pointerLockElement === this.container
    this.keys.clear()
    this.mouseDX = 0
    this.mouseDY = 0
    this.onLockChange?.(this.locked)
  }

  private handleClick(): void {
    if (!this.locked) this.requestLock()
  }
}
