import { useEffect, useState } from 'react'
import { ChevronRight, Loader2, Radio, ShieldCheck, X } from 'lucide-react'

type IntroPhase = 'matched' | 'loading' | 'cinematic'

const LOADING_STEPS = [
  '同步行动地图',
  '预热武器资产',
  '校验干员装备',
  '建立战术频道',
  '等待部署指令',
]

export function MatchIntroSequence({
  displayName,
  onComplete,
  onCancel,
}: {
  displayName: string
  onComplete: () => void
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<IntroPhase>('matched')
  const [progress, setProgress] = useState(0)
  const [loadStep, setLoadStep] = useState(0)

  useEffect(() => {
    if (phase !== 'matched') return
    const timer = window.setTimeout(() => setPhase('loading'), 950)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'loading') return

    let cinematicTimer = 0
    const startedAt = performance.now()
    const durationMs = 2200
    const interval = window.setInterval(() => {
      const elapsed = performance.now() - startedAt
      const nextProgress = Math.min(100, Math.round((elapsed / durationMs) * 100))
      setProgress(nextProgress)
      setLoadStep(Math.min(LOADING_STEPS.length - 1, Math.floor(nextProgress / 22)))

      if (nextProgress >= 100) {
        window.clearInterval(interval)
        cinematicTimer = window.setTimeout(() => setPhase('cinematic'), 240)
      }
    }, 70)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(cinematicTimer)
    }
  }, [phase])

  const deployToMatch = (): void => {
    try {
      const target = document.body
      if (document.pointerLockElement !== target && typeof target.requestPointerLock === 'function') {
        const result = target.requestPointerLock()
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch(() => undefined)
        }
      }
    } catch {
      // Pointer Lock still has a fallback path: clicking the match canvas can retry.
    }
    onComplete()
  }

  const actionLabel = phase === 'cinematic' ? '部署进入' : '返回大厅'

  return (
    <main className={`match-intro-screen match-intro-${phase}`} aria-label="对局载入">
      <div className="match-intro-bg" aria-hidden="true" />
      <div className="match-intro-grid" aria-hidden="true" />
      <div className="match-intro-vignette" aria-hidden="true" />

      <header className="match-intro-header">
        <div className="match-intro-brand">
          <span className="match-intro-emblem"><ShieldCheck size={26} strokeWidth={1.7} /></span>
          <div>
            <strong>战线协议</strong>
            <small>TACTICAL FRONTLINE</small>
          </div>
        </div>
        <button className="match-intro-cancel" onClick={phase === 'cinematic' ? deployToMatch : onCancel}>
          {phase === 'cinematic' ? <ChevronRight size={17} /> : <X size={17} />}
          {actionLabel}
        </button>
      </header>

      {phase === 'matched' && (
        <section className="match-intro-card match-intro-card-center" aria-live="polite">
          <span className="match-intro-status ok">MATCH FOUND</span>
          <h1>匹配成功</h1>
          <p>{displayName || 'Operator'}，你的小队已就绪，正在接入行动服务器。</p>
          <div className="match-intro-squad">
            <span>ALPHA-1</span>
            <span>ALPHA-2</span>
            <span>ALPHA-3</span>
            <span>ALPHA-4</span>
            <span>ALPHA-5</span>
          </div>
        </section>
      )}

      {phase === 'loading' && (
        <section className="match-intro-card match-intro-loadout" aria-live="polite">
          <div className="match-intro-loader">
            <Loader2 size={24} />
            <span>LOADING OPERATION</span>
          </div>
          <h1>行动载入中</h1>
          <p>{LOADING_STEPS[loadStep]}</p>
          <div className="match-intro-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="match-intro-progress-meta">
            <span>DEPLOYMENT PACKAGE</span>
            <strong>{progress}%</strong>
          </div>
        </section>
      )}

      {phase === 'cinematic' && (
        <section className="match-intro-cinematic-card" aria-live="polite">
          <div className="match-intro-cg-frame">
            <span className="match-intro-rec"><i />REC</span>
            <div className="match-intro-cg-copy">
              <Radio size={26} />
              <small>INSERTION FEED</small>
              <strong>进场影像接入中</strong>
              <span>小队正在前往交战区域</span>
            </div>
          </div>
          <div className="match-intro-cinematic-footer">
            <div className="match-intro-subtitle">空投舱门开启 · 检查武器 · 等待落地指令</div>
            <button className="match-intro-deploy" onClick={deployToMatch}>
              部署进入
              <ChevronRight size={18} />
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
