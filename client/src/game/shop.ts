// 商店条目（与服务端 weapon.rs SHOP_ITEMS 一致，GAME-003）。

export interface ShopItem {
  id: number
  name: string
  cost: number
  weaponId?: number
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 1, name: '护甲', cost: 650 },
  { id: 2, name: '步枪 R1', cost: 2700, weaponId: 1 },
  { id: 3, name: '冲锋枪 S4', cost: 1700, weaponId: 3 },
  { id: 4, name: '狙击枪 M1', cost: 4750, weaponId: 4 },
  { id: 8, name: 'M4 粉色', cost: 3200, weaponId: 6 },
  { id: 9, name: '激光炮', cost: 6200, weaponId: 7 },
  { id: 5, name: '烟雾弹', cost: 300 },
  { id: 6, name: '闪光弹', cost: 200 },
  { id: 7, name: '高爆手雷', cost: 300 },
]
