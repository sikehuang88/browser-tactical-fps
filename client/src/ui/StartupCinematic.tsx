import { FormEvent, useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, EyeOff, Globe2, Headphones, LockKeyhole, LogIn, Play, Settings, Shield, UserPlus, Volume2, VolumeX } from 'lucide-react'

const STARTUP_VIDEO = '/assets/intro/startup-cg.mp4'
const STARTUP_POSTER = '/assets/intro/startup-poster.jpg'
const ACCOUNT_STORE_KEY = 'tactical-frontline.accounts'
const SESSION_KEY = 'tactical-frontline.session'

type AuthMode = 'login' | 'register'
type AccountRecord = { username: string; passwordHash: string }

export function StartupCinematic({ onComplete }: { onComplete: (username: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [failed, setFailed] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [sessionName, setSessionName] = useState(() => readSession())
  const loggedIn = sessionName.length > 0

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const play = (): void => {
      void video.play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => setAutoplayBlocked(true))
    }
    play()
    return () => video.pause()
  }, [])

  const finish = (): void => {
    if (!loggedIn) {
      setAuthError('请先登录或注册账号')
      return
    }
    videoRef.current?.pause()
    onComplete(sessionName)
  }

  const submitAuth = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (authBusy) return
    const normalizedUsername = username.trim()
    setAuthError('')
    if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
      setAuthError('账号需要 3-20 个字符')
      return
    }
    if (password.length < 6) {
      setAuthError('密码至少需要 6 个字符')
      return
    }
    if (authMode === 'register' && password !== confirmPassword) {
      setAuthError('两次输入的密码不一致')
      return
    }

    setAuthBusy(true)
    try {
      const accounts = readAccounts()
      const existing = accounts.find((account) => account.username.toLowerCase() === normalizedUsername.toLowerCase())
      const passwordHash = await hashPassword(password)
      if (authMode === 'login') {
        if (!existing || existing.passwordHash !== passwordHash) {
          setAuthError('账号或密码错误')
          return
        }
      } else {
        if (existing) {
          setAuthError('账号已存在，请直接登录')
          return
        }
        // TODO(M3): Replace local prototype auth with the backend identity service.
        writeAccounts([...accounts, { username: normalizedUsername, passwordHash }])
      }
      writeSession(normalizedUsername)
      setSessionName(normalizedUsername)
      setPassword('')
      setConfirmPassword('')
      void videoRef.current?.play().catch(() => undefined)
    } finally {
      setAuthBusy(false)
    }
  }

  const toggleMuted = (): void => {
    const video = videoRef.current
    if (!video) return
    const nextMuted = !muted
    video.muted = nextMuted
    setMuted(nextMuted)
    void video.play().catch(() => undefined)
  }

  const playFromGesture = (): void => {
    const video = videoRef.current
    if (!video) return
    void video.play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true))
  }

  return (
    <main className="startup-cinematic" aria-label="启动影片">
      {!failed && (
        <video
          ref={videoRef}
          className="startup-video"
          src={STARTUP_VIDEO}
          poster={STARTUP_POSTER}
          autoPlay
          muted={muted}
          loop={!loggedIn}
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onEnded={finish}
          onError={() => setFailed(true)}
        />
      )}

      <div className="startup-shade" aria-hidden="true" />
      <header className="startup-topbar">
        <div className="startup-brand">
          <span className="startup-brand-mark"><Shield size={28} strokeWidth={1.5} /></span>
          <span><strong>无畏</strong><small>UNFEAR · TACTICAL FPS</small></span>
        </div>
        <div className="startup-utilities" aria-label="启动界面工具">
          <button className="startup-utility" onClick={toggleMuted} aria-label={muted ? '开启声音' : '关闭声音'} title={muted ? '开启声音' : '关闭声音'}>{muted ? <VolumeX size={17} /> : <Headphones size={17} />}</button>
          <button className="startup-utility" aria-label="语言" title="语言"><Globe2 size={17} /></button>
          <button className="startup-utility" aria-label="设置" title="设置"><Settings size={17} /></button>
        </div>
      </header>

      {!loggedIn && (
        <div className="startup-login-layout">
          <section className="startup-login-copy" aria-labelledby="startup-login-title">
            <div className="startup-login-eyebrow"><i />欢迎回来，士兵 <span>WELCOME BACK, OPERATOR</span></div>
            <h1 id="startup-login-title">登录</h1>
            <p>接入无畏战术网络，继续你的行动记录。</p>
            <div className="startup-login-rule" />
          </section>
          <AuthPanel
            mode={authMode}
            username={username}
            password={password}
            confirmPassword={confirmPassword}
            error={authError}
            busy={authBusy}
            passwordVisible={passwordVisible}
            onTogglePassword={() => setPasswordVisible((value) => !value)}
            onModeChange={(mode) => { setAuthMode(mode); setAuthError('') }}
            onUsernameChange={setUsername}
            onPasswordChange={setPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={submitAuth}
          />
          <div className="startup-login-footer">
            <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>
              {authMode === 'login' ? '创建账户' : '返回登录'}
            </button>
            <span>无畏行动协议 · 版本 0.1.0</span>
          </div>
        </div>
      )}

      {loggedIn && (
        <div className="startup-session">
          <span className="startup-session-icon"><Shield size={22} /></span>
          <div><strong>{sessionName}</strong><small>身份已验证</small></div>
          <button className="startup-enter" onClick={finish}>进入大厅 <ChevronRight size={18} /></button>
        </div>
      )}

      {failed ? (
        <div className="startup-fallback">
          <h1>无畏</h1>
          <p>启动影片暂不可用</p>
          {loggedIn
            ? <button className="startup-action" onClick={finish}>进入大厅 <ChevronRight size={20} /></button>
            : <p className="startup-fallback-hint">请先登录或注册账号</p>}
        </div>
      ) : autoplayBlocked ? (
        <button className="startup-play" onClick={playFromGesture} aria-label="播放启动影片">
          <Play size={24} fill="currentColor" />
          <span>播放启动影片</span>
        </button>
      ) : null}

      <div className="startup-meta">
        <div className="startup-title-block">
          <strong>行动系统载入</strong>
          <span>{loggedIn ? `身份已验证 · ${sessionName}` : '等待身份验证 · CG 循环播放'}</span>
        </div>
        <div className="startup-controls">
          <button className="startup-control" onClick={toggleMuted} aria-label={muted ? '开启声音' : '关闭声音'} title={muted ? '开启声音' : '关闭声音'}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <div className="startup-progress" aria-label="影片进度" role="progressbar" aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={currentTime}>
            <i style={{ width: duration > 0 ? `${Math.min(100, currentTime / duration * 100)}%` : '0%' }} />
          </div>
          <span className="startup-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          {loggedIn && <button className="startup-skip" onClick={finish}>跳过 <ChevronRight size={17} /></button>}
        </div>
      </div>
    </main>
  )
}

