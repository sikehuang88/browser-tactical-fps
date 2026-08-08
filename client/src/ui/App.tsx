import { useState } from 'react'
import { Lobby } from './Lobby'
import { SettingsScreen } from './SettingsScreen'
import { MatchScreen } from '../game/MatchScreen'
import { StartupCinematic } from './StartupCinematic'
import { MatchIntroSequence } from './MatchIntroSequence'
import type { GameModeId } from '../core/types'

export type Screen = 'lobby' | 'settings' | 'matchIntro' | 'match'

/** 非实时界面（React）；进入对局后由 MatchScreen 挂载引擎，React 只负责 HUD 覆盖层。 */
export function App() {
  const [showStartup, setShowStartup] = useState(true)
  const [screen, setScreen] = useState<Screen>('lobby')
  const [accountName, setAccountName] = useState('')
  const [mode, setMode] = useState<GameModeId>('teamDeathmatch')

  if (showStartup) {
    return <StartupCinematic onComplete={(username) => { setAccountName(username); setShowStartup(false) }} />
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('lobby')} />
  }
  if (screen === 'matchIntro') {
    return (
      <MatchIntroSequence
        displayName={accountName}
        onComplete={() => setScreen('match')}
        onCancel={() => setScreen('lobby')}
      />
    )
  }
  if (screen === 'match') {
    return <MatchScreen onExit={() => setScreen('lobby')} displayName={accountName} mode={mode} />
  }
  return (
    <Lobby
      accountName={accountName}
      onStart={(nextMode) => {
        setMode(nextMode)
        setScreen('matchIntro')
      }}
      onSettings={() => setScreen('settings')}
    />
  )
}
