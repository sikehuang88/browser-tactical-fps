// 客户端核心类型。世界坐标以米为单位（服务器线格式为厘米 int16，在 codec 边界转换）。

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 玩家实体快照（本地预测或服务器下发后统一形状）。 */
export interface EntitySnapshot {
  id: number
  position: Vec3
  yaw: number // 度
  pitch: number // 度
  moving: boolean
  crouching: boolean
  health: number
  weaponId: number
}

/** 原始输入（一次客户端 tick 采集，预测与网络共用）。 */
export interface RawInput {
  buttons: number
  yawDelta: number // 厘度（相对增量）
  pitchDelta: number // 厘度（相对增量）
  forwardAxis: number // -127..127
  strafeAxis: number // -127..127
}

/** 发送给服务器的输入帧。 */
export interface InputFrame extends RawInput {
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
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: 'player',
  serverUrl: 'ws://127.0.0.1:9000/ws',
  online: false,
  sensitivity: 0.15,
  fov: 90,
  crosshairColor: '#4ade80',
}
