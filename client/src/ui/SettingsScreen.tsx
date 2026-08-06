import { useState } from 'react'
import { loadSettings, saveSettings } from './settings'
import type { Settings } from '../core/types'

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<Settings>(() => loadSettings())
  const update = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }))

  const save = () => {
    saveSettings(s)
    onBack()
  }

  return (
    <div className="screen">
      <div className="panel settings">
        <h1 className="title">设置</h1>

        <label className="row">
          <span>显示名</span>
          <input
            value={s.displayName}
            onChange={(e) => update({ displayName: e.target.value.slice(0, 32) })}
            maxLength={32}
          />
        </label>

        <label className="row">
          <span>联网对拍</span>
          <input type="checkbox" checked={s.online} onChange={(e) => update({ online: e.target.checked })} />
        </label>

        <label className="row">
          <span>服务器地址</span>
          <input
            value={s.serverUrl}
            onChange={(e) => update({ serverUrl: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="row">
          <span>灵敏度 {s.sensitivity.toFixed(2)}</span>
          <input
            type="range"
            min={0.03}
            max={0.6}
            step={0.01}
            value={s.sensitivity}
            onChange={(e) => update({ sensitivity: Number(e.target.value) })}
          />
        </label>

        <label className="row">
          <span>视野 {s.fov}°</span>
          <input
            type="range"
            min={70}
            max={110}
            step={1}
            value={s.fov}
            onChange={(e) => update({ fov: Number(e.target.value) })}
          />
        </label>

        <label className="row">
          <span>准星颜色</span>
          <input
            type="color"
            value={s.crosshairColor}
            onChange={(e) => update({ crosshairColor: e.target.value })}
          />
        </label>

        <div className="btn-row">
          <button className="btn primary" onClick={save}>
            保存
          </button>
          <button className="btn" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
    </div>
  )
}
