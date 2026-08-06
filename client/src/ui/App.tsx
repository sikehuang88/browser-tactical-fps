import { useState } from 'react'
import { Lobby } from './Lobby'
import { SettingsScreen } from './SettingsScreen'
import { MatchScreen } from '../game/MatchScreen'

export type Screen = 'lobby' | 'settings' | 'match'

/** 非实时界面（React）；进入对局后由 MatchScreen 挂载引擎，React 只负责 HUD 覆盖层。 */
export function App() {
  const [screen, setScreen] = useState<Screen>('lobby')

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('lobby')} />
  }
  if (screen === 'match') {
    return <MatchScreen onExit={() => setScreen('lobby')} />
  }
  return <Lobby onStart={() => setScreen('match')} onSettings={() => setScreen('settings')} />
}
