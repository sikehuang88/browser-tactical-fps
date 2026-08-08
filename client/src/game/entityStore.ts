// 服务器已确认的实体最近状态缓存（供计分板/统计等低频使用；高频渲染走插值器）。

import type { EntitySnapshot } from '../core/types'

export class EntityStore {
  private readonly map = new Map<number, EntitySnapshot>()

  apply(entities: EntitySnapshot[]): void {
    this.map.clear()
    for (const e of entities) this.map.set(e.id, e)
  }

  get(id: number): EntitySnapshot | undefined {
    return this.map.get(id)
  }

  all(): EntitySnapshot[] {
    return [...this.map.values()]
  }

  clear(): void {
    this.map.clear()
  }
}
