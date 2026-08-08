import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Lock, Sparkles, X } from 'lucide-react'
import {
  equipTracer,
  fetchTracers,
  purchaseTracer,
  type TracerItem,
  type TracerState,
} from '../core/tracerShop'
import { TracerPreview } from './TracerPreview'

const RARITY_LABEL: Record<string, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

interface TracerShopProps {
  onClose: () => void
  /** Fired after a successful equip so the live view can swap its style. */
  onEquipped?: (state: TracerState) => void
}

/**
 * 曳光弹商店。价格、持有与装备状态全部由服务器裁决：
 * 本组件只提交物品 id，不提交价格，也不在本地判断是否买得起以外的任何事。
 */
export function TracerShop({ onClose, onEquipped }: TracerShopProps) {
  const [state, setState] = useState<TracerState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchTracers()
      .then((next) => {
        if (cancelled) return
        setState(next)
        setSelectedId((current) => current ?? next.equippedId)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '商店加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const owned = useMemo(() => new Set(state?.owned ?? []), [state])
  const selected = useMemo(
    () => state?.items.find((item) => item.id === selectedId) ?? state?.items[0] ?? null,
    [state, selectedId],
  )

  const run = useCallback(
    async (itemId: string, action: (id: string) => Promise<TracerState>) => {
      setBusyId(itemId)
      setError('')
      try {
        const next = await action(itemId)
        setState(next)
        onEquipped?.(next)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '操作失败')
      } finally {
        setBusyId(null)
      }
    },
    [onEquipped],
  )

  if (error && !state) {
    return (
      <div className="tracer-shop-overlay">
        <div className="tracer-shop-panel tracer-shop-panel--message">
          <p>{error}</p>
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    )
  }

  if (!state || !selected) {
    return (
      <div className="tracer-shop-overlay">
        <div className="tracer-shop-panel tracer-shop-panel--message">
          <Loader2 className="tracer-shop-spinner" size={28} />
          <p>正在载入曳光弹目录…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="tracer-shop-overlay" role="dialog" aria-label="曳光弹商店">
      <div className="tracer-shop-panel">
        <header className="tracer-shop-header">
          <div className="tracer-shop-title">
            <Sparkles size={20} />
            <div>
              <h2>曳光弹</h2>
              <small>目录版本 v{state.catalogVersion}</small>
            </div>
          </div>
          <div className="tracer-shop-credits" aria-label="余额">
            <span>{state.credits.toLocaleString('zh-CN')}</span>
            <small>信用点</small>
          </div>
          <button className="tracer-shop-close" onClick={onClose} aria-label="关闭商店">
            <X size={20} />
          </button>
        </header>

        <div className="tracer-shop-body">
          <ul className="tracer-shop-list">
            {state.items.map((item) => (
              <TracerCard
                key={item.id}
                item={item}
                owned={owned.has(item.id)}
                equipped={state.equippedId === item.id}
                selected={selected.id === item.id}
                affordable={state.credits >= item.price}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </ul>

          <section className="tracer-shop-detail">
            <TracerPreview visual={selected.visual} />
            <div className="tracer-shop-detail-meta">
              <h3>{selected.name}</h3>
              <span className={`tracer-rarity tracer-rarity--${selected.rarity}`}>
                {RARITY_LABEL[selected.rarity] ?? selected.rarity}
              </span>
              <dl>
                <div><dt>弹速</dt><dd>{selected.visual.speedMps} m/s</dd></div>
                <div><dt>尾迹</dt><dd>{selected.visual.trailM} m</dd></div>
                <div><dt>渲染</dt><dd>{selected.visual.style}</dd></div>
              </dl>
            </div>

            <TracerAction
              item={selected}
              owned={owned.has(selected.id)}
              equipped={state.equippedId === selected.id}
              affordable={state.credits >= selected.price}
              busy={busyId === selected.id}
              onPurchase={() => void run(selected.id, purchaseTracer)}
              onEquip={() => void run(selected.id, equipTracer)}
            />
            {error ? <p className="tracer-shop-error" role="alert">{error}</p> : null}
          </section>
        </div>
      </div>
    </div>
  )
}

interface TracerCardProps {
  item: TracerItem
  owned: boolean
  equipped: boolean
  selected: boolean
  affordable: boolean
  onSelect: () => void
}

function TracerCard({ item, owned, equipped, selected, affordable, onSelect }: TracerCardProps) {
  const classes = [
    'tracer-card',
    selected ? 'tracer-card--selected' : '',
    equipped ? 'tracer-card--equipped' : '',
  ].filter(Boolean).join(' ')

  return (
    <li>
      <button className={classes} onClick={onSelect} aria-pressed={selected}>
        <span
          className="tracer-card-swatch"
          aria-hidden="true"
          style={{
            background: `linear-gradient(90deg, ${item.visual.glowColor}, ${item.visual.coreColor})`,
          }}
        />
        <span className="tracer-card-name">{item.name}</span>
        <span className="tracer-card-state">
          {equipped ? (
            <><Check size={14} />已装备</>
          ) : owned ? (
            '已拥有'
          ) : (
            <span className={affordable ? '' : 'tracer-card-price--short'}>
              {!affordable ? <Lock size={12} /> : null}
              {item.price.toLocaleString('zh-CN')}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

interface TracerActionProps {
  item: TracerItem
  owned: boolean
  equipped: boolean
  affordable: boolean
  busy: boolean
  onPurchase: () => void
  onEquip: () => void
}

function TracerAction({ item, owned, equipped, affordable, busy, onPurchase, onEquip }: TracerActionProps) {
  if (equipped) {
    return <button className="btn tracer-shop-action" disabled>当前装备</button>
  }
  if (owned) {
    return (
      <button className="btn tracer-shop-action" onClick={onEquip} disabled={busy}>
        {busy ? '装备中…' : '装备'}
      </button>
    )
  }
  return (
    <button
      className="btn tracer-shop-action"
      onClick={onPurchase}
      // 只是提前给出反馈；真正的余额裁决在服务器，前端从不放行。
      disabled={busy || !affordable}
    >
      {busy ? '购买中…' : affordable ? `购买 · ${item.price.toLocaleString('zh-CN')}` : '信用点不足'}
    </button>
  )
}
