// 武器配置（版本化）。M0 提供首发武器子集的数值定义，服务端权威版本见 proto game.proto。
// 数值为占位原型，最终由策划配置表驱动（WEAPON-001）。

export type WeaponCategory = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'melee'

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
  maxRangeM: number
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
    maxRangeM: 80,
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
    maxRangeM: 50,
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
    maxRangeM: 40,
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
    maxRangeM: 120,
  },
  {
    id: 5,
    name: 'tactical_knife',
    displayName: '战术刀',
    category: 'melee',
    damage: 55,
    fireRatePerMin: 75,
    ammo: 0,
    reserve: 0,
    reloadMs: 0,
    automatic: false,
    penetrationPower: 0,
    armorDamageRatio: 1000,
    maxRangeM: 2.2,
  },
  {
    id: 6,
    name: 'm4_pink',
    displayName: 'M4 粉色',
    category: 'rifle',
    damage: 30,
    fireRatePerMin: 667,
    ammo: 25,
    reserve: 75,
    reloadMs: 2400,
    automatic: true,
    penetrationPower: 68,
    armorDamageRatio: 750,
    maxRangeM: 80,
  },
  {
    id: 7,
    name: 'laser_cannon',
    displayName: '激光炮',
    category: 'rifle',
    damage: 48,
    fireRatePerMin: 180,
    ammo: 10,
    reserve: 40,
    reloadMs: 2800,
    automatic: false,
    penetrationPower: 95,
    armorDamageRatio: 900,
    maxRangeM: 120,
  },
]

export const WEAPON_BY_ID = new Map<number, WeaponConfig>(WEAPONS.map((w) => [w.id, w]))
