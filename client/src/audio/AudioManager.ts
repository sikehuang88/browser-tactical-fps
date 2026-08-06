// 音频系统（AUDIO-001/002）：Web Audio 程序化音效（无素材依赖）。
// 分类混音（master/sfx）+ 基于位置的 StereoPanner 空间声像 + 距离衰减。
// 浏览器要求用户手势后初始化（进入对局锁定指针时调用 init）。

import type { Vec3 } from '../core/types'

export type AudioEvent =
  | { type: 'shot'; weaponId: number; pos?: Vec3; local: boolean }
  | { type: 'reload'; local: boolean }
  | { type: 'footstep' }
  | { type: 'throw'; local: boolean }
  | { type: 'explosion'; pos?: Vec3; local: boolean }
  | { type: 'flash' }
  | { type: 'buy' }
  | { type: 'kill' }

export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private listenerPos: Vec3 = { x: 0, y: 0, z: 0 }
  private listenerYaw = 0
  enabled = true
  volumes = { master: 0.8, sfx: 1.0 }

  /** 在用户手势中调用。 */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      this.enabled = false
      return
    }
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.volumes.master
    this.master.connect(this.ctx.destination)
    this.sfx = this.ctx.createGain()
    this.sfx.gain.value = this.volumes.sfx
    this.sfx.connect(this.master)
    this.noiseBuf = this.buildNoise(1.0)
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolumes(master: number, sfx: number): void {
    this.volumes.master = master
    this.volumes.sfx = sfx
    if (this.master) this.master.gain.value = master
    if (this.sfx) this.sfx.gain.value = sfx
  }

  setListener(pos: Vec3, yawDeg: number): void {
    this.listenerPos = { ...pos }
    this.listenerYaw = yawDeg
  }

  play(ev: AudioEvent): void {
    if (!this.enabled || !this.ctx || !this.sfx) return
    switch (ev.type) {
      case 'shot':
        this.playShot(ev.weaponId, ev.pos, ev.local)
        break
      case 'reload':
        this.playReload(ev.local)
        break
      case 'footstep':
        this.playFootstep()
        break
      case 'throw':
        this.playThrow(ev.local)
        break
      case 'explosion':
        this.playExplosion(ev.pos, ev.local)
        break
      case 'flash':
        this.playFlash()
        break
      case 'buy':
        this.playBuy()
        break
      case 'kill':
        this.playKill()
        break
    }
  }

  // ---------- 声音实现 ----------

  private playShot(weaponId: number, pos?: Vec3, local = true): void {
    const { pan, gain } = this.spatial(pos, local)
    const t = this.ctx!.currentTime
    const noise = this.ctx!.createBufferSource()
    noise.buffer = this.noiseBuf!
    const filt = this.ctx!.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.value = weaponId === 4 ? 2600 : 1600 // 狙击更脆
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.9 * gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    noise.connect(filt).connect(g)
    this.route(g, pan)
    noise.start(t)
    noise.stop(t + 0.2)

    const osc = this.ctx!.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(weaponId === 4 ? 80 : 110, t)
    const og = this.ctx!.createGain()
    og.gain.setValueAtTime(0.6 * gain, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
    osc.connect(og)
    this.route(og, pan)
    osc.start(t)
    osc.stop(t + 0.15)
  }

  private playReload(local = true): void {
    const { gain } = this.spatial(undefined, local)
    for (let i = 0; i < 2; i++) {
      const t = this.ctx!.currentTime + i * 0.12
      const src = this.ctx!.createBufferSource()
      src.buffer = this.noiseBuf!
      const filt = this.ctx!.createBiquadFilter()
      filt.type = 'bandpass'
      filt.frequency.value = 1800
      const g = this.ctx!.createGain()
      g.gain.setValueAtTime(0.25 * gain, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
      src.connect(filt).connect(g)
      this.route(g, 0)
      src.start(t)
      src.stop(t + 0.05)
    }
  }

  private playFootstep(): void {
    const t = this.ctx!.currentTime
    const src = this.ctx!.createBufferSource()
    src.buffer = this.noiseBuf!
    const filt = this.ctx!.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.value = 600
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.16, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    src.connect(filt).connect(g)
    this.route(g, 0)
    src.start(t)
    src.stop(t + 0.08)
  }

  private playThrow(local = true): void {
    const { gain } = this.spatial(undefined, local)
    const t = this.ctx!.currentTime
    const src = this.ctx!.createBufferSource()
    src.buffer = this.noiseBuf!
    const filt = this.ctx!.createBiquadFilter()
    filt.type = 'bandpass'
    filt.frequency.setValueAtTime(2500, t)
    filt.frequency.exponentialRampToValueAtTime(400, t + 0.25)
    filt.Q.value = 1.5
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.3 * gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    src.connect(filt).connect(g)
    this.route(g, 0)
    src.start(t)
    src.stop(t + 0.35)
  }

  private playExplosion(pos?: Vec3, local = true): void {
    const { pan, gain } = this.spatial(pos, local)
    const t = this.ctx!.currentTime
    const src = this.ctx!.createBufferSource()
    src.buffer = this.noiseBuf!
    const filt = this.ctx!.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.setValueAtTime(1200, t)
    filt.frequency.exponentialRampToValueAtTime(120, t + 0.7)
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.9 * gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
    src.connect(filt).connect(g)
    this.route(g, pan)
    src.start(t)
    src.stop(t + 0.9)

    const osc = this.ctx!.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(60, t)
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.6)
    const og = this.ctx!.createGain()
    og.gain.setValueAtTime(0.7 * gain, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
    osc.connect(og)
    this.route(og, pan)
    osc.start(t)
    osc.stop(t + 0.8)
  }

  private playFlash(): void {
    const t = this.ctx!.currentTime
    const osc = this.ctx!.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1900, t)
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.3)
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.25, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    osc.connect(g)
    this.route(g, 0)
    osc.start(t)
    osc.stop(t + 0.4)
  }

  private playBuy(): void {
    const t = this.ctx!.currentTime
    const osc = this.ctx!.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 900
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.12, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    osc.connect(g)
    this.route(g, 0)
    osc.start(t)
    osc.stop(t + 0.1)
  }

  private playKill(): void {
    const t = this.ctx!.currentTime
    for (let i = 0; i < 2; i++) {
      const o = this.ctx!.createOscillator()
      o.type = 'sine'
      o.frequency.value = i === 0 ? 660 : 990
      const g = this.ctx!.createGain()
      g.gain.setValueAtTime(0.2, t + i * 0.1)
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.12)
      o.connect(g)
      this.route(g, 0)
      o.start(t + i * 0.1)
      o.stop(t + i * 0.1 + 0.15)
    }
  }

  // ---------- 工具 ----------

  private spatial(pos?: Vec3, local = true): { pan: number; gain: number } {
    if (local || !pos) return { pan: 0, gain: 1 }
    const dx = pos.x - this.listenerPos.x
    const dz = pos.z - this.listenerPos.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-3) return { pan: 0, gain: 1 }
    const yawRad = (this.listenerYaw * Math.PI) / 180
    // 前向 (-sin yaw, -cos yaw)，右向 (cos yaw, -sin yaw)
    const fx = -Math.sin(yawRad)
    const fz = -Math.cos(yawRad)
    const rx = Math.cos(yawRad)
    const rz = -Math.sin(yawRad)
    const f = (dx * fx + dz * fz) / dist
    const r = (dx * rx + dz * rz) / dist
    return {
      pan: Math.max(-1, Math.min(1, r * 0.8)),
      gain: Math.max(0, 1 - dist / 45) * (0.4 + 0.6 * Math.max(0, f)),
    }
  }

  private route(g: GainNode, pan: number): void {
    if (!this.ctx || !this.sfx) return
    if (Math.abs(pan) > 0.01) {
      const p = this.ctx.createStereoPanner()
      p.pan.value = pan
      g.connect(p)
      p.connect(this.sfx)
    } else {
      g.connect(this.sfx)
    }
  }

  private buildNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx!.sampleRate * seconds)
    const buf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buf
  }
}
