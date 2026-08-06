//! 服务器权威武器数值（WEAPON-001：配置版本化，服务器拒绝客户端自定义数值）。
//! 数值与客户端 weapons/config.ts 保持一致，命中/伤害计算只发生在服务器。

pub const WEAPON_R1: u32 = 1; // 步枪
pub const WEAPON_P9: u32 = 2; // 手枪
pub const WEAPON_S4: u32 = 3; // 冲锋枪
pub const WEAPON_M1: u32 = 4; // 狙击枪

#[derive(Clone, Copy)]
pub struct WeaponSpec {
    pub id: u32,
    pub damage: f32,
    pub fire_interval_ms: u32,
    pub mag_size: u32,
    #[allow(dead_code)] // 弹药储备/全自动标记，购买系统与射击手感后续使用
    pub reserve: u32,
    pub reload_ms: u32,
    pub headshot_mult: f32,
    pub leg_mult: f32,
    pub falloff_start_m: f32,
    pub falloff_end_m: f32,
    pub falloff_min: f32,
    #[allow(dead_code)]
    pub automatic: bool,
}

pub fn get_weapon(id: u32) -> WeaponSpec {
    match id {
        WEAPON_R1 => WeaponSpec {
            id: WEAPON_R1,
            damage: 32.0,
            fire_interval_ms: 100,
            mag_size: 30,
            reserve: 90,
            reload_ms: 2200,
            headshot_mult: 4.0,
            leg_mult: 0.75,
            falloff_start_m: 15.0,
            falloff_end_m: 45.0,
            falloff_min: 0.55,
            automatic: true,
        },
        WEAPON_P9 => WeaponSpec {
            id: WEAPON_P9,
            damage: 26.0,
            fire_interval_ms: 143,
            mag_size: 12,
            reserve: 48,
            reload_ms: 1500,
            headshot_mult: 3.0,
            leg_mult: 0.7,
            falloff_start_m: 10.0,
            falloff_end_m: 35.0,
            falloff_min: 0.6,
            automatic: false,
        },
        WEAPON_S4 => WeaponSpec {
            id: WEAPON_S4,
            damage: 20.0,
            fire_interval_ms: 75,
            mag_size: 30,
            reserve: 120,
            reload_ms: 1800,
            headshot_mult: 3.0,
            leg_mult: 0.75,
            falloff_start_m: 8.0,
            falloff_end_m: 25.0,
            falloff_min: 0.65,
            automatic: true,
        },
        WEAPON_M1 => WeaponSpec {
            id: WEAPON_M1,
            damage: 110.0,
            fire_interval_ms: 1500,
            mag_size: 5,
            reserve: 30,
            reload_ms: 3000,
            headshot_mult: 5.0,
            leg_mult: 0.85,
            falloff_start_m: 25.0,
            falloff_end_m: 90.0,
            falloff_min: 0.8,
            automatic: false,
        },
        _ => get_weapon(WEAPON_R1),
    }
}

// ---------- 经济常量（GAME-003） ----------

pub const START_MONEY: u32 = 800;
pub const MAX_MONEY: u32 = 16000;
pub const KILL_REWARD: u32 = 300;
pub const WIN_REWARD: u32 = 3250;
pub const LOSS_BASE: u32 = 1400;
pub const LOSS_STREAK_BONUS: u32 = 500;
pub const LOSS_CAP: u32 = 3400;
pub const PLANT_BONUS: u32 = 300;
pub const DEFUSE_BONUS: u32 = 300;
pub const MAX_GRENADES_PER_TYPE: u32 = 3;

// ---------- 商店（购买/退款，WEAPON-001 配置版本化） ----------

pub const SHOP_ARMOR: u8 = 1;
pub const SHOP_RIFLE: u8 = 2;
pub const SHOP_SMG: u8 = 3;
pub const SHOP_SNIPER: u8 = 4;
pub const SHOP_SMOKE: u8 = 5;
pub const SHOP_FLASH: u8 = 6;
pub const SHOP_HE: u8 = 7;

#[derive(Clone, Copy)]
pub enum ShopKind {
    Weapon(u32),
    Armor,
    Grenade(u8), // 对应 GRENADE_SMOKE/FLASH/HE
}

#[derive(Clone, Copy)]
pub struct ShopItem {
    pub id: u8,
    pub kind: ShopKind,
    pub cost: u32,
    #[allow(dead_code)] // 商店展示名称（后续下发客户端购买菜单）
    pub name: &'static str,
}

pub const SHOP_ITEMS: [ShopItem; 7] = [
    ShopItem { id: SHOP_ARMOR, kind: ShopKind::Armor, cost: 650, name: "护甲" },
    ShopItem { id: SHOP_RIFLE, kind: ShopKind::Weapon(WEAPON_R1), cost: 2700, name: "步枪 R1" },
    ShopItem { id: SHOP_SMG, kind: ShopKind::Weapon(WEAPON_S4), cost: 1700, name: "冲锋枪 S4" },
    ShopItem { id: SHOP_SNIPER, kind: ShopKind::Weapon(WEAPON_M1), cost: 4750, name: "狙击枪 M1" },
    ShopItem { id: SHOP_SMOKE, kind: ShopKind::Grenade(crate::protocol::GRENADE_SMOKE), cost: 300, name: "烟雾弹" },
    ShopItem { id: SHOP_FLASH, kind: ShopKind::Grenade(crate::protocol::GRENADE_FLASH), cost: 200, name: "闪光弹" },
    ShopItem { id: SHOP_HE, kind: ShopKind::Grenade(crate::protocol::GRENADE_HE), cost: 300, name: "高爆手雷" },
];

pub fn shop_item(id: u8) -> Option<&'static ShopItem> {
    SHOP_ITEMS.iter().find(|i| i.id == id)
}

/// 投掷物类型 → 库存槽位（0=烟雾 1=闪光 2=高爆）。
pub fn grenade_slot(kind: u8) -> usize {
    (kind.saturating_sub(1)) as usize
}
