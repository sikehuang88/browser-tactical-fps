export interface Task {
  id: string
  label: string
  value: number
  target: number
  reward: number
  claimed: boolean
  tracked: boolean
  expiresAt: string
}

export interface PlayerProfile {
  id: string
  displayName: string
  region: string
  language: string
  level: number
  ratingScore: number
  ratingTier: string
  experience: number
  credits: number
  kills: number
  deaths: number
  wins: number
  losses: number
  matches: number
  lastSeenAt: string
  createdAt: string
}

export interface CheckInState {
  checkedIn: boolean
  date: string
  currentStreak: number
  reward: number
  credits: number
  nextReward: number
}

interface GuestLoginResponse {
  accessToken: string
}

const TOKEN_KEY = 'fps_task_access_token_v1'
const DEVICE_KEY = 'fps_guest_device_v1'

function apiBase(): string {
  const configured = import.meta.env.VITE_BACKEND_URL as string | undefined
  return (configured || 'http://127.0.0.1:8080').replace(/\/$/, '')
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const value = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random().toString(16).slice(2)}`
  localStorage.setItem(DEVICE_KEY, value)
  return value
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers })
  if (!response.ok) {
    let message = `任务服务请求失败 (${response.status})`
    try {
      const body = await response.json() as { error?: { message?: string } }
      message = body.error?.message || message
    } catch { /* use status fallback */ }
    throw new Error(message)
  }
  return await response.json() as T
}

async function accessToken(): Promise<string> {
  const existing = localStorage.getItem(TOKEN_KEY)
  if (existing) return existing
  const body = await request<GuestLoginResponse>('/api/v1/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ deviceId: deviceId(), language: 'zh-CN' }),
  })
  localStorage.setItem(TOKEN_KEY, body.accessToken)
  return body.accessToken
}

export async function fetchTasks(): Promise<Task[]> {
  const token = await accessToken()
  try {
    const body = await request<{ tasks: Task[] }>('/api/v1/tasks', {}, token)
    return body.tasks
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY)
    throw error
  }
}

export async function fetchProfile(): Promise<PlayerProfile> {
  const token = await accessToken()
  try {
    return await request<PlayerProfile>('/api/v1/me', {}, token)
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY)
    throw error
  }
}

export async function trackTask(taskId: string): Promise<Task[]> {
  const token = await accessToken()
  const body = await request<{ tasks: Task[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/track`, { method: 'POST' }, token)
  return body.tasks
}

export async function claimTask(taskId: string): Promise<Task> {
  const token = await accessToken()
  const body = await request<{ task: Task }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/claim`, { method: 'POST' }, token)
  return body.task
}

export async function fetchCheckIn(): Promise<CheckInState> {
  const token = await accessToken()
  const body = await request<{ checkIn: CheckInState }>('/api/v1/checkin', {}, token)
  return body.checkIn
}

export async function claimCheckIn(): Promise<CheckInState> {
  const token = await accessToken()
  const body = await request<{ checkIn: CheckInState }>('/api/v1/checkin', { method: 'POST' }, token)
  return body.checkIn
}
