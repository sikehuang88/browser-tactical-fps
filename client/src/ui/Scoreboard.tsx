import { useMemo } from 'react'
import type { Match } from '../game/match'

/** 计分板（Tab 呼出）。M0 仅展示实体与本地状态；完整战绩以服务器结算为准（UI-003）。 */
export function Scoreboard({ match }: { match: Match }) {
  const local = match.localState
  const others = match.knownEntities().filter((e) => e.id !== local.id)

  const rows = useMemo(() => {
    const all = [
      { id: local.id, health: local.health, ammo: local.ammo, crouching: local.crouching, you: true },
      ...others.map((e) => ({
        id: e.id,
        health: e.health,
        ammo: 0,
        crouching: e.crouching,
        you: false,
      })),
    ]
    return all.sort((a, b) => a.id - b.id)
  }, [local, others])

  return (
    <div className="scoreboard">
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>生命</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.you ? '你' : `#${r.id}`}</td>
              <td>{r.health}</td>
              <td>{r.crouching ? '下蹲' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
