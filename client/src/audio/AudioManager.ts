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
  | { type: 'hit' }
  | { type: 'hurt' }

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
      case 'hit':
        this.playHit()
        break
      case 'hurt':
        this.playHurt()
        break
    }
  }

  // ---------- 声音实现 ----------

  private playShot(weaponId: number, pos?: Vec3, local = true): void {
    if (weaponId === 4) {
      this.playHeavyShot(pos, local)
      return
    }
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

  /** Heavy anti-materiel rifle report: sharp crack, pressure blast and long low tail. */
  private playHeavyShot(pos?: Vec3, local = true): void {
    const { pan, gain } = this.spatial(pos, local)
    const t = this.ctx!.currentTime

    const crack = this.ctx!.createBufferSource()
    crack.buffer = this.noiseBuf!
    const crackFilter = this.ctx!.createBiquadFilter()
    crackFilter.type = 'highpass'
    crackFilter.frequency.setValueAtTime(1800, t)
    crackFilter.frequency.exponentialRampToValueAtTime(700, t + 0.16)
    const crackGain = this.ctx!.createGain()
    crackGain.gain.setValueAtTime(1.15 * gain, t)
    crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24)
    crack.connect(crackFilter).connect(crackGain)
    this.route(crackGain, pan)
    crack.start(t)
    crack.stop(t + 0.28)

    const blast = this.ctx!.createBufferSource()
    blast.buffer = this.noiseBuf!
    const blastFilter = this.ctx!.createBiquadFilter()
    blastFilter.type = 'lowpass'
    blastFilter.frequency.setValueAtTime(900, t)
    blastFilter.frequency.exponentialRampToValueAtTime(100, t + 0.9)
    const blastGain = this.ctx!.createGain()
    blastGain.gain.setValueAtTime(1.35 * gain, t)
    blastGain.gain.exponentialRampToValueAtTime(0.001, t + 1.05)
    blast.connect(blastFilter).connect(blastGain)
    this.route(blastGain, pan)
    blast.start(t)
    blast.stop(t + 1.15)

    const sub = this.ctx!.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(52, t)
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.75)
    const subGain = this.ctx!.createGain()
    subGain.gain.setValueAtTime(0.9 * gain, t)
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85)
    sub.connect(subGain)
    this.route(subGain, pan)
    sub.start(t)
    sub.stop(t + 0.95)

    const tail = this.ctx!.createBufferSource()
    tail.buffer = this.noiseBuf!
    const tailFilter = this.ctx!.createBiquadFilter()
    tailFilter.type = 'bandpass'
    tailFilter.frequency.setValueAtTime(420, t + 0.04)
    tailFilter.Q.value = 0.7
    const tailGain = this.ctx!.createGain()
    tailGain.gain.setValueAtTime(0.55 * gain, t + 0.04)
    tailGain.gain.exponentialRampToValueAtTime(0.001, t + 1.35)
    tail.connect(tailFilter).connect(tailGain)
    this.route(tailGain, pan)
    tail.start(t + 0.04)
    tail.stop(t + 1.45)
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

  private playHit(): void {
    const t = this.ctx!.currentTime
    const osc = this.ctx!.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(980, t)
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.08)
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.22, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    osc.connect(g)
    this.route(g, 0)
    osc.start(t)
    osc.stop(t + 0.12)
  }

  private playHurt(): void {
    const t = this.ctx!.currentTime
    const noise = this.ctx!.createBufferSource()
    noise.buffer = this.noiseBuf!
    const filter = this.ctx!.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(520, t)
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.18)
    filter.Q.value = 1.1
    const gain = this.ctx!.createGain()
    gain.gain.setValueAtTime(0.34, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    noise.connect(filter).connect(gain)
    this.route(gain, 0)
    noise.start(t)
    noise.stop(t + 0.23)

    const tone = this.ctx!.createOscillator()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(115, t)
    tone.frequency.exponentialRampToValueAtTime(72, t + 0.16)
    const toneGain = this.ctx!.createGain()
    toneGain.gain.setValueAtTime(0.16, t)
    toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    tone.connect(toneGain)
    this.route(toneGain, 0)
    tone.start(t)
    tone.stop(t + 0.2)
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
