// 效果控制器：音频（AudioManager）+ 投掷物视觉（GrenadeView）。
// 由引擎每帧调用 process/update，处理 match 产出的效果事件与本地状态驱动的音效。

import * as THREE from 'three'
import { AudioManager } from '../audio/AudioManager'
import { GrenadeView } from '../render/grenadeView'
import type { LocalPlayerState } from '../prediction/localPlayer'
import type { MatchEffect } from './match'

export class Effects {
  readonly audio = new AudioManager()
  private readonly grenades: GrenadeView
  private lastShots = 0
  private lastReloading = false
  private footstepAccum = 0

  constructor(scene: THREE.Scene) {
    this.grenades = new GrenadeView(scene)
  }

  /** 在用户手势中初始化音频上下文。 */
  init(): void {
    this.audio.init()
  }

  process(events: MatchEffect[], localId: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'grenadeSpawn': {
          this.grenades.spawn(ev.msg)
          const mine = ev.msg.ownerId === localId
          this.audio.play({ type: 'throw', local: mine || !ev.msg.pos })
          break
        }
        case 'grenadeExplode':
          this.grenades.explode(ev.msg)
          this.audio.play({ type: 'explosion', pos: ev.msg.pos, local: false })
          break
        case 'flash':
          this.grenades.setFlash(ev.strength)
          this.audio.play({ type: 'flash' })
          break
      }
    }
  }

  /** 每帧驱动：监听器位置、本地开火/换弹/脚步音效、投掷物视觉推进。 */
  update(local: LocalPlayerState, dt: number): void {
    this.audio.setListener(local.position, local.yaw)

    // The counter resets on a new round/player reset; re-baseline before
    // comparing so the first shot of the next round still produces feedback.
    if (local.shotsFired < this.lastShots) this.lastShots = local.shotsFired
    if (local.shotsFired > this.lastShots) {
      const n = local.shotsFired - this.lastShots
      for (let i = 0; i < n && i < 4; i++) {
        this.audio.play({ type: 'shot', weaponId: local.weaponId, local: true })
      }
    }
    this.lastShots = local.shotsFired

    // 换弹
    if (local.reloading && !this.lastReloading) {
      this.audio.play({ type: 'reload', local: true })
    }
    this.lastReloading = local.reloading

    // 脚步（移动距离触发）
    this.footstepAccum += local.moveSpeed * dt
    if (this.footstepAccum >= 1.3) {
      this.footstepAccum = 0
      this.audio.play({ type: 'footstep' })
    }

    this.grenades.update(dt)
    this.grenades.syncFlashOverlay(performance.now())
  }

  onKill(): void {
    this.audio.play({ type: 'kill' })
  }

  onHit(killed = false): void {
    if (!killed) this.audio.play({ type: 'hit' })
  }

  onHurt(_damage: number): void {
    this.audio.play({ type: 'hurt' })
  }

  onBuy(): void {
    this.audio.play({ type: 'buy' })
  }

  dispose(): void {
    this.grenades.dispose()
  }
}
