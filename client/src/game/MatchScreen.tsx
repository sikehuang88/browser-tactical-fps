import { useEffect, useRef, useState } from 'react'
import { Engine } from '../core/engine'
import { InputManager } from '../core/input'
import { Renderer } from '../render/renderer'
import { buildGrayBoxScene } from '../render/scene'
import { PlayerView } from '../render/playerView'
import { EntityView } from '../render/entityView'
import { DynamicWeatherSystem } from '../render/weather'
import { Match } from './match'
import { Effects } from './effects'
import { GameConnection } from '../core/net/connection'
import { createTransport } from '../core/net/factory'
import { loadSettings } from '../ui/settings'
import { cachedTracerVisual } from '../core/tracerShop'
import { HUD } from '../ui/HUD'
import { Scoreboard } from '../ui/Scoreboard'
import type { GameModeId, Settings } from '../core/types'

/**
 * 对局页面：挂载渲染器 + 引擎 + 输入 + 音效/投掷物效果，并叠加 HUD 覆盖层。
 * React 仅负责覆盖层；对局模拟/渲染全部在引擎中。
 */
export function MatchScreen({
  onExit,
  displayName,
  mode,
}: {
  onExit: () => void
  displayName?: string
  mode: GameModeId
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const matchRef = useRef<Match | null>(null)
  const effectsRef = useRef<Effects | null>(null)
  const requestLockRef = useRef<() => void>(() => {})
  const inputRef = useRef<InputManager | null>(null)
  const settings = useRef<Settings>(loadSettings()).current

  const [match, setMatch] = useState<Match | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [lockHint, setLockHint] = useState<string | null>(null)
  const [buyMenuOpen, setBuyMenuOpen] = useState(false)
  const [backpackOpen, setBackpackOpen] = useState(false)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [startCountdown, setStartCountdown] = useState(3)
  const [showStartSignal, setShowStartSignal] = useState(false)
  const buyMenuOpenRef = useRef(false)
  const backpackOpenRef = useRef(false)
  const startCountdownStartedRef = useRef(false)
  const startCountdownTimersRef = useRef<number[]>([])

  const setBuyMenu = (open: boolean, relock = false): void => {
    if (open) setBackpack(false)
    buyMenuOpenRef.current = open
    setBuyMenuOpen(open)
    if (open) {
      document.exitPointerLock?.()
      inputRef.current?.setGameplayEnabled(false)
    } else if (relock) {
      inputRef.current?.setGameplayEnabled(true)
      requestLockRef.current()
    }
  }

  const setBackpack = (open: boolean, relock = false): void => {
    backpackOpenRef.current = open
    setBackpackOpen(open)
    if (open) {
      setBuyMenu(false)
      document.exitPointerLock?.()
      inputRef.current?.setGameplayEnabled(false)
    } else if (relock) {
      inputRef.current?.setGameplayEnabled(true)
      requestLockRef.current()
    }
  }

  const toggleBackpack = (): void => setBackpack(!backpackOpenRef.current, backpackOpenRef.current)

  const toggleBuyMenu = (): void => {
    const next = !buyMenuOpenRef.current
    if (next && matchRef.current?.round.phase !== 1) return
    setBuyMenu(next, !next)
  }

  useEffect(() => {
    return () => {
      startCountdownTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      startCountdownTimersRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!locked || startCountdownStartedRef.current) return

    startCountdownStartedRef.current = true
    setStartCountdown(3)
    setShowStartSignal(true)
    startCountdownTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    startCountdownTimersRef.current = [
      window.setTimeout(() => setStartCountdown(2), 1000),
      window.setTimeout(() => setStartCountdown(1), 2000),
      window.setTimeout(() => setStartCountdown(0), 3000),
      window.setTimeout(() => setShowStartSignal(false), 3700),
    ]
  }, [locked])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new Renderer(container, settings.fov, {
      resolutionScale: settings.resolutionScale,
      shadows: settings.shadows,
    })
    const ground = buildGrayBoxScene(renderer.scene)
    const weather = settings.weatherEnabled ? new DynamicWeatherSystem(renderer.scene) : null
    const effects = new Effects(renderer.scene)
    effects.audio.setVolumes(settings.volumeMaster, settings.volumeSfx)
    effectsRef.current = effects

    const input = new InputManager({
      container,
      lockTarget: document.body,
      sensitivity: settings.sensitivity,
      onLockChange: (l) => {
        if (l) effects.init() // 用户手势（指针锁定）后初始化音频
        setLocked(l)
        setLockHint(l ? null : '点击画面恢复鼠标视角')
        if (!backpackOpenRef.current && !buyMenuOpenRef.current) {
          inputRef.current?.setGameplayEnabled(l)
        }
      },
    })
    inputRef.current = input
    requestLockRef.current = () => input.requestLock()
    const view = new PlayerView(renderer.camera, renderer.scene, {
      effectsQuality: settings.effectsQuality,
      tracerVisual: cachedTracerVisual() ?? undefined,
    })
    const entityView = new EntityView(renderer.scene)

    const connection = new GameConnection(createTransport(false), displayName || settings.displayName || 'player', [0, 1, 0])
    const m = new Match({
      online: settings.online,
      mode,
      connection,
      onError: setError,
      onKill: () => effects.onKill(),
      onHit: ({ killed }) => effects.onHit(killed),
      onHurt: (damage) => effects.onHurt(damage),
    })
    matchRef.current = m
    setMatch(m)

    const engine = new Engine({ input, match: m, view, entityView, renderer, effects, weather: weather ?? undefined, ground, fixedHz: 64 })
    engine.start()

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Tab') {
        e.preventDefault()
        setShowScoreboard((value) => !value)
      } else if (e.code === 'KeyB' && !e.repeat) {
        e.preventDefault()
        toggleBuyMenu()
      } else if (e.code === 'KeyI' && !e.repeat) {
        e.preventDefault()
        toggleBackpack()
      } else if (e.code === 'KeyF' && !e.repeat) {
        e.preventDefault()
        matchRef.current?.cycleSpectateTarget()
      } else if (e.code === 'KeyG' && !e.repeat) {
        e.preventDefault()
        matchRef.current?.setGodView()
      } else if (e.code === 'Escape') {
        e.preventDefault()
        if (backpackOpenRef.current) setBackpack(false, true)
        else if (buyMenuOpenRef.current) setBuyMenu(false, true)
      }
    }
    window.addEventListener('keydown', onKey)

    // Keep the four explicit match shortcuts, while blocking browser/system shortcuts.
    const blockMatchShortcuts = (e: KeyboardEvent): void => {
      const browserShortcut = e.ctrlKey || e.altKey || e.metaKey
      const functionKey = /^F(?:[1-9]|1[0-2])$/.test(e.key)
      if (browserShortcut || functionKey) {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', blockMatchShortcuts, { capture: true })

    // 联网模式：握手后由服务器下发 playerId；本地演示直接进入
    void m.start(settings.serverUrl)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', blockMatchShortcuts, { capture: true })
      engine.stop()
      input.dispose()
      inputRef.current = null
      view.dispose()
      entityView.clear()
      weather?.dispose()
      ground.dispose()
      renderer.dispose()
      effects.dispose()
      connection.close()
      requestLockRef.current = () => {}
    }
  }, [displayName, settings])

  const handleBuy = (itemId: number): void => {
    matchRef.current?.buyItem(itemId)
    effectsRef.current?.onBuy()
  }

  const handleSelectPrimary = (weaponId: number): void => {
    matchRef.current?.selectPrimaryWeapon(weaponId)
    setBackpack(false, true)
  }

  return (
    <div className={locked ? 'match-screen input-locked' : 'match-screen'}>
      <div ref={containerRef} className="canvas-container" />

      <HUD
        match={match}
        settings={settings}
        onExit={onExit}
        buyMenuOpen={buyMenuOpen}
        onToggleBuy={toggleBuyMenu}
        onBuy={handleBuy}
        backpackOpen={backpackOpen}
        onToggleBackpack={toggleBackpack}
        onSelectPrimary={handleSelectPrimary}
      />
      {!locked && !backpackOpen && !buyMenuOpen && !error && (
        <div className="hud-lock-hint" role="status">
          <span>{lockHint ?? '点击画面恢复鼠标视角'}</span>
          <button className="btn small" onClick={() => requestLockRef.current()}>恢复鼠标控制</button>
        </div>
      )}
      {showScoreboard && match && <Scoreboard match={match} />}

      {error && (
        <div className="error-overlay">
          <div className="error-text">连接错误：{error}</div>
          <button className="btn primary" onClick={onExit}>
            返回大厅
          </button>
        </div>
      )}

      {showStartSignal && locked && !error && (
        <div className="start-countdown-overlay" aria-live="polite">
          {startCountdown > 0 ? (
            <div className="start-countdown-number">{startCountdown}</div>
          ) : (
            <div className="start-countdown-go">开始行动</div>
          )}
        </div>
      )}
    </div>
  )
}
