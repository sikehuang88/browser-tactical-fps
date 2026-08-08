// 客户端核心类型。世界坐标以米为单位（服务器线格式为厘米 int16，在 codec 边界转换）。

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type GameModeId = 'teamDeathmatch' | 'demolition' | 'training' | 'custom'

/** 玩家实体快照（本地预测或服务器下发后统一形状）。 */
export interface EntitySnapshot {
  id: number
  position: Vec3
  yaw: number // 度
  pitch: number // 度
  moving: boolean
  sprinting: boolean
  crouching: boolean
  health: number
  weaponId: number
  ammo: number
  reloading: boolean
  team: number // 1=攻击方 2=防守方
  /** Offline-only marker; never serialized in online snapshots. */
  isBot?: boolean
  displayName?: string
  targetId?: number
}

/** 原始输入（一次客户端 tick 采集，预测与网络共用）。 */
export interface RawInput {
  buttons: number
  yawDelta: number // 厘度（相对增量）
  pitchDelta: number // 厘度（相对增量）
  forwardAxis: number // -127..127
  strafeAxis: number // -127..127
  /** Local-only aim state; never serialized to the server input frame. */
  aiming: boolean
}

/** 发送给服务器的输入帧。 */
/** Network input frame: local-only aiming state is intentionally not serialized. */
export interface InputFrame extends Omit<RawInput, 'aiming'> {
  seq: number
  clientSentAtMs: number
}

export interface Settings {
  displayName: string
  serverUrl: string
  online: boolean
  sensitivity: number // 度/像素
  fov: number
  crosshairColor: string
  volumeMaster: number // 0..1
  volumeSfx: number // 0..1
  quality: 'low' | 'medium' | 'high' | 'ultra' | 'custom'
  resolutionScale: number // 0.5..1
  shadows: boolean
  weatherEnabled: boolean
  effectsQuality: 'low' | 'high'
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: 'player',
  serverUrl: 'ws://127.0.0.1:9000/ws',
  online: false,
  sensitivity: 0.15,
  fov: 90,
  crosshairColor: '#4ade80',
  volumeMaster: 0.8,
  volumeSfx: 1.0,
  quality: 'high',
  resolutionScale: 1,
  shadows: false,
  weatherEnabled: true,
  effectsQuality: 'high',
}
