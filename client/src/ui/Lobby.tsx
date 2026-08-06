import { useState } from 'react'
import { loadSettings } from './settings'
import { listWeapons } from '../game/weapons/registry'

export function Lobby({ onStart, onSettings }: { onStart: () => void; onSettings: () => void }) {
  const [settings] = useState(() => loadSettings())

  return (
    <div className="screen">
      <div className="panel lobby">
        <h1 className="title">战术竞技 FPS</h1>
        <p className="subtitle">5v5 爆破模式 · 浏览器内运行 · 原创独立项目</p>

        <div className="lobby-info">
          <div>
            模式：<b>{settings.online ? '联网对拍（服务器权威）' : '本地演示（本地权威）'}</b>
          </div>
          <div>
            服务器：<code>{settings.serverUrl}</code>
          </div>
          <div>
            玩家：<b>{settings.displayName || 'player'}</b>
          </div>
          <div className="weapon-list">武器：{listWeapons().map((w) => w.displayName).join(' · ')}</div>
        </div>

        <div className="btn-row">
          <button className="btn primary" onClick={onStart}>
            开始对局
          </button>
          <button className="btn" onClick={onSettings}>
            设置
          </button>
        </div>
      </div>
    </div>
  )
}
