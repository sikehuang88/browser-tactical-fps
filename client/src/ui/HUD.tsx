import { useEffect, useState } from 'react'
import { Crosshair, Heart, Shield, Radio, Volume2, Siren, Skull, Bomb, Zap, Backpack, X, Check, LockKeyhole } from 'lucide-react'
import { TEAM_DEATHMATCH_LIMIT, type Match } from '../game/match'
import { getWeapon } from '../game/weapons/registry'
import { SHOP_ITEMS } from '../game/shop'
import { ARENA_BOUNDS } from '../game/map'
import type { Settings } from '../core/types'

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const sec = String(total % 60).padStart(2, '0')
  return `${m}:${sec}`
}

function mapPercent(value: number, min: number, max: number): number {
  return Math.max(4, Math.min(96, ((value - min) / (max - min)) * 100))
}

interface HUDProps {
  match: Match | null
  settings: Settings
  onExit: () => void
  buyMenuOpen: boolean
  onToggleBuy: () => void
  onBuy: (itemId: number) => void
  backpackOpen: boolean
  onToggleBackpack: () => void
  onSelectPrimary: (weaponId: number) => void
}

/** 对局 HUD：回合信息/击杀播报/生命/弹药/金钱/投掷物/购买菜单/闪光。 */
export function HUD({ match, settings, onExit, buyMenuOpen, onToggleBuy, onBuy, backpackOpen, onToggleBackpack, onSelectPrimary }: HUDProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(iv)
  }, [])

  const s = match?.localState
  const health = s?.health ?? 100
  const ammo = s?.ammo ?? 30
  const team = s?.team ?? 0
  const round = match?.round
  const remaining = round ? match!.roundTimeRemaining() : 0
  const weapon = getWeapon(s?.weaponId ?? 1)
  const melee = weapon?.category === 'melee'
  const killFeed = match?.killFeed ?? []
  const hitFeedback = match?.hitFeedback
  const hitActive = Boolean(hitFeedback && performance.now() - hitFeedback.atMs < (hitFeedback.kind === 'kill' ? 420 : 180))
  const hurtFeedback = match?.hurtFeedback
  const hurtActive = Boolean(hurtFeedback && performance.now() - hurtFeedback.atMs < 260)
  const matchEnd = match?.matchEnd ?? null
  const demolition = match?.mode === 'demolition'
  const knownEntities = match?.knownEntities() ?? []
  const aliveAttack = knownEntities.filter((entity) => entity.team === 1 && entity.health > 0).length
  const aliveDefend = knownEntities.filter((entity) => entity.team === 2 && entity.health > 0).length
  const g = match?.grenades
  const inBuyPhase = (match?.online || demolition) && round?.phase === 1
  const primaryWeapons = SHOP_ITEMS.filter((item) => item.weaponId !== undefined)
  const selectedPrimaryId = match?.primaryWeaponId
  const localMapPosition = s
    ? { left: mapPercent(s.position.x, ARENA_BOUNDS.min.x, ARENA_BOUNDS.max.x), top: mapPercent(s.position.z, ARENA_BOUNDS.min.z, ARENA_BOUNDS.max.z) }
    : { left: 50, top: 50 }
  const mapPanStyle = {
    ['--map-pan-x' as string]: `${50 - localMapPosition.left}%`,
    ['--map-pan-y' as string]: `${50 - localMapPosition.top}%`,
  }
  const teammates = (match?.knownEntities() ?? [])
    .filter((entity) => entity.id !== s?.id && entity.health > 0 && entity.team === team)

  const localName = settings.displayName || 'GhostRecon'
  const displayNameOf = (id: number): string => id === s?.id ? localName : match?.online ? `#${id}` : `BOT-${id - 99}`
  const roster = [
    { id: s?.id ?? 0, name: localName, active: true, health },
    ...teammates.map((entity) => ({
      id: entity.id,
      name: entity.displayName ?? (entity.isBot ? `BOT-${entity.id - 99}` : `#${entity.id}`),
      active: false,
      health: entity.health,
    })),
  ]

  return (
    <div className="hud">
      {!match?.spectating && (
        <div className={`${s?.aiming && s.weaponId === 4 ? 'crosshair scoped' : 'crosshair'} ${hitActive ? `hit-confirm ${hitFeedback?.kind ?? 'hit'}` : ''}`} style={{ color: settings.crosshairColor }}>
          {s?.aiming && s.weaponId === 4 && <><i className="scope-ring" /><i className="scope-crosshair horizontal" /><i className="scope-crosshair vertical" /><i className="scope-dot" /><span className="scope-mark scope-mark-left">1</span><span className="scope-mark scope-mark-right">1</span><span className="scope-mark scope-mark-bottom">2</span></>}
        </div>
      )}
      {hitActive && (
        <div className={`hit-feedback-overlay ${hitFeedback?.kind ?? 'hit'}`} aria-live="polite">
          <strong>{hitFeedback?.kind === 'kill' ? '击杀确认' : '命中确认'}</strong>
          {hitFeedback?.damage ? <span>-{hitFeedback.damage}</span> : null}
        </div>
      )}
      {hurtActive && (
        <div className="hurt-feedback-overlay" aria-live="polite">
          <strong>受到攻击</strong>
          <span>-{hurtFeedback?.damage}</span>
        </div>
      )}
      {hurtActive && <div className="damage-vignette" aria-hidden="true" />}

      <section className="hud-vitals">
        <div className="hud-vital"><Heart size={24} /><strong>{health}</strong><span>Health</span></div>
        <div className="hud-vital"><Shield size={24} /><strong>{match?.armor ?? 0}</strong><span>Armor</span></div>
        <div className="hud-vital-bar"><i style={{ width: `${Math.max(0, Math.min(100, health))}%` }} /></div>
        <div className="hud-mode">{match?.online ? 'ONLINE MATCH' : 'OFFLINE · 5V5 · 1 PLAYER + 9 BOT'}</div>
      </section>

      <section className="hud-scoreboard-top">
        <div className="hud-team-score blue"><span className="hud-team-emblem">✦</span><strong>{round?.attackScore ?? 0}</strong>{demolition && <small>{aliveAttack} 存活</small>}</div>
        <div className="hud-round-clock"><strong>{match?.online || demolition ? formatTime(remaining) : 'TDM'}</strong><span>{match?.online || demolition ? `Round ${round?.round || 1}` : '团队竞技'}</span></div>
        <div className="hud-team-score orange"><strong>{round?.defendScore ?? 0}</strong>{demolition && <small>{aliveDefend} 存活</small>}<span className="hud-team-emblem">✧</span></div>
        <div className={demolition ? 'hud-target demolition' : 'hud-target'}><span>TARGET</span><strong>{demolition ? '10 ROUNDS' : match?.online ? 'BO3' : `${TEAM_DEATHMATCH_LIMIT} KILLS`}</strong><div className="hud-pips">{Array.from({ length: demolition ? 10 : match?.online ? 3 : 7 }, (_, i) => <i key={i} />)}</div></div>
        {demolition && round?.phase === 2 && s && (
          <div className="hud-bomb-hint">
            {round.bomb === 1
              ? '正在安装炸弹…'
              : round.bomb === 3
                ? '正在拆除炸弹…'
                : round.bomb === 2
                  ? s.team === 2
                    ? '按住 E 拆除炸弹'
                    : '炸弹已安装'
                  : s.team === 1
                    ? '前往 A/B/C 点按住 E 安装炸弹'
                    : '守住炸弹点'}
          </div>
        )}
      </section>

      <section className="hud-killfeed">
        {killFeed.slice(-3).map((k, i) => <div key={`${k.atMs}-${i}`}><b>{displayNameOf(k.attackerId)}</b><span><Crosshair size={13} /> {k.headshot ? 'HEADSHOT' : 'ELIMINATION'}</span><em>{displayNameOf(k.victimId)}</em></div>)}
        {killFeed.length === 0 && <div><b>{localName}</b><span><Radio size={13} /> READY</span><em>战术频道</em></div>}
      </section>

      <section className="hud-minimap">
        <div className="hud-compass"><span>N</span><span>W</span><span>E</span><span>S</span></div>
        <div className="hud-map-grid">
          <div className="map-world" style={mapPanStyle}>
            <i className="map-wall map-wall-a" /><i className="map-wall map-wall-b" /><i className="map-wall map-wall-c" />
            <i className="map-site map-site-a">A</i><i className="map-site map-site-b">B</i><i className="map-site map-site-c">C</i>
            {teammates.map((entity) => <i key={entity.id} className="map-teammate" style={{ left: `${mapPercent(entity.position.x, ARENA_BOUNDS.min.x, ARENA_BOUNDS.max.x)}%`, top: `${mapPercent(entity.position.z, ARENA_BOUNDS.min.z, ARENA_BOUNDS.max.z)}%` }} />)}
          </div>
          <i className="map-player" style={{ ['--map-rotation' as string]: `${s?.yaw ?? 0}deg` }} />
        </div>
      </section>

      <section className="hud-roster">
        {roster.map((player) => <div key={player.id} className={player.active ? 'hud-roster-row active' : 'hud-roster-row'}><div className="hud-avatar"><Skull size={20} /></div><span className="hud-roster-id">{player.id}</span><div className="hud-roster-copy"><strong>{player.name}</strong><i><b style={{ width: `${player.health}%` }} /></i></div><Volume2 size={16} /><Radio size={16} /></div>)}
      </section>

      <section className="hud-weapon-panel">
        <div className="hud-weapon-name">{weapon?.displayName === '狙击枪 M1' ? 'Barrett M1' : weapon?.displayName ?? '—'}</div>
        <div className="hud-weapon-ammo"><strong>{melee ? '—' : ammo}</strong><span>/{weapon?.reserve ?? 0}</span><em>{match?.money ?? 0}</em></div>
        <div className="hud-ammo-line"><i style={{ width: `${melee ? 0 : Math.max(0, Math.min(100, (ammo / Math.max(1, weapon?.ammo ?? 1)) * 100))}%` }} /></div>
        {s?.weaponId === 7 && (
          <div className="laser-charge-wrap">
            <div className="laser-charge"><i style={{ width: `${Math.round((s.charge ?? 0) * 100)}%` }} /></div>
            <span>{s.charge >= 1 ? '充能完毕' : s.charge > 0 ? '蓄力中' : '按住开火蓄力'}</span>
          </div>
        )}
      </section>

      <section className="hud-slots">
        <div className="hud-slot selected"><span>1</span><strong>▰</strong></div><div className="hud-slot"><span>2</span><strong>▱</strong></div><div className="hud-slot"><span>3</span><strong>▬</strong></div><div className="hud-slot"><span>4</span><strong><Bomb size={22} /></strong><small>{g?.he ?? 0}</small></div><div className="hud-slot"><span>5</span><strong><Zap size={22} /></strong><small>{g?.flash ?? 0}</small></div><div className="hud-slot"><span>6</span><strong><Siren size={22} /></strong><small>{g?.smoke ?? 0}</small></div>
      </section>

      <div className="hud-top-right">
        <button className="btn small hud-backpack-button" onClick={onToggleBackpack} title="打开背包 (I)"><Backpack size={14} /> 背包 (I)</button>
        {(match?.online || demolition) && <button className="btn small" onClick={onToggleBuy}>购买菜单 (B)</button>}
        <button className="btn small" onClick={onExit}>退出对局</button>
      </div>

      {backpackOpen && (
        <div className="backpack-overlay" role="dialog" aria-modal="true" aria-label="背包">
          <div className="backpack-panel">
            <div className="backpack-header"><div><span className="backpack-kicker">LOADOUT / INVENTORY</span><h2>战术背包</h2><p>选择当前携带的主武器</p></div><button className="icon-button" onClick={onToggleBackpack} title="关闭背包"><X size={19} /></button></div>
            <div className="backpack-layout">
              <div className="backpack-slot-card active"><span className="backpack-slot-label">主武器</span><strong>{selectedPrimaryId ? getWeapon(selectedPrimaryId)?.displayName : '未装备'}</strong><small>槽位 1 · 鼠标滚轮可切换</small></div>
              <div className="backpack-slot-card"><span className="backpack-slot-label">副武器</span><strong>手枪 P9</strong><small>槽位 2 · 固定配备</small></div>
              <div className="backpack-slot-card"><span className="backpack-slot-label">近战</span><strong>战术刀</strong><small>槽位 3 · 固定配备</small></div>
            </div>
            <div className="backpack-section-title"><span>主武器库</span><em>{match?.online || demolition ? '仅冻结期可更换' : '离线演示可自由更换'}</em></div>
            <div className="backpack-weapons">
              {primaryWeapons.map((item) => {
                const id = item.weaponId!
                const spec = getWeapon(id)!
                const selected = selectedPrimaryId === id
                const onlineLocked = Boolean((match?.online || demolition) && !inBuyPhase)
                const code = id === 4 ? 'M1' : id === 6 ? 'M4' : id === 7 ? 'LC' : spec.category === 'smg' ? 'S4' : 'R1'
                return <button key={id} className={`backpack-weapon ${selected ? 'selected' : ''} ${onlineLocked ? 'locked' : ''}`} disabled={onlineLocked} onClick={() => onSelectPrimary(id)}><div className="backpack-weapon-art"><span>{code}</span></div><div className="backpack-weapon-copy"><strong>{id === 4 ? 'Barrett M1' : spec.displayName}</strong><span>{spec.category.toUpperCase()} · {spec.damage} DMG · {spec.ammo} ROUNDS</span><i><b style={{ width: `${Math.min(100, spec.damage / 1.1)}%` }} /></i></div><div className="backpack-weapon-state">{selected ? <Check size={18} /> : onlineLocked ? <LockKeyhole size={16} /> : <span>装备</span>}</div></button>
              })}
            </div>
            <div className="backpack-footer"><span><strong>I</strong> 打开/关闭</span><span><strong>ESC</strong> 返回对局</span><span>{inBuyPhase ? '选择后将发送购买请求' : '选择后立即装备'}</span></div>
          </div>
        </div>
      )}

      {/* 购买菜单（冻结期 + 联网） */}
      {inBuyPhase && buyMenuOpen && (
        <div className="buy-menu">
          <div className="buy-title">购买装备 · 资金 ${match?.money ?? 0}</div>
          <div className="buy-grid">
            {SHOP_ITEMS.map((item) => {
              const affordable = (match?.money ?? 0) >= item.cost
              const owned = item.weaponId !== undefined && item.weaponId === s?.weaponId
              const enabled = affordable || owned
              return (
                <button
                  key={item.id}
                  className={enabled ? 'buy-item' : 'buy-item disabled'}
                  disabled={!enabled}
                  autoFocus={item.id === 1}
                  onClick={() => onBuy(item.id)}
                >
                  <span>{item.name}</span>
                  <span className="cost">{owned ? '退款' : `$${item.cost}`}</span>
                </button>
              )
            })}
          </div>
          <div className="buy-hint">点击购买 · 再次购买同款武器即退款 · Esc 关闭</div>
        </div>
      )}

      {/* 死亡覆盖 */}
      {!matchEnd && !match?.spectating && health <= 0 && (
        <div className="overlay death">
          <div>{match?.online ? '你已阵亡，等待下回合重生…' : '你已阵亡，1.8 秒后重生…'}</div>
        </div>
      )}

      {!matchEnd && match?.spectating && (
        <div className="overlay spectator">
          <div className="spectator-title">观战模式</div>
          <div className="spectator-hints">WASD 上帝视角 · 鼠标视角 · Shift 加速 · F 切换队友视角 · G 自由视角</div>
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
