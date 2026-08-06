// 远端实体快照插值：缓冲最近快照，按渲染时刻向后偏移固定延迟，在两帧间插值。
// M0 以本地接收时间为插值轴；后续接入服务器时钟同步后改为服务器时间轴（对应 NET-005）。

import type { EntitySnapshot } from '../core/types'
import type { ServerSnapshot } from '../core/net/connection'

interface TimedSnapshot {
  tick: number
  receivedAtMs: number
  entities: EntitySnapshot[]
}

export class SnapshotInterpolator {
  private readonly buffer: TimedSnapshot[] = []
  private readonly historyMs = 1000

  add(snapshot: ServerSnapshot, receivedAtMs: number): void {
    this.buffer.push({ tick: snapshot.tick, receivedAtMs, entities: snapshot.entities })
    this.prune(receivedAtMs)
  }

  /** 返回渲染时刻 nowMs - renderDelayMs 处的实体状态。 */
  entitiesAt(nowMs: number, renderDelayMs = 100): EntitySnapshot[] {
    const b = this.buffer
    if (b.length === 0) return []
    const t = nowMs - renderDelayMs

    let a = b[0]
    let c = b[b.length - 1]
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].receivedAtMs <= t && b[i + 1].receivedAtMs >= t) {
        a = b[i]
        c = b[i + 1]
        break
      }
    }

    const span = c.receivedAtMs - a.receivedAtMs
    const f = span <= 0 ? 1 : clamp((t - a.receivedAtMs) / span, 0, 1)
    return lerpEntities(a.entities, c.entities, f)
  }

  clear(): void {
    this.buffer.length = 0
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.historyMs
    while (this.buffer.length > 1 && this.buffer[0].receivedAtMs < cutoff) {
      this.buffer.shift()
    }
  }
}

function lerpEntities(a: EntitySnapshot[], c: EntitySnapshot[], f: number): EntitySnapshot[] {
  const byId = new Map<number, EntitySnapshot>()
  for (const e of c) byId.set(e.id, e)
  for (const e of a) if (!byId.has(e.id)) byId.set(e.id, e)

  const out: EntitySnapshot[] = []
  for (const [id, end] of byId) {
    const start = a.find((e) => e.id === id)
    if (!start) {
      out.push(end)
      continue
    }
    out.push({
      id,
      position: {
        x: start.position.x + (end.position.x - start.position.x) * f,
        y: start.position.y + (end.position.y - start.position.y) * f,
        z: start.position.z + (end.position.z - start.position.z) * f,
      },
      yaw: lerpAngle(start.yaw, end.yaw, f),
      pitch: start.pitch + (end.pitch - start.pitch) * f,
      moving: end.moving,
      crouching: end.crouching,
      health: end.health,
      weaponId: end.weaponId,
      team: end.team,
    })
  }
  return out
}

function lerpAngle(a: number, b: number, f: number): number {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return a + d * f
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
