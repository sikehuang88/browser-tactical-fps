// M0 引导二进制线格式编解码。规格见 proto/README.md「M0 引导线格式」。
// 大端序；坐标厘米 int16，角度厘度 int16。后续以 protobuf 代码生成替换本文件，线格式不变。

import type { EntitySnapshot, InputFrame } from '../types'

export const PROTOCOL_VERSION = 0x01
const MAGIC = 0xf5

export const MSG = {
  HELLO: 0x01,
  WELCOME: 0x02,
  INPUT_FRAME: 0x03,
  SNAPSHOT: 0x04,
  PING: 0x05,
  PONG: 0x06,
  KICK: 0x07,
} as const

const FLAG_RELIABLE = 1 << 0
// bit1 = retransmit（M0 未使用，保留位）

export interface ParsedEnvelope {
  reliable: boolean
  msgType: number
  seq: number
  payload: Uint8Array
}

// ---------- 信封 ----------

export function encodeEnvelope(
  msgType: number,
  seq: number,
  payload: Uint8Array,
  reliable = false,
): Uint8Array {
  const out = new Uint8Array(10 + payload.length)
  const dv = new DataView(out.buffer)
  dv.setUint8(0, MAGIC)
  dv.setUint8(1, PROTOCOL_VERSION)
  dv.setUint8(2, (reliable ? FLAG_RELIABLE : 0) | 0)
  dv.setUint8(3, msgType)
  dv.setUint32(4, seq >>> 0)
  dv.setUint16(8, payload.length)
  out.set(payload, 10)
  return out
}

export function parseEnvelope(data: Uint8Array): ParsedEnvelope {
  if (data.length < 10) throw new Error(`信封过短: ${data.length}`)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (dv.getUint8(0) !== MAGIC) throw new Error('协议魔数错误')
  const ver = dv.getUint8(1)
  if (ver !== PROTOCOL_VERSION) throw new Error(`协议版本不兼容: ${ver}`)
  const flags = dv.getUint8(2)
  const msgType = dv.getUint8(3)
  const seq = dv.getUint32(4)
  const len = dv.getUint16(8)
  if (10 + len > data.length) throw new Error(`负载长度越界: ${len}`)
  return {
    reliable: (flags & FLAG_RELIABLE) !== 0,
    msgType,
    seq,
    payload: data.slice(10, 10 + len),
  }
}

// ---------- Hello / Welcome ----------

export function encodeHello(version: readonly [number, number, number], displayName: string): Uint8Array {
  const name = new TextEncoder().encode(displayName.slice(0, 32))
  const out = new Uint8Array(3 + 1 + name.length)
  const dv = new DataView(out.buffer)
  dv.setUint8(0, version[0] & 0xff)
  dv.setUint8(1, version[1] & 0xff)
  dv.setUint8(2, version[2] & 0xff)
  dv.setUint8(3, name.length)
  out.set(name, 4)
  return out
}

export function decodeWelcome(payload: Uint8Array): { playerId: number; tickRate: number; serverRttMs: number } {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return { playerId: dv.getUint32(0), tickRate: dv.getUint16(4), serverRttMs: dv.getUint32(6) }
}

// ---------- InputFrame ----------

export function encodeInputFrame(frame: InputFrame): Uint8Array {
  const out = new Uint8Array(16)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, frame.seq >>> 0)
  dv.setUint16(4, frame.buttons & 0xffff)
  dv.setInt16(6, frame.yawDelta)
  dv.setInt16(8, frame.pitchDelta)
  dv.setInt8(10, frame.forwardAxis)
  dv.setInt8(11, frame.strafeAxis)
  dv.setUint32(12, frame.clientSentAtMs >>> 0)
  return out
}

// ---------- Snapshot ----------

export function decodeSnapshot(payload: Uint8Array): { tick: number; entities: EntitySnapshot[] } {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  let off = 0
  const tick = dv.getUint32(off); off += 4
  const count = dv.getUint8(off); off += 1
  const entities: EntitySnapshot[] = []
  for (let i = 0; i < count; i++) {
    const id = dv.getUint32(off); off += 4
    const flags = dv.getUint8(off); off += 1
    const x = dv.getInt16(off); off += 2
    const y = dv.getInt16(off); off += 2
    const z = dv.getInt16(off); off += 2
    const yaw = dv.getInt16(off); off += 2
    const pitch = dv.getInt16(off); off += 2
    const health = dv.getInt16(off); off += 2
    entities.push({
      id,
      position: { x: x / 100, y: y / 100, z: z / 100 },
      yaw: yaw / 100,
      pitch: pitch / 100,
      moving: (flags & 1) !== 0,
      crouching: (flags & 2) !== 0,
      health,
      weaponId: 0,
    })
  }
  return { tick, entities }
}

// ---------- Ping / Pong / Kick ----------

export function encodePing(clientSentAtMs: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, clientSentAtMs >>> 0)
  return out
}

export function decodePong(payload: Uint8Array): { clientSentAtMs: number; serverRecvAtMs: number } {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return { clientSentAtMs: dv.getUint32(0), serverRecvAtMs: dv.getUint32(4) }
}

export function decodeKick(payload: Uint8Array): { reason: number; detail: string } {
  const reason = payload[0] ?? 0
  const detail = new TextDecoder().decode(payload.slice(1))
  return { reason, detail }
}
