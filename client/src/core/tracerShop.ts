// Tracer cosmetics shop client. Prices, ownership and the equipped selection
// are all server-authoritative: this module only names item ids and renders
// whatever the backend returns.

import { accessToken, request } from './tasks'

export type TracerStyleId = 'whip' | 'traveling' | 'shader'

export interface TracerVisual {
  style: TracerStyleId
  coreColor: string
  glowColor: string
  radiusM: number
  speedMps: number
  trailM: number
  lifetimeMs: number
}

export interface TracerItem {
  id: string
  name: string
  rarity: string
  price: number
  default: boolean
  visual: TracerVisual
}

export interface TracerState {
  catalogVersion: number
  items: TracerItem[]
  owned: string[]
  equippedId: string
  credits: number
}

const EQUIPPED_CACHE_KEY = 'fps_tracer_equipped_v1'

export async function fetchTracers(): Promise<TracerState> {
  const token = await accessToken()
  const state = await request<TracerState>('/api/v1/tracers', {}, token)
  cacheEquipped(state)
  return state
}

export async function purchaseTracer(itemId: string): Promise<TracerState> {
  const token = await accessToken()
  const state = await request<TracerState>(
    `/api/v1/tracers/${encodeURIComponent(itemId)}/purchase`,
    { method: 'POST' },
    token,
  )
  cacheEquipped(state)
  return state
}

export async function equipTracer(itemId: string): Promise<TracerState> {
  const token = await accessToken()
  const state = await request<TracerState>(
    `/api/v1/tracers/${encodeURIComponent(itemId)}/equip`,
    { method: 'POST' },
    token,
  )
  cacheEquipped(state)
  return state
}

/**
 * Remember the equipped visual so a match can start with the right tracer
 * before the shop request resolves. Purely a rendering hint: the cache can
 * never grant an item, because ownership lives on the server.
 */
function cacheEquipped(state: TracerState): void {
  const item = state.items.find((candidate) => candidate.id === state.equippedId)
  if (!item) return
  try {
    localStorage.setItem(EQUIPPED_CACHE_KEY, JSON.stringify(item.visual))
  } catch {
    /* storage disabled; fall back to the built-in default */
  }
}

/** Last known equipped visual, or null when nothing has been cached yet. */
export function cachedTracerVisual(): TracerVisual | null {
  try {
    const raw = localStorage.getItem(EQUIPPED_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TracerVisual>
    if (typeof parsed?.style !== 'string' || typeof parsed?.coreColor !== 'string') return null
    return parsed as TracerVisual
  } catch {
    return null
  }
}

/** Built-in fallback used when the backend is unreachable (offline demo mode). */
export const FALLBACK_TRACER_VISUAL: TracerVisual = {
  style: 'whip',
  coreColor: '#ffe08a',
  glowColor: '#ffb347',
  radiusM: 0.014,
  speedMps: 900,
  trailM: 12,
  lifetimeMs: 110,
}
