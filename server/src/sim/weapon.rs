//! 服务器权威武器数值（WEAPON-001：配置版本化，服务器拒绝客户端自定义数值）。
//! 数值与客户端 weapons/config.ts 保持一致，命中/伤害计算只发生在服务器。

pub const WEAPON_R1: u32 = 1; // 步枪
pub const WEAPON_P9: u32 = 2; // 手枪
pub const WEAPON_S4: u32 = 3; // 冲锋枪
pub const WEAPON_M1: u32 = 4; // 狙击枪
pub const WEAPON_KNIFE: u32 = 5; // 战术刀
pub const WEAPON_M4_PINK: u32 = 6; // 粉色 M4
pub const WEAPON_LASER_CANNON: u32 = 7; // 激光炮

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
    pub max_range_m: f32,
    pub melee: bool,
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
            max_range_m: 80.0,
            melee: false,
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
            max_range_m: 50.0,
            melee: false,
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
            max_range_m: 40.0,
            melee: false,
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
            max_range_m: 120.0,
            melee: false,
            automatic: false,
        },
        WEAPON_KNIFE => WeaponSpec {
            id: WEAPON_KNIFE,
            damage: 55.0,
            fire_interval_ms: 800,
            mag_size: 0,
            reserve: 0,
            reload_ms: 0,
            headshot_mult: 1.0,
            leg_mult: 1.0,
            falloff_start_m: 0.0,
            falloff_end_m: 2.2,
            falloff_min: 1.0,
            max_range_m: 2.2,
            melee: true,
            automatic: false,
        },
        WEAPON_M4_PINK => WeaponSpec {
            id: WEAPON_M4_PINK,
            damage: 30.0,
            fire_interval_ms: 90,
            mag_size: 25,
            reserve: 75,
            reload_ms: 2400,
            headshot_mult: 3.5,
            leg_mult: 0.75,
            falloff_start_m: 15.0,
            falloff_end_m: 45.0,
            falloff_min: 0.55,
            max_range_m: 80.0,
            melee: false,
            automatic: true,
        },
        WEAPON_LASER_CANNON => WeaponSpec {
            id: WEAPON_LASER_CANNON,
            damage: 48.0,
            fire_interval_ms: 333,
            mag_size: 10,
            reserve: 40,
            reload_ms: 2800,
            headshot_mult: 4.5,
            leg_mult: 0.85,
            falloff_start_m: 30.0,
            falloff_end_m: 110.0,
            falloff_min: 0.82,
            max_range_m: 120.0,
            melee: false,
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

// ---------- 激光炮蓄力 ----------

/// 激光炮从按下到满蓄力的时间。
pub const LASER_CHARGE_MAX_MS: u32 = 800;
/// 释放开火所需的最短蓄力时间。
pub const LASER_CHARGE_MIN_MS: u32 = 150;
/// 最短蓄力下的伤害占比。
pub const LASER_CHARGE_MIN_RATIO: f32 = 0.35;

/// 蓄力比例 → 伤害倍率（0.35 ~ 1.0）。
pub fn laser_damage_ratio(charge_ticks: u32, min_ticks: u32, max_ticks: u32) -> f32 {
    if max_ticks <= min_ticks {
        return 1.0;
    }
    let t = ((charge_ticks.saturating_sub(min_ticks)) as f32 / (max_ticks - min_ticks) as f32)
        .clamp(0.0, 1.0);
    LASER_CHARGE_MIN_RATIO + (1.0 - LASER_CHARGE_MIN_RATIO) * t
}

// ---------- 商店（购买/退款，WEAPON-001 配置版本化） ----------

pub const SHOP_ARMOR: u8 = 1;
pub const SHOP_RIFLE: u8 = 2;
pub const SHOP_SMG: u8 = 3;
pub const SHOP_SNIPER: u8 = 4;
pub const SHOP_SMOKE: u8 = 5;
pub const SHOP_FLASH: u8 = 6;
pub const SHOP_HE: u8 = 7;
pub const SHOP_M4_PINK: u8 = 8;
pub const SHOP_LASER_CANNON: u8 = 9;

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

pub const SHOP_ITEMS: [ShopItem; 9] = [
    ShopItem {
        id: SHOP_ARMOR,
        kind: ShopKind::Armor,
        cost: 650,
        name: "护甲",
    },
    ShopItem {
        id: SHOP_RIFLE,
        kind: ShopKind::Weapon(WEAPON_R1),
        cost: 2700,
        name: "步枪 R1",
    },
    ShopItem {
        id: SHOP_SMG,
        kind: ShopKind::Weapon(WEAPON_S4),
        cost: 1700,
        name: "冲锋枪 S4",
    },
    ShopItem {
        id: SHOP_SNIPER,
        kind: ShopKind::Weapon(WEAPON_M1),
        cost: 4750,
        name: "狙击枪 M1",
    },
    ShopItem {
        id: SHOP_SMOKE,
        kind: ShopKind::Grenade(crate::protocol::GRENADE_SMOKE),
        cost: 300,
        name: "烟雾弹",
    },
    ShopItem {
        id: SHOP_FLASH,
        kind: ShopKind::Grenade(crate::protocol::GRENADE_FLASH),
        cost: 200,
        name: "闪光弹",
    },
    ShopItem {
        id: SHOP_HE,
        kind: ShopKind::Grenade(crate::protocol::GRENADE_HE),
        cost: 300,
        name: "高爆手雷",
    },
    ShopItem {
        id: SHOP_M4_PINK,
        kind: ShopKind::Weapon(WEAPON_M4_PINK),
        cost: 3200,
        name: "M4 粉色",
    },
    ShopItem {
        id: SHOP_LASER_CANNON,
        kind: ShopKind::Weapon(WEAPON_LASER_CANNON),
        cost: 6200,
        name: "激光炮",
    },
];

pub fn shop_item(id: u8) -> Option<&'static ShopItem> {
    SHOP_ITEMS.iter().find(|i| i.id == id)
}

/// 投掷物类型 → 库存槽位（0=烟雾 1=闪光 2=高爆）。
pub fn grenade_slot(kind: u8) -> usize {
    (kind.saturating_sub(1)) as usize
}
