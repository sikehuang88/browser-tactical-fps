import { useState } from 'react'
import {
  ArrowLeft,
  Crosshair,
  Gamepad2,
  MonitorCog,
  RotateCcw,
  Save,
  Volume2,
  X,
} from 'lucide-react'
import { DEFAULT_SETTINGS, type Settings } from '../core/types'
import { loadSettings, saveSettings } from './settings'

type QualityPreset = Exclude<Settings['quality'], 'custom'>

const QUALITY_PRESETS: Array<{
  id: QualityPreset
  label: string
  hint: string
  values: Partial<Settings>
}> = [
  {
    id: 'low',
    label: '低',
    hint: '60% 分辨率 · 无阴影 · 关天气',
    values: { resolutionScale: 0.6, shadows: false, weatherEnabled: false, effectsQuality: 'low' },
  },
  {
    id: 'medium',
    label: '中',
    hint: '80% 分辨率 · 无阴影 · 开天气',
    values: { resolutionScale: 0.8, shadows: false, weatherEnabled: true, effectsQuality: 'low' },
  },
  {
    id: 'high',
    label: '高',
    hint: '100% 分辨率 · 无阴影 · 完整特效',
    values: { resolutionScale: 1, shadows: false, weatherEnabled: true, effectsQuality: 'high' },
  },
  {
    id: 'ultra',
    label: '超高',
    hint: '100% 分辨率 · 阴影 · 完整特效',
    values: { resolutionScale: 1, shadows: true, weatherEnabled: true, effectsQuality: 'high' },
  },
]

const GRAPHICS_KEYS: Array<keyof Settings> = [
  'resolutionScale',
  'shadows',
  'weatherEnabled',
  'effectsQuality',
]

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<Settings>(() => loadSettings())

  const update = (patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch }
      if (GRAPHICS_KEYS.some((key) => key in patch) && next.quality !== 'custom') {
        next.quality = 'custom'
      }
      return next
    })
  }

  const applyPreset = (id: QualityPreset) => {
    const preset = QUALITY_PRESETS.find((item) => item.id === id)
    if (!preset) return
    setS((prev) => ({ ...prev, quality: id, ...preset.values }))
  }

  const resetDefaults = () => setS({ ...DEFAULT_SETTINGS })

  const save = () => {
    saveSettings(s)
    onBack()
  }

  return (
    <div className="settings-screen">
      <div className="settings-backdrop" aria-hidden="true" />
      <div className="settings-panel">
        <header className="settings-header">
          <div>
            <span className="settings-kicker">SYSTEM CONFIG</span>
            <h1>设置</h1>
            <p>画质与基础配置</p>
          </div>
          <button className="icon-button" onClick={onBack} aria-label="关闭设置" title="关闭">
            <X size={20} />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <h2><MonitorCog size={17} />画质</h2>
            <div className="settings-grid">
              <SettingRow label="画质预设" hint="快速切换整体画面档位">
                <div className="segmented">
                  {QUALITY_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={s.quality === preset.id ? 'active' : ''}
                      onClick={() => applyPreset(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="分辨率缩放" hint="降低可明显提升帧率">
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={5}
                  value={Math.round(s.resolutionScale * 100)}
                  onChange={(e) => update({ resolutionScale: Number(e.target.value) / 100 })}
                />
                <span className="setting-value">{Math.round(s.resolutionScale * 100)}%</span>
              </SettingRow>

              <SettingRow label="阴影" hint="开启后地面与墙体投影">
                <Toggle checked={s.shadows} onChange={(value) => update({ shadows: value })} />
              </SettingRow>

              <SettingRow label="天气特效" hint="云层、雨雪与闪电">
                <Toggle checked={s.weatherEnabled} onChange={(value) => update({ weatherEnabled: value })} />
              </SettingRow>

              <SettingRow label="特效质量" hint="低：仅保留枪口闪光">
                <div className="segmented small">
                  <button className={s.effectsQuality === 'low' ? 'active' : ''} onClick={() => update({ effectsQuality: 'low' })}>低</button>
                  <button className={s.effectsQuality === 'high' ? 'active' : ''} onClick={() => update({ effectsQuality: 'high' })}>高</button>
                </div>
              </SettingRow>
            </div>
          </section>

          <section className="settings-section">
            <h2><Gamepad2 size={17} />游戏</h2>
            <div className="settings-grid">
              <SettingRow label="显示名" hint="对局内展示的名称">
                <input
                  type="text"
                  value={s.displayName}
                  maxLength={32}
                  spellCheck={false}
                  onChange={(e) => update({ displayName: e.target.value.slice(0, 32) })}
                />
              </SettingRow>

              <SettingRow label="联网对局" hint="关闭时使用离线演示模式">
                <Toggle checked={s.online} onChange={(value) => update({ online: value })} />
              </SettingRow>

              <SettingRow label="服务器地址" hint="联网模式连接的实时服务器">
                <input
                  type="text"
                  value={s.serverUrl}
                  spellCheck={false}
                  onChange={(e) => update({ serverUrl: e.target.value })}
                />
              </SettingRow>

              <SettingRow label="鼠标灵敏度" hint="准星移动速度">
                <input
                  type="range"
                  min={0.03}
                  max={0.6}
                  step={0.01}
                  value={s.sensitivity}
                  onChange={(e) => update({ sensitivity: Number(e.target.value) })}
                />
                <span className="setting-value">{s.sensitivity.toFixed(2)}</span>
              </SettingRow>

              <SettingRow label="视野" hint="第一人称视角范围">
                <input
                  type="range"
                  min={70}
                  max={110}
                  step={1}
                  value={s.fov}
                  onChange={(e) => update({ fov: Number(e.target.value) })}
                />
                <span className="setting-value">{s.fov}°</span>
              </SettingRow>
            </div>
          </section>

          <section className="settings-section">
            <h2><Crosshair size={17} />准星</h2>
            <div className="settings-grid">
              <SettingRow label="准星颜色" hint="HUD 准星与命中反馈">
                <input
                  type="color"
                  value={s.crosshairColor}
                  onChange={(e) => update({ crosshairColor: e.target.value })}
                />
                <span className="setting-value">{s.crosshairColor.toUpperCase()}</span>
              </SettingRow>
            </div>
          </section>

          <section className="settings-section">
            <h2><Volume2 size={17} />音频</h2>
            <div className="settings-grid">
              <SettingRow label="主音量" hint="整体音量">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(s.volumeMaster * 100)}
                  onChange={(e) => update({ volumeMaster: Number(e.target.value) / 100 })}
                />
                <span className="setting-value">{Math.round(s.volumeMaster * 100)}%</span>
              </SettingRow>

              <SettingRow label="音效音量" hint="枪声、脚步与投掷物">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(s.volumeSfx * 100)}
                  onChange={(e) => update({ volumeSfx: Number(e.target.value) / 100 })}
                />
                <span className="setting-value">{Math.round(s.volumeSfx * 100)}%</span>
              </SettingRow>
            </div>
          </section>
        </div>

        <footer className="settings-footer">
          <button className="btn" onClick={resetDefaults}>
            <RotateCcw size={15} />恢复默认
          </button>
          <div className="settings-footer-actions">
            <button className="btn" onClick={onBack}>
              <ArrowLeft size={15} />取消
            </button>
            <button className="btn primary" onClick={save}>
              <Save size={15} />保存并返回
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}
