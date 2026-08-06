import { useEffect, useState } from 'react'
import type { Match } from '../game/match'
import { getWeapon } from '../game/weapons/registry'
import { SHOP_ITEMS } from '../game/shop'
import type { Settings } from '../core/types'

const PHASE_LABEL = ['—', '冻结', '行动', '回合结束', '对局结束']
const BOMB_LABEL = ['未安装', '安装中…', '已安装', '拆除中…', '已爆炸', '已拆除']
const TEAM_LABEL = ['未分配', '攻击方', '防守方']

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const sec = String(total % 60).padStart(2, '0')
  return `${m}:${sec}`
}

interface HUDProps {
  match: Match | null
  settings: Settings
  onExit: () => void
  buyMenuOpen: boolean
  onToggleBuy: () => void
  onBuy: (itemId: number) => void
}

/** 对局 HUD：回合信息/击杀播报/生命/弹药/金钱/投掷物/购买菜单/闪光。 */
export function HUD({ match, settings, onExit, buyMenuOpen, onToggleBuy, onBuy }: HUDProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(iv)
  }, [])

  const s = match?.localState
  const health = s?.health ?? 100
  const ammo = s?.ammo ?? 30
  const reloading = s?.reloading ?? false
  const team = s?.team ?? 0
  const round = match?.round
  const remaining = round ? match!.roundTimeRemaining() : 0
  const weapon = getWeapon(s?.weaponId ?? 1)
  const killFeed = match?.killFeed ?? []
  const matchEnd = match?.matchEnd ?? null
  const g = match?.grenades
  const inBuyPhase = match?.online && round?.phase === 1

  return (
    <div className="hud">
      <div className="crosshair" style={{ color: settings.crosshairColor }} />

      {/* 顶部中央：回合信息 */}
      {round && round.round > 0 && (
        <div className="hud-top-center">
          <div className="scorebar">
            <span className="score atk">{round.attackScore}</span>
            <span className="phase">
              {PHASE_LABEL[round.phase]} · 第 {round.round} 回合
            </span>
            <span className="score def">{round.defendScore}</span>
          </div>
          <div className="round-meta">
            <span>⏱ {formatTime(remaining)}</span>
            <span className={round.bomb >= 2 ? 'bomb planted' : 'bomb'}>
              {BOMB_LABEL[round.bomb]}
              {round.bomb === 2 ? ` @ ${round.bombSite === 0 ? 'A' : 'B'}` : ''}
            </span>
            <span>队伍：{TEAM_LABEL[team]}</span>
          </div>
        </div>
      )}

      <div className="hud-top-left">
        <div>生命 {health}</div>
        {match?.armor ? <div className="status ok">护甲</div> : null}
        <div className={match?.connected ? 'status ok' : 'status'}>{match?.statusText ?? '…'}</div>
        {match?.connected && <div>RTT {match.rttMs} ms</div>}
      </div>

      {/* 底部左侧：击杀播报 */}
      {killFeed.length > 0 && (
        <div className="kill-feed">
          {killFeed.slice(-5).map((k, i) => (
            <div key={`${k.atMs}-${i}`} className="kill">
              #{k.attackerId} <span className="arrow">▸</span> #{k.victimId}
              {k.headshot ? ' ☠' : ''}
            </div>
          ))}
        </div>
      )}

      {/* 底部右侧：武器/弹药/金钱/投掷物 */}
      <div className="hud-bottom-right">
        <div>{weapon?.displayName ?? '—'}</div>
        <div className={reloading ? 'ammo reloading' : 'ammo'}>{ammo}</div>
        <div className="money">${match?.money ?? 0}</div>
        {g && (g.smoke > 0 || g.flash > 0 || g.he > 0) && (
          <div className="grenades">
            {g.he > 0 && <span className="g-he">✷{g.he}</span>}
            {g.flash > 0 && <span className="g-flash">◈{g.flash}</span>}
            {g.smoke > 0 && <span className="g-smoke">☁{g.smoke}</span>}
          </div>
        )}
      </div>

      <div className="hud-top-right">
        {match?.online && (
          <button className="btn small" onClick={onToggleBuy}>
            购买菜单 (B)
          </button>
        )}
        <button className="btn small" onClick={onExit}>
          退出对局
        </button>
      </div>

      {/* 购买菜单（冻结期 + 联网） */}
      {inBuyPhase && buyMenuOpen && (
        <div className="buy-menu">
          <div className="buy-title">购买装备 · 资金 ${match?.money ?? 0}</div>
          <div className="buy-grid">
            {SHOP_ITEMS.map((item) => {
              const affordable = (match?.money ?? 0) >= item.cost
              return (
                <button
                  key={item.id}
                  className={affordable ? 'buy-item' : 'buy-item disabled'}
                  disabled={!affordable}
                  onClick={() => onBuy(item.id)}
                >
                  <span>{item.name}</span>
                  <span className="cost">${item.cost}</span>
                </button>
              )
            })}
          </div>
          <div className="buy-hint">点击购买 · 再次购买同款武器即退款 · Esc 关闭</div>
        </div>
      )}

      {/* 死亡覆盖 */}
      {match?.online && health <= 0 && !matchEnd && (
        <div className="overlay death">
          <div>你已阵亡，等待下回合重生…</div>
        </div>
      )}

      {/* 对局结束覆盖 */}
      {matchEnd && (
        <div className="overlay match-end">
          <div className="match-end-title">对局结束</div>
          <div className="match-end-score">
            {matchEnd.attackScore} : {matchEnd.defendScore}
          </div>
          <div className="match-end-result">
            {matchEnd.winner === team
              ? '你所在队伍获胜！'
              : matchEnd.winner === 0
                ? '平局'
                : '对方获胜'}
          </div>
          <button className="btn primary" onClick={onExit}>
            返回大厅
          </button>
        </div>
      )}
    </div>
  )
}
