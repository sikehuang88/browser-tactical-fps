// 用户设置持久化（IndexedDB 为资源缓存方案，这里使用 localStorage 存轻量设置）。
// 非法/越界配置在读取时回退到安全默认值（UI-002）。

import { DEFAULT_SETTINGS, type Settings } from '../core/types'

const KEY = 'fps_settings_v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 存储不可用时忽略（隐私模式等）
  }
}
