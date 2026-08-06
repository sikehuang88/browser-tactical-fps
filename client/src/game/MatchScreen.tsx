import { useEffect, useRef, useState } from 'react'
import { Engine } from '../core/engine'
import { InputManager } from '../core/input'
import { Renderer } from '../render/renderer'
import { buildGrayBoxScene } from '../render/scene'
import { PlayerView } from '../render/playerView'
import { EntityView } from '../render/entityView'
import { Match } from './match'
import { Effects } from './effects'
import { GameConnection } from '../core/net/connection'
import { createTransport } from '../core/net/factory'
import { loadSettings } from '../ui/settings'
import { HUD } from '../ui/HUD'
import { Scoreboard } from '../ui/Scoreboard'
import type { Settings } from '../core/types'

/**
 * 对局页面：挂载渲染器 + 引擎 + 输入 + 音效/投掷物效果，并叠加 HUD 覆盖层。
 * React 仅负责覆盖层；对局模拟/渲染全部在引擎中。
 */
export function MatchScreen({ onExit }: { onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const matchRef = useRef<Match | null>(null)
  const effectsRef = useRef<Effects | null>(null)
  const settings = useRef<Settings>(loadSettings()).current

  const [match, setMatch] = useState<Match | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [buyMenuOpen, setBuyMenuOpen] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new Renderer(container, settings.fov)
    buildGrayBoxScene(renderer.scene)
    const effects = new Effects(renderer.scene)
    effects.audio.setVolumes(settings.volumeMaster, settings.volumeSfx)
    effectsRef.current = effects

    const input = new InputManager({
      container,
      sensitivity: settings.sensitivity,
      onLockChange: (l) => {
        if (l) effects.init() // 用户手势（指针锁定）后初始化音频
        setLocked(l)
      },
    })
    const view = new PlayerView(renderer.camera, renderer.scene)
    const entityView = new EntityView(renderer.scene)

    const connection = new GameConnection(createTransport(false), settings.displayName || 'player', [0, 1, 0])
    const m = new Match({
      online: settings.online,
      connection,
      onError: setError,
      onKill: () => effects.onKill(),
    })
    matchRef.current = m
    setMatch(m)

    const engine = new Engine({ input, match: m, view, entityView, renderer, effects, fixedHz: 64 })
    engine.start()

    // 联网模式：握手后由服务器下发 playerId；本地演示直接进入
    void m.start(settings.serverUrl)

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        setShowScoreboard((v) => !v)
      } else if (e.code === 'KeyB') {
        setBuyMenuOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      engine.stop()
      input.dispose()
      renderer.dispose()
      effects.dispose()
      connection.close()
    }
  }, [settings])

  const handleBuy = (itemId: number): void => {
    matchRef.current?.buyItem(itemId)
    effectsRef.current?.onBuy()
  }

  return (
    <div className="match-screen">
      <div ref={containerRef} className="canvas-container" />

      <HUD
        match={match}
        settings={settings}
        onExit={onExit}
        buyMenuOpen={buyMenuOpen}
        onToggleBuy={() => setBuyMenuOpen((v) => !v)}
        onBuy={handleBuy}
      />
      {showScoreboard && match && <Scoreboard match={match} />}

      {!locked && (
        <div className="lock-overlay">
          <div className="lock-title">点击画面锁定鼠标开始游玩</div>
          <div className="key-hints">
            <span>WASD 移动</span>
            <span>空格 跳跃</span>
            <span>Ctrl 下蹲</span>
            <span>Shift 疾跑</span>
            <span>左键 开火</span>
            <span>R 换弹</span>
            <span>E 安装/拆除</span>
            <span>4 高爆</span>
            <span>5 闪光</span>
            <span>6 烟雾</span>
            <span>B 购买</span>
            <span>Tab 计分板</span>
          </div>
        </div>
      )}

      {error && (
        <div className="error-overlay">
          <div className="error-text">连接错误：{error}</div>
          <button className="btn primary" onClick={onExit}>
            返回大厅
          </button>
        </div>
      )}
    </div>
  )
}
