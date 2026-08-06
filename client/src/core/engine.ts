import { Clock } from './clock'
import type { InputManager } from './input'
import type { Match } from '../game/match'
import type { PlayerView } from '../render/playerView'
import type { EntityView } from '../render/entityView'
import type { Renderer } from '../render/renderer'

export interface EngineDeps {
  input: InputManager
  match: Match
  view: PlayerView
  entityView: EntityView
  renderer: Renderer
}

export interface EngineOptions extends EngineDeps {
  /** 客户端模拟频率（与服务器 64 tick 对齐，后续支持 128）。 */
  fixedHz?: number
}

/**
 * 固定步长主循环：以 fixedHz 累积执行模拟 tick，每个 rAF 执行一次渲染。
 * 模拟与渲染解耦，避免帧率波动影响移动与射击节奏（对应 NET-005 插值/预测的基础）。
 */
export class Engine {
  private readonly input: InputManager
  private readonly match: Match
  private readonly view: PlayerView
  private readonly entityView: EntityView
  private readonly renderer: Renderer
  private readonly stepMs: number
  private readonly clock = new Clock()
  private running = false
  private rafId = 0
  private accumulator = 0
  private lastFrameMs = 0

  constructor(options: EngineOptions) {
    this.input = options.input
    this.match = options.match
    this.view = options.view
    this.entityView = options.entityView
    this.renderer = options.renderer
    this.stepMs = 1000 / (options.fixedHz ?? 64)
  }

  start(): void {
    this.running = true
    this.lastFrameMs = this.clock.now()
    this.frame(this.lastFrameMs)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  get fpsTarget(): number {
    return Math.round(1000 / this.stepMs)
  }

  private frame = (now: number): void => {
    if (!this.running) return
    // 限制单帧最大累积量，避免长时间挂起后出现"追帧爆炸"
    this.accumulator = Math.min(this.accumulator + (now - this.lastFrameMs), this.stepMs * 8)
    this.lastFrameMs = now

    while (this.accumulator >= this.stepMs) {
      this.tick(this.stepMs / 1000)
      this.accumulator -= this.stepMs
    }

    this.renderer.begin()
    this.entityView.update(this.match.visibleEntities(), this.match.localId)
    this.view.update(this.match.localState, now)
    this.renderer.render()
    this.rafId = requestAnimationFrame(this.frame)
  }

  private tick(dt: number): void {
    const raw = this.input.sample()
    this.match.update(dt, raw)
  }
}
