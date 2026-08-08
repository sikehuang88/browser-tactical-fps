import { useState } from 'react'
import { ChevronRight, Shield, Volume2 } from 'lucide-react'
import { loadSettings } from './settings'

const STARTUP_POSTER = '/assets/intro/startup-poster.jpg'

/**
 * 启动页：纯展示 + 本地代号输入。
 * 不做任何客户端“账号/密码”校验（已移除，避免可绕过的假鉴权与口令落盘），
 * 真实身份服务接入由 M3 后端完成。
 */
export function StartupCinematic({ onComplete }: { onComplete: (username: string) => void }) {
  const [displayName, setDisplayName] = useState(() => loadSettings().displayName || '')
  const [error, setError] = useState('')

  const finish = (): void => {
    const name = displayName.trim()
    if (!name) {
      setError('请输入你的行动代号')
      return
    }
    onComplete(name.slice(0, 32))
  }

  return (
    <main className="startup-cinematic" aria-label="启动界面">
      <div
        className="startup-poster"
        style={{ backgroundImage: `url(${STARTUP_POSTER})` }}
        aria-hidden="true"
      />
      <div className="startup-shade" aria-hidden="true" />

      <header className="startup-topbar">
        <div className="startup-brand">
          <span className="startup-brand-mark"><Shield size={28} strokeWidth={1.5} /></span>
          <span><strong>无畏</strong><small>UNFEAR · TACTICAL FPS</small></span>
        </div>
        <div className="startup-utilities" aria-label="启动界面工具">
          <button className="startup-utility" aria-label="音量" title="音量"><Volume2 size={17} /></button>
        </div>
      </header>

      <div className="startup-login-layout">
        <section className="startup-login-copy" aria-labelledby="startup-login-title">
          <div className="startup-login-eyebrow"><i />欢迎，士兵 <span>WELCOME, OPERATOR</span></div>
          <h1 id="startup-login-title">进入行动</h1>
          <p>输入你的行动代号，本地演示无需账号；在线模式由服务器校验身份。</p>
          <div className="startup-login-rule" />
        </section>

        <section className="startup-auth" aria-label="行动代号">
          <div className="startup-auth-heading">
            <span className="startup-auth-icon"><Shield size={19} /></span>
            <div><strong>行动代号</strong><small>LOCAL PROFILE</small></div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              finish()
            }}
          >
            <label>
              代号
              <input
                value={displayName}
                maxLength={32}
                spellCheck={false}
                autoComplete="nickname"
                placeholder="例如：Ghost"
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setError('')
                }}
              />
            </label>
            {error && <p className="startup-auth-error" role="alert">{error}</p>}
            <button className="startup-auth-submit" type="submit">
              进入大厅 <ChevronRight size={18} />
            </button>
          </form>
        </section>
      </div>

      <div className="startup-meta">
        <div className="startup-title-block">
          <strong>行动系统载入</strong>
          <span>本地演示模式 · 无畏行动协议 版本 0.1.0</span>
        </div>
        <div className="startup-controls">
          <button className="startup-skip" onClick={finish}>跳过 <ChevronRight size={17} /></button>
        </div>
      </div>
    </main>
  )
}
