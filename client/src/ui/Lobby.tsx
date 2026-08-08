import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleUserRound,
  Coins,
  Crosshair,
  Gift,
  Headphones,
  Medal,
  Mic,
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Settings,
  Shield,
  ShoppingCart,
  Star,
  Target,
  Timer,
  UserPlus,
  Users,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react'
import { listWeapons } from '../game/weapons/registry'
import type { WeaponConfig } from '../game/weapons/config'
import { OperatorPreview } from './OperatorPreview'
import { StoreSpace, type StoreDisplayItem } from './StoreSpace'
import { WeaponRangeSpace } from './WeaponRangeSpace'
import { loadSettings } from './settings'
import type { OperatorId } from '../render/characterAssets'
import type { GameModeId } from '../core/types'
import { claimCheckIn, claimTask, fetchCheckIn, fetchProfile, fetchTasks, trackTask, type CheckInState, type PlayerProfile, type Task } from '../core/tasks'

type HubTab = 'operations' | 'operators' | 'arsenal' | 'store'
type HubTool = 'notifications' | 'friends' | 'voice' | null
type ModeId = GameModeId
type MapId = 'desertGrey' | 'borderDepot'

interface OperationMode {
  id: ModeId
  title: string
  label: string
  region: string
  status: string
  cta: string
  locked?: boolean
}

interface MapChoice {
  id: MapId
  title: string
  subtitle: string
  status: string
  available?: boolean
}

interface StoreItem extends StoreDisplayItem {
  id: string
  title: string
  kind: string
  price: number
  owned?: boolean
}

const OPERATORS: Array<{ id: OperatorId; callsign: string; role: string; detail: string }> = [
  { id: 'vanguard', callsign: 'VANGUARD', role: '突击手', detail: '前线突破 · 快速推进' },
  { id: 'sentinel', callsign: 'SENTINEL', role: '防守者', detail: '区域控制 · 稳定架枪' },
]

const OPERATION_MODES: OperationMode[] = [
  { id: 'teamDeathmatch', title: '团队竞技 5V5', label: '边境基地 · 先到 50 击杀获胜', region: '离线 BOT / 在线服务器', status: '立即可用', cta: '开始团队竞技' },
  { id: 'training', title: '训练场', label: 'VANGUARD 训练协议', region: '本地靶场', status: '立即可用', cta: '进入训练场' },
  { id: 'demolition', title: '5V5 爆破模式', label: '回合制 · C4 安装/拆除 · 10 回合 · 中场换边', region: '离线 BOT / 在线服务器', status: '立即可用', cta: '开始爆破对局' },
  { id: 'custom', title: '自定义房间', label: '私有战术演训', region: '队长创建', status: 'M2 开放', cta: '创建房间', locked: true },
]

const DEMOLITION_MAPS: MapChoice[] = [
  { id: 'desertGrey', title: '沙漠灰 · A/B/C', subtitle: '原创沙漠城镇爆破骨架 · 三路线', status: '可用', available: true },
  { id: 'borderDepot', title: '边境仓库', subtitle: '工业仓储爆破地图 · 开发中', status: '开发中', available: false },
]

const STORE_ITEMS: StoreItem[] = [
  { id: 'boost-xp', title: '经验增幅 1 日', kind: '战备补给', price: 600 },
  { id: 'slot-token', title: '小队通行证', kind: '社交道具', price: 1200 },
  { id: 'rifle-skin', title: '巴雷特 M82A1', kind: '反器材武器', price: 1800, modelId: 'sniper' },
  { id: 'm4-pink', title: 'M4 粉色', kind: '主武器 · 突击步枪', price: 3200, modelId: 'pinkM4' },
  { id: 'laser-cannon', title: '激光炮', kind: '主武器 · 能量炮', price: 6200, modelId: 'laserCannon' },
  { id: 'founder-badge', title: '先锋徽章', kind: '身份铭牌', price: 0, owned: true },
]

