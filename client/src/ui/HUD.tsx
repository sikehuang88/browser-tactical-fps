import { useEffect, useState } from 'react'
import type { Match } from '../game/match'
import { getWeapon } from '../game/weapons/registry'
import type { Settings } from '../core/types'

interface HudSnap {
  health: number
  ammo: number
  reloading: boolean
  rtt: number
  connected: boolean
  status: string
}

/** 对局 HUD：低频轮询引擎状态渲染，避免高频 React 重渲染。 */
export function HUD({ match, settings, onExit }: { match: Match | null; settings: Settings; onExit: () => void }) {
  const [snap, setSnap] = useState<HudSnap>({
    health: 100,
    ammo: 30,
    reloading: false,
    rtt: 0,
    connected: false,
    status: '…',
  })

  useEffect(() => {
    const iv = setInterval(() => {
      if (!match) return
      const s = match.localState
      setSnap({
        health: s.health,
        ammo: s.ammo,
        reloading: s.reloading,
        rtt: match.rttMs,
        connected: match.connected,
        status: match.statusText,
      })
    }, 100)
    return () => clearInterval(iv)
  }, [match])

  const weapon = getWeapon(match?.localState.weaponId ?? 1)

  return (
    <div className="hud">
      <div className="crosshair" style={{ color: settings.crosshairColor }} />
      <div className="hud-top-left">
        <div>生命 {snap.health}</div>
        <div className={snap.connected ? 'status ok' : 'status'}>{snap.status}</div>
        {snap.connected && <div>RTT {snap.rtt} ms</div>}
      </div>

      <div className="hud-bottom-right">
        <div>{weapon?.displayName ?? '—'}</div>
        <div className={snap.reloading ? 'ammo reloading' : 'ammo'}>{snap.ammo}</div>
      </div>

      <div className="hud-top-right">
        <button className="btn small" onClick={onExit}>
          退出对局
        </button>
      </div>
    </div>
  )
}