function AuthPanel({
  mode,
  username,
  password,
  confirmPassword,
  error,
  busy,
  passwordVisible,
  onTogglePassword,
  onModeChange,
  onUsernameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: {
  mode: AuthMode
  username: string
  password: string
  confirmPassword: string
  error: string
  busy: boolean
  passwordVisible: boolean
  onTogglePassword: () => void
  onModeChange: (mode: AuthMode) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onConfirmPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="startup-auth" aria-label="账号登录">
      <div className="startup-auth-heading">
        <span className="startup-auth-icon"><LockKeyhole size={19} /></span>
        <div><strong>身份验证</strong><small>TACTICAL NETWORK</small></div>
      </div>
      <div className="startup-auth-tabs" role="tablist" aria-label="账号操作">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => onModeChange('login')} role="tab" aria-selected={mode === 'login'}>
          <LogIn size={15} />登录
        </button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => onModeChange('register')} role="tab" aria-selected={mode === 'register'}>
          <UserPlus size={15} />注册
        </button>
      </div>
      <form onSubmit={onSubmit}>
        <label>账号<input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" required /></label>
        <label>密码<div className="startup-password-field"><input type={passwordVisible ? 'text' : 'password'} value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /><button type="button" onClick={onTogglePassword} aria-label={passwordVisible ? '隐藏密码' : '显示密码'} title={passwordVisible ? '隐藏密码' : '显示密码'}>{passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        {mode === 'register' && (
          <label>确认密码<input type="password" value={confirmPassword} onChange={(event) => onConfirmPasswordChange(event.target.value)} autoComplete="new-password" required /></label>
        )}
        {error && <p className="startup-auth-error" role="alert">{error}</p>}
        <button className="startup-auth-submit" type="submit" disabled={busy}>
          {busy ? '验证中…' : mode === 'login' ? '登录并继续' : '注册并继续'}
          <ChevronRight size={18} />
        </button>
      </form>
    </section>
  )
}

function readAccounts(): AccountRecord[] {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAccountRecord)
  } catch {
    return []
  }
}

function writeAccounts(accounts: AccountRecord[]): void {
  localStorage.setItem(ACCOUNT_STORE_KEY, JSON.stringify(accounts))
}

function readSession(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeSession(username: string): void {
  sessionStorage.setItem(SESSION_KEY, username)
}

function isAccountRecord(value: unknown): value is AccountRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.username === 'string' && typeof candidate.passwordHash === 'string'
}

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