export function Lobby({
  accountName,
  onStart,
  onSettings,
}: {
  accountName: string
  onStart: (mode: GameModeId) => void
  onSettings: () => void
}) {
  const [settings] = useState(() => loadSettings())
  const [activeTab, setActiveTab] = useState<HubTab>('operations')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [storeOpen, setStoreOpen] = useState(false)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<HubTool>(null)
  const [operatorId, setOperatorId] = useState<OperatorId>('vanguard')
  const [selectedMode, setSelectedMode] = useState<ModeId>('teamDeathmatch')
  const [selectedMapId, setSelectedMapId] = useState<MapId>('desertGrey')
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [selectedWeaponId, setSelectedWeaponId] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [taskStatus, setTaskStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [challengesExpanded, setChallengesExpanded] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [micMuted, setMicMuted] = useState(false)
  const [credits, setCredits] = useState(0)
  const [checkIn, setCheckIn] = useState<CheckInState | null>(null)
  const [checkInStatus, setCheckInStatus] = useState<'loading' | 'ready' | 'claiming' | 'unavailable'>('loading')
  const [checkInNotice, setCheckInNotice] = useState('')
  const [ownedItems, setOwnedItems] = useState(() => STORE_ITEMS.filter((item) => item.owned).map((item) => item.id))

  const operator = OPERATORS.find((item) => item.id === operatorId) ?? OPERATORS[0]
  const weapons = useMemo(() => listWeapons(), [])
  const selectedWeapon = weapons.find((weapon) => weapon.id === selectedWeaponId) ?? weapons[0]
  const displayName = profile?.displayName || accountName || settings.displayName || '未登录玩家'
  const activeTabLabel = activeTab === 'operations' ? '开始游戏' : activeTab === 'operators' ? '干员' : activeTab === 'arsenal' ? '武器配置' : '补给站'

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchProfile(), fetchTasks(), fetchCheckIn()])
      .then(([nextProfile, nextTasks, nextCheckIn]) => {
        if (cancelled) return
        setProfile(nextProfile)
        setCredits(nextProfile.credits)
        setTasks(nextTasks)
        setCheckIn(nextCheckIn)
        setCheckInStatus('ready')
        setTaskStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setTaskStatus('unavailable')
          setCheckInStatus('unavailable')
        }
      })
    return () => { cancelled = true }
  }, [displayName])

  const toggleDrawerTab = (tab: HubTab): void => {
    if (tab === 'store') {
      setActiveTab('store')
      setDrawerOpen(false)
      setActiveTool(null)
      setStoreOpen(true)
      return
    }
    setStoreOpen(false)
    if (drawerOpen && activeTab === tab) {
      setDrawerOpen(false)
      return
    }
    setActiveTab(tab)
    setDrawerOpen(true)
  }

  const buyItem = (item: StoreItem): void => {
    if (ownedItems.includes(item.id) || credits < item.price) return
    setCredits((current) => current - item.price)
    setOwnedItems((current) => [...current, item.id])
  }

  const claimChallenge = (task: Task): void => {
    if (task.value < task.target || task.claimed) return
    void claimTask(task.id)
      .then(() => fetchTasks())
      .then(setTasks)
      .catch(() => setTaskStatus('unavailable'))
  }

  const trackChallenge = (task: Task): void => {
    void trackTask(task.id)
      .then(setTasks)
      .catch(() => setTaskStatus('unavailable'))
  }

  const handleCheckIn = (): void => {
    if (!checkIn || checkIn.checkedIn || checkInStatus === 'claiming') return
    setCheckInStatus('claiming')
    setCheckInNotice('')
    void claimCheckIn()
      .then((next) => {
        setCheckIn(next)
        setCredits(next.credits)
        setProfile((current) => current ? { ...current, credits: next.credits } : current)
        setCheckInNotice(`签到成功，获得 ${next.reward.toLocaleString()} 积分`)
        setCheckInStatus('ready')
      })
      .catch(() => {
        setCheckInNotice('签到服务暂时不可用')
        setCheckInStatus('unavailable')
      })
  }

  return (
    <main className="hub-shell">
      <div className="hub-backdrop" aria-hidden="true" />
      {!storeOpen && <OperatorPreview operatorId={operatorId} />}
      <div className="hub-vignette" aria-hidden="true" />

      {storeOpen && (
        <StoreSpace
          items={STORE_ITEMS}
          credits={credits}
          ownedItems={ownedItems}
          onBuy={buyItem}
          onClose={() => {
            setStoreOpen(false)
            setActiveTab('operations')
          }}
        />
      )}
      {rangeOpen && (
        <WeaponRangeSpace
          weapons={weapons}
          onClose={() => setRangeOpen(false)}
        />
      )}

      <header className="hub-header">
        <div className="hub-brand">
          <span className="hub-brand-mark" aria-hidden="true"><Shield size={28} strokeWidth={1.6} /></span>
          <div className="hub-brand-copy">
            <h1>战线协议</h1>
            <span>赛季 01</span>
          </div>
        </div>

        <div className="hub-profile-cluster">
          <div className="hub-profile-avatar" aria-hidden="true"><Crosshair size={24} /></div>
          <div className="hub-profile-copy">
            <strong>{displayName}</strong>
            <span className={settings.online ? 'online' : ''}>
              {settings.online ? '在线备战' : '本地演训'}
            </span>
          </div>
          <div className="hub-rank">
            <Medal size={34} strokeWidth={1.4} aria-hidden="true" />
            <div>
              <strong>{profile?.level ?? '—'}</strong>
              <span>先锋等级</span>
            </div>
          </div>
        </div>

        <div className="hub-toolbar">
          <div className="hub-currency"><Coins size={20} /><strong>{credits.toLocaleString()}</strong></div>
          <div className="hub-currency silver"><Medal size={20} /><strong>{profile?.ratingScore?.toLocaleString() ?? '—'}</strong></div>
          <div className="hub-tools" aria-label="账户工具">
            <IconButton label="通知" icon={Bell} active={activeTool === 'notifications'} onClick={() => setActiveTool(activeTool === 'notifications' ? null : 'notifications')} />
            <IconButton label="好友" icon={Users} active={activeTool === 'friends'} onClick={() => setActiveTool(activeTool === 'friends' ? null : 'friends')} />
            <IconButton label="语音" icon={Headphones} active={activeTool === 'voice'} onClick={() => setActiveTool(activeTool === 'voice' ? null : 'voice')} />
            <IconButton label="设置" icon={Settings} onClick={onSettings} />
          </div>
        </div>
      </header>

      {activeTool && (
        <HubToolPopover
          activeTool={activeTool}
          voiceEnabled={voiceEnabled}
          micMuted={micMuted}
          onClose={() => setActiveTool(null)}
          onVoiceEnabled={setVoiceEnabled}
          onMicMuted={setMicMuted}
        />
      )}

      <nav className="hub-nav" aria-label="大厅导航" role="tablist">
        <HubNavButton icon={Play} active={drawerOpen && activeTab === 'operations'} onClick={() => toggleDrawerTab('operations')}>
          开始游戏
        </HubNavButton>
        <HubNavButton icon={Star} active={drawerOpen && activeTab === 'operators'} onClick={() => toggleDrawerTab('operators')}>
          干员
        </HubNavButton>
        <HubNavButton icon={Crosshair} active={drawerOpen && activeTab === 'arsenal'} onClick={() => toggleDrawerTab('arsenal')}>
          武器配置
        </HubNavButton>
        <HubNavButton icon={ShoppingCart} active={storeOpen} onClick={() => toggleDrawerTab('store')}>
          补给站
        </HubNavButton>
        <button className="hub-nav-button hub-settings-nav" onClick={onSettings}>
          <Settings size={22} strokeWidth={1.8} aria-hidden="true" />
          <strong>设置</strong>
        </button>
      </nav>

      <button className={drawerOpen ? 'hub-drawer-handle open' : 'hub-drawer-handle'} onClick={() => setDrawerOpen((value) => !value)} aria-label={drawerOpen ? '收起功能面板' : `展开${activeTabLabel}`} aria-expanded={drawerOpen}>
        {drawerOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        {!drawerOpen && <span>{activeTabLabel}</span>}
      </button>

      <section className={drawerOpen ? 'hub-drawer open' : 'hub-drawer collapsed'} aria-live="polite" aria-hidden={!drawerOpen}>
        <button className="hub-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="收起功能面板" title="收起"><PanelLeftClose size={19} /></button>
        {activeTab === 'operations' && (
          <OperationsPanel
            modes={OPERATION_MODES}
            selected={selectedMode}
            onSelect={setSelectedMode}
            selectedMapId={selectedMapId}
            onSelectMap={setSelectedMapId}
            mapPickerOpen={mapPickerOpen}
            onToggleMapPicker={() => setMapPickerOpen((value) => !value)}
            onStart={onStart}
            selectedWeapon={selectedWeapon}
            selectedOperator={operator}
          />
        )}
        {activeTab === 'operators' && (
          <OperatorsPanel operators={OPERATORS} selected={operatorId} onSelect={setOperatorId} />
        )}
        {activeTab === 'arsenal' && (
          <ArsenalPanel
            weapons={weapons}
            selectedWeaponId={selectedWeaponId}
            onSelect={setSelectedWeaponId}
            onOpenRange={() => {
              setRangeOpen(true)
              setDrawerOpen(false)
            }}
          />
        )}
      </section>

      <div className="hub-right-rail">
      <aside className="hub-squad" aria-label="当前小队">
        <div className="hub-panel-heading">
          <span>小队</span>
            <strong>1 / 5</strong>
          <ChevronUp size={18} aria-hidden="true" />
        </div>
        <div className="hub-squad-member active">
          <span className="hub-member-avatar"><CircleUserRound size={22} /></span>
          <span className="hub-member-copy"><strong>{displayName}</strong><small>队长 · 大厅中</small></span>
          <Headphones size={17} aria-label="语音可用" />
        </div>
        <button className="hub-invite" onClick={() => setActiveTool('friends')}>
          <UserPlus size={20} aria-hidden="true" />
          <span><strong>邀请队员</strong><small>好友服务未接入</small></span>
        </button>
        <button className="hub-view-squad" onClick={() => setActiveTool('friends')}>查看小队</button>
      </aside>

      <aside className="hub-checkin" aria-label="每日签到">
        <div className="hub-panel-heading">
          <span>每日签到</span>
          <strong><CalendarCheck size={15} />连续 {checkIn?.currentStreak ?? 0} 天</strong>
        </div>
        {checkInStatus === 'loading' && <div className="hub-checkin-empty">正在同步签到记录</div>}
        {checkInStatus === 'unavailable' && !checkIn && <div className="hub-checkin-empty">签到服务不可用</div>}
        {checkIn && (
          <div className="hub-checkin-body">
            <div className="hub-checkin-week" aria-label="七日签到奖励">
              {[100, 150, 200, 250, 300, 350, 500].map((reward, index) => {
                const day = index + 1
                const completed = checkIn.currentStreak >= day
                const active = !checkIn.checkedIn && Math.min(checkIn.currentStreak + 1, 7) === day
                return <span className={completed ? 'completed' : active ? 'active' : ''} key={day}><small>D{day}</small>{completed ? <Check size={13} /> : <strong>{reward}</strong>}</span>
              })}
            </div>
            <div className="hub-checkin-action">
              <span className="hub-checkin-reward"><Gift size={18} /><span><small>{checkIn.checkedIn ? '明日奖励' : '今日奖励'}</small><strong>{(checkIn.checkedIn ? checkIn.nextReward : checkIn.reward).toLocaleString()} 积分</strong></span></span>
              <button onClick={handleCheckIn} disabled={checkIn.checkedIn || checkInStatus === 'claiming'}>{checkIn.checkedIn ? <><Check size={17} />已签到</> : checkInStatus === 'claiming' ? '领取中' : '签到领取'}</button>
            </div>
            {checkInNotice && <div className={checkInStatus === 'unavailable' ? 'hub-checkin-notice error' : 'hub-checkin-notice'}>{checkInNotice}</div>}
          </div>
        )}
      </aside>

      <aside className="hub-challenges" aria-label="每日挑战">
        <div className="hub-panel-heading">
          <span>每日挑战</span>
          <span className="hub-challenge-timer"><Timer size={15} />{taskStatus === 'ready' ? '服务器任务' : taskStatus === 'loading' ? '同步中' : '服务不可用'}</span>
          <button className={challengesExpanded ? 'hub-panel-toggle expanded' : 'hub-panel-toggle'} onClick={() => setChallengesExpanded((value) => !value)} aria-label={challengesExpanded ? '收起每日挑战' : '展开每日挑战'} aria-expanded={challengesExpanded}><ChevronDown size={16} /></button>
        </div>
        <div className={challengesExpanded ? 'hub-challenge-list expanded' : 'hub-challenge-list'}>
        {taskStatus === 'ready' && tasks.filter((task) => challengesExpanded || task.tracked).map((task) => {
          const completed = task.value >= task.target
          return (
            <div className={task.tracked ? 'hub-challenge tracked' : 'hub-challenge'} key={task.id}>
              <div className="hub-challenge-row">
                <span>{task.label}</span>
                <strong>{task.value} / {task.target}</strong>
              </div>
              <div className="hub-progress"><i style={{ width: `${Math.min(100, task.value / Math.max(task.target, 1) * 100)}%` }} /></div>
              <div className="hub-challenge-actions">
                <small><Medal size={14} />{task.reward.toLocaleString()} XP</small>
                {completed ? (
                  <button className="hub-mini-action" onClick={() => claimChallenge(task)} disabled={task.claimed}>
                    {task.claimed ? '已领取' : '领取'}
                  </button>
                ) : (
                  <button className="hub-mini-action" onClick={() => trackChallenge(task)}>
                    {task.tracked ? '追踪中' : '追踪'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {taskStatus === 'loading' && <div className="hub-task-empty">正在从任务服务同步</div>}
        {taskStatus === 'unavailable' && <div className="hub-task-empty">任务服务不可用，未显示本地模拟数据</div>}
        {taskStatus === 'ready' && tasks.length === 0 && <div className="hub-task-empty">当前没有可用任务</div>}
        </div>
      </aside>
      </div>

      <footer className="hub-footer">
        <div className="hub-footer-hints"><span>版本公告</span><span>行动简报</span></div>
        <div className="hub-connection"><Wifi size={15} />{settings.serverUrl}</div>
      </footer>
    </main>
  )
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  active = false,
  badge = 0,
}: {
  label: string
  icon: LucideIcon
  onClick?: () => void
  active?: boolean
  badge?: number
}) {
  return (
    <button className={active ? 'hub-icon-button active' : 'hub-icon-button'} aria-label={label} title={label} onClick={onClick}>
      <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
      {badge > 0 && <span className="hub-tool-badge">{badge}</span>}
    </button>
  )
}

function HubNavButton({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean
  icon: LucideIcon
  onClick: () => void
  children: string
}) {
  return (
    <button className={active ? 'hub-nav-button active' : 'hub-nav-button'} onClick={onClick} role="tab" aria-selected={active}>
      <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
      <strong>{children}</strong>
    </button>
  )
}

function HubToolPopover({
  activeTool,
  voiceEnabled,
  micMuted,
  onClose,
  onVoiceEnabled,
  onMicMuted,
}: {
  activeTool: Exclude<HubTool, null>
  voiceEnabled: boolean
  micMuted: boolean
  onClose: () => void
  onVoiceEnabled: (enabled: boolean) => void
  onMicMuted: (muted: boolean) => void
}) {
  const title = activeTool === 'notifications' ? '通知中心' : activeTool === 'friends' ? '好友与小队' : '语音频道'

  return (
    <aside className="hub-popover" aria-label={title}>
      <div className="hub-popover-header">
        <strong>{title}</strong>
        <button aria-label="关闭" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      {activeTool === 'notifications' && (
        <div className="hub-tool-list">
          <div className="hub-tool-empty">通知服务未接入，未显示本地模拟数据</div>
        </div>
      )}
      {activeTool === 'friends' && (
        <div className="hub-tool-list">
          <div className="hub-tool-empty">好友服务未接入，未显示本地模拟数据</div>
        </div>
      )}
      {activeTool === 'voice' && (
        <div className="hub-voice-panel">
          <button className={voiceEnabled ? 'hub-toggle active' : 'hub-toggle'} onClick={() => onVoiceEnabled(!voiceEnabled)}>
            <Headphones size={19} />
            <span><strong>小队语音</strong><small>{voiceEnabled ? '频道已连接' : '频道已关闭'}</small></span>
          </button>
          <button className={micMuted ? 'hub-toggle' : 'hub-toggle active'} onClick={() => onMicMuted(!micMuted)} disabled={!voiceEnabled}>
            {micMuted ? <MicOff size={19} /> : <Mic size={19} />}
            <span><strong>麦克风</strong><small>{micMuted ? '静音' : '开启'}</small></span>
          </button>
        </div>
      )}
    </aside>
  )
}

function OperationsPanel({
  modes,
  selected,
  onSelect,
  selectedMapId,
  onSelectMap,
  mapPickerOpen,
  onToggleMapPicker,
  onStart,
  selectedWeapon,
  selectedOperator,
}: {
  modes: OperationMode[]
  selected: ModeId
  onSelect: (id: ModeId) => void
  selectedMapId: MapId
  onSelectMap: (id: MapId) => void
  mapPickerOpen: boolean
  onToggleMapPicker: () => void
  onStart: (mode: GameModeId) => void
  selectedWeapon: WeaponConfig
  selectedOperator: { callsign: string; role: string }
}) {
  const selectedMode = modes.find((mode) => mode.id === selected) ?? modes[0]
  return (
    <div className="hub-list-panel hub-panel-enter" key={selected}>
      <div className="hub-eyebrow">行动中心 / OPERATIONS</div>
      <h2>选择行动</h2>
      <p className="hub-panel-subtitle">先锋小队待命，选择行动区域与规则。</p>
      <div className="hub-mode-list">
        {modes.map((mode) => (
          <button
            className={mode.id === selected ? 'hub-mode-card selected' : 'hub-mode-card'}
            key={mode.id}
            onClick={() => !mode.locked && onSelect(mode.id)}
            disabled={mode.locked}
            aria-pressed={mode.id === selected}
          >
            <span className="hub-mode-icon"><Target size={20} /></span>
            <span className="hub-mode-copy"><strong>{mode.title}</strong><small>{mode.label}</small></span>
            <span className="hub-mode-state">{mode.status}</span>
          </button>
        ))}
      </div>
      {selected === 'demolition' && (
        <section className={mapPickerOpen ? 'hub-map-picker open' : 'hub-map-picker'} aria-label="爆破地图选择">
          <button className="hub-map-picker-header" onClick={onToggleMapPicker} aria-expanded={mapPickerOpen}>
            <span><strong>地图</strong><small>{DEMOLITION_MAPS.find((map) => map.id === selectedMapId)?.title}</small></span>
            {mapPickerOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {mapPickerOpen && (
            <div className="hub-map-choice-list">
              {DEMOLITION_MAPS.map((map) => (
                <button
                  key={map.id}
                  className={map.id === selectedMapId ? 'hub-map-choice selected' : 'hub-map-choice'}
                  disabled={map.available === false}
                  onClick={() => onSelectMap(map.id)}
                  aria-pressed={map.id === selectedMapId}
                >
                  <span className="hub-map-choice-mark">{map.id === 'desertGrey' ? 'A/B/C' : '—'}</span>
                  <span><strong>{map.title}</strong><small>{map.subtitle}</small></span>
                  <em>{map.status}</em>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      <div className="hub-loadout-summary">
        <div><span>干员</span><strong>{selectedOperator.callsign}</strong><small>{selectedOperator.role}</small></div>
        <div><span>主装备</span><strong>{selectedWeapon.displayName}</strong><small>{selectedWeapon.category.toUpperCase()}</small></div>
      </div>
      <div className="hub-operation-action">
        <div className="hub-operation-brief"><span>当前行动</span><strong>{selectedMode.title}</strong><small>{selectedMode.region} · {selectedOperator.callsign} · {selectedWeapon.displayName}</small></div>
        <button className="hub-inline-launch" onClick={() => onStart(selectedMode.id)} disabled={selectedMode.locked}>
          <span>{selectedMode.locked ? selectedMode.status : selectedMode.cta}</span><ChevronRight size={23} />
        </button>
      </div>
    </div>
  )
}

function OperatorsPanel({
  operators,
  selected,
  onSelect,
}: {
  operators: typeof OPERATORS
  selected: OperatorId
  onSelect: (id: OperatorId) => void
}) {
  return (
    <div className="hub-list-panel">
      <div className="hub-eyebrow">干员档案 / OPERATORS</div>
      <h2>选择行动干员</h2>
      <p className="hub-panel-subtitle">选择出战身份，中央展示位会同步切换。</p>
      <div className="operator-list">
        {operators.map((item) => (
          <button
            key={item.id}
            className={item.id === selected ? 'operator-card selected' : 'operator-card'}
            onClick={() => onSelect(item.id)}
            aria-pressed={item.id === selected}
          >
            <span className="operator-card-index">{item.id === 'vanguard' ? 'V' : 'S'}</span>
            <span className="operator-card-copy">
              <strong>{item.callsign}</strong>
              <span>{item.role}</span>
              <small>{item.detail}</small>
            </span>
            <span className="operator-card-state">{item.id === selected ? '已部署' : '选择'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ArsenalPanel({
  weapons,
  selectedWeaponId,
  onSelect,
  onOpenRange,
}: {
  weapons: WeaponConfig[]
  selectedWeaponId: number
  onSelect: (id: number) => void
  onOpenRange: () => void
}) {
  return (
    <div className="hub-list-panel">
      <div className="hub-eyebrow">武器配置 / LOADOUT</div>
      <h2>标准装备清单</h2>
      <p className="hub-panel-subtitle">配置出战偏好，保持行动前装备清晰可读。</p>
      <div className="weapon-table" role="list" aria-label="武器配置">
        <div className="weapon-table-head" aria-hidden="true">
          <span>装备</span><span>类别</span><span>弹匣</span><span>伤害</span>
        </div>
        {weapons.map((weapon) => (
          <button
            className={weapon.id === selectedWeaponId ? 'weapon-table-row selected' : 'weapon-table-row'}
            role="listitem"
            key={weapon.id}
            onClick={() => onSelect(weapon.id)}
            aria-pressed={weapon.id === selectedWeaponId}
          >
            <strong>{weapon.displayName}</strong>
            <span>{weapon.category.toUpperCase()}</span>
            <span>{weapon.ammo}</span>
            <span>{weapon.damage}</span>
          </button>
        ))}
      </div>
      <div className="arsenal-range-entry">
        <div>
          <strong>战术靶场</strong>
          <small>3D 检视 · 试射 · 等级与配件（开发中）</small>
        </div>
        <button onClick={onOpenRange}>
          <Target size={15} />进入靶场
        </button>
      </div>
    </div>
  )
}
