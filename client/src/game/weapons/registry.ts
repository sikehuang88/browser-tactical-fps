// 武器注册表：按 id / 名称查询武器配置。

import { WEAPONS, WEAPON_BY_ID, type WeaponConfig } from './config'

export function getWeapon(id: number): WeaponConfig | undefined {
  return WEAPON_BY_ID.get(id)
}

export function listWeapons(): WeaponConfig[] {
  return [...WEAPONS]
}
