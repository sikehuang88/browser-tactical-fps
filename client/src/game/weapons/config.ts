// 武器配置（版本化）。M0 提供首发武器子集的数值定义，服务端权威版本见 proto game.proto。
// 数值为占位原型，最终由策划配置表驱动（WEAPON-001）。

export type WeaponCategory = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun'

export interface WeaponConfig {
  id: number
  name: string
  displayName: string
  category: WeaponCategory
  damage: number
  fireRatePerMin: number
  ammo: number
  reserve: number
  reloadMs: number
  automatic: boolean
  penetrationPower: number // 0..100
  armorDamageRatio: number // 千分比
}

export const WEAPONS: WeaponConfig[] = [
  {
    id: 1,
    name: 'strike_r1',
    displayName: '步枪 R1',
    category: 'rifle',
    damage: 32,
    fireRatePerMin: 600,
    ammo: 30,
    reserve: 90,
    reloadMs: 2200,
    automatic: true,
    penetrationPower: 70,
    armorDamageRatio: 770,
  },
  {
    id: 2,
    name: 'pistol_p9',
    displayName: '手枪 P9',
    category: 'pistol',
    damage: 26,
    fireRatePerMin: 420,
    ammo: 12,
    reserve: 48,
    reloadMs: 1500,
    automatic: false,
    penetrationPower: 35,
    armorDamageRatio: 650,
  },
  {
    id: 3,
    name: 'smg_s4',
    displayName: '冲锋枪 S4',
    category: 'smg',
    damage: 20,
    fireRatePerMin: 800,
    ammo: 30,
    reserve: 120,
    reloadMs: 1800,
    automatic: true,
    penetrationPower: 40,
    armorDamageRatio: 700,
  },
  {
    id: 4,
    name: 'sniper_m1',
    displayName: '狙击枪 M1',
    category: 'sniper',
    damage: 110,
    fireRatePerMin: 40,
    ammo: 5,
    reserve: 30,
    reloadMs: 3000,
    automatic: false,
    penetrationPower: 90,
    armorDamageRatio: 900,
  },
]

export const WEAPON_BY_ID = new Map<number, WeaponConfig>(WEAPONS.map((w) => [w.id, w]))
