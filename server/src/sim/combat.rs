//! 服务器权威命中判定（WEAPON-003/004/006 基础实现）。
//! 射线命中 + 延迟补偿（历史位置回溯 ≤200ms）+ 部位伤害区 + 距离衰减 + 掩体阻挡。

use std::collections::{HashMap, VecDeque};

use super::map::Aabb;
use super::player::Player;
use super::weapon::WeaponSpec;

pub const EYE_STAND: f32 = 1.6;
pub const EYE_CROUCH: f32 = 1.2;
pub const STAND_HEIGHT: f32 = 1.8;
pub const CROUCH_HEIGHT: f32 = 1.35;
pub const HIT_RADIUS: f32 = 0.4;
/// 延迟补偿回溯窗口（≤200ms，64 tick 下 13 tick）。
pub const MAX_LOOKBACK_TICKS: u64 = 13;

/// 烟雾云（阻挡命中判定，WEAPON-005 玩法效果）。
#[derive(Clone, Copy)]
pub struct SmokeBlocker {
    pub pos: [f32; 3],
    pub radius: f32,
}

/// 玩家只读视图快照：战斗阶段避免对 players 的双重借用。
#[derive(Clone, Copy)]
pub struct PlayerView {
    pub id: u32,
    pub pos: [f32; 3],
    pub height: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub alive: bool,
    pub team: u8,
    pub weapon_id: u32,
    pub ammo: u32,
    pub reloading: bool,
    pub next_fire_tick: u64,
    pub rtt_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HitZone {
    Head,
    Body,
    Legs,
}

#[derive(Debug, Clone, Copy)]
pub struct Hit {
    pub victim_id: u32,
    pub damage: f32,
    pub zone: HitZone,
    pub distance_m: f32,
    pub headshot: bool,
}

/// 视角前向（与客户端第一人称相机一致）：yaw=0 → -Z，pitch 为正 → 朝上。
pub fn forward_dir(yaw_deg: f32, pitch_deg: f32) -> [f32; 3] {
    let y = yaw_deg.to_radians();
    let p = pitch_deg.to_radians();
    let cp = p.cos();
    [-y.sin() * cp, p.sin(), -y.cos() * cp]
}

/// 射线-盒子相交（slab 法）。起点在盒外返回"入口 t"，起点在盒内返回"出口 t"；
/// 起点在盒内且未命中盒子返回 None。用于掩体阻挡判定（射手始终在竞技区内，入口 t=0 不应算阻挡）。
pub fn ray_aabb(origin: [f32; 3], dir: [f32; 3], aabb: &Aabb) -> Option<f32> {
    let mut tmin = 0.0f32;
    let mut tmax = f32::INFINITY;
    for i in 0..3 {
        if dir[i].abs() < 1e-8 {
            if origin[i] < aabb.min[i] || origin[i] > aabb.max[i] {
                return None;
            }
        } else {
            let inv = 1.0 / dir[i];
            let mut t1 = (aabb.min[i] - origin[i]) * inv;
            let mut t2 = (aabb.max[i] - origin[i]) * inv;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            tmin = tmin.max(t1);
            tmax = tmax.min(t2);
            if tmin > tmax {
                return None;
            }
        }
    }
    if tmin > 0.0 {
        Some(tmin)
    } else if tmax.is_finite() {
        Some(tmax)
    } else {
        None
    }
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// 射线-线段最近距离：返回 (距离², 线段参数 s∈[0,1], 射线参数 t)。
fn ray_segment(origin: [f32; 3], dir: [f32; 3], a: [f32; 3], b: [f32; 3]) -> (f32, f32, f32) {
    let d1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let (aa, bb, cc, dd, ee) = (
        dot(d1, d1),
        dot(d1, dir),
        dot(dir, dir),
        dot(d1, [a[0] - origin[0], a[1] - origin[1], a[2] - origin[2]]),
        dot(dir, [a[0] - origin[0], a[1] - origin[1], a[2] - origin[2]]),
    );
    let denom = aa * cc - bb * bb;
    let mut s = if denom.abs() < 1e-8 {
        0.0
    } else {
        (bb * ee - cc * dd) / denom
    };
    s = s.clamp(0.0, 1.0);
    let t = if cc > 1e-8 {
        ((bb * s + ee) / cc).max(0.0)
    } else {
        0.0
    };
    let p = [
        origin[0] + dir[0] * t,
        origin[1] + dir[1] * t,
        origin[2] + dir[2] * t,
    ];
    let q = [a[0] + d1[0] * s, a[1] + d1[1] * s, a[2] + d1[2] * s];
    let dist2 = (p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2);
    (dist2, s, t)
}

fn zone_from_s(s: f32) -> (HitZone, bool) {
    if s > 0.7 {
        (HitZone::Head, true)
    } else if s < 0.3 {
        (HitZone::Legs, false)
    } else {
        (HitZone::Body, false)
    }
}

fn eye_height(height: f32) -> f32 {
    let t = ((height - CROUCH_HEIGHT) / (STAND_HEIGHT - CROUCH_HEIGHT)).clamp(0.0, 1.0);
    EYE_CROUCH + (EYE_STAND - EYE_CROUCH) * t
}

/// 回溯位置：返回 victim 在 target_tick 附近的历史位置（延迟补偿）。
fn replayed_pos(
    id: u32,
    current: [f32; 3],
    history: &HashMap<u32, VecDeque<(u64, [f32; 3])>>,
    target_tick: u64,
) -> [f32; 3] {
    if let Some(h) = history.get(&id) {
        for entry in h.iter().rev() {
            if entry.0 <= target_tick {
                return entry.1;
            }
        }
    }
    current
}

/// 伤害计算：部位倍率 × 距离衰减。
pub fn damage_for(spec: &WeaponSpec, distance_m: f32, zone: HitZone) -> f32 {
    let mult = match zone {
        HitZone::Head => spec.headshot_mult,
        HitZone::Body => 1.0,
        HitZone::Legs => spec.leg_mult,
    };
    let ratio = if distance_m <= spec.falloff_start_m {
        1.0
    } else if distance_m >= spec.falloff_end_m {
        spec.falloff_min
    } else {
        1.0 - (1.0 - spec.falloff_min) * (distance_m - spec.falloff_start_m)
            / (spec.falloff_end_m - spec.falloff_start_m)
    };
    spec.damage * ratio * mult
}

/// 结算一次命中伤害：护甲减伤 + 致死判定。返回实际造成的伤害值（服务器权威）。
pub fn apply_damage(victim: &mut Player, raw_damage: f32, zone: HitZone) -> u16 {
    let mut dmg = raw_damage;
    if victim.armor > 0 && zone != HitZone::Head {
        dmg = raw_damage * 0.77; // 护甲削减 23% 躯干/腿部伤害
        let armor_drain = (raw_damage * 0.4).ceil() as u32;
        victim.armor = victim.armor.saturating_sub(armor_drain);
    }
    let dealt = dmg.max(0.0).round() as i16;
    victim.health = (victim.health - dealt).max(0);
    if victim.health <= 0 {
        victim.health = 0;
        victim.alive = false;
    }
    dealt as u16
}

/// 命中检测：遍历视图快照中所有存活异队玩家，结合历史位置回溯，
/// 取最近且未被掩体阻挡的命中。
/// 射线是否穿过烟雾云（阻挡命中）。
fn ray_sphere_blocked(
    origin: [f32; 3],
    dir: [f32; 3],
    target_t: f32,
    smoke: &SmokeBlocker,
) -> bool {
    let m = [
        smoke.pos[0] - origin[0],
        smoke.pos[1] - origin[1],
        smoke.pos[2] - origin[2],
    ];
    let t = dot(m, dir);
    if t < 0.0 || t > target_t {
        return false;
    }
    let closest = [
        origin[0] + dir[0] * t,
        origin[1] + dir[1] * t,
        origin[2] + dir[2] * t,
    ];
    let d2 = (closest[0] - smoke.pos[0]).powi(2)
        + (closest[1] - smoke.pos[1]).powi(2)
        + (closest[2] - smoke.pos[2]).powi(2);
    d2 < smoke.radius * smoke.radius
}

#[allow(clippy::too_many_arguments)]
pub fn fire_hitscan(
    shooter: &PlayerView,
    views: &[PlayerView],
    walls: &[Aabb],
    bounds: &Aabb,
    smokes: &[SmokeBlocker],
    history: &HashMap<u32, VecDeque<(u64, [f32; 3])>>,
    tick: u64,
    tick_rate: u32,
) -> Option<Hit> {
    if shooter.team == 0 || !shooter.alive {
        return None;
    }
    let spec = super::weapon::get_weapon(shooter.weapon_id);
    let origin = [
        shooter.pos[0],
        shooter.pos[1] + eye_height(shooter.height),
        shooter.pos[2],
    ];
    let dir = forward_dir(shooter.yaw, shooter.pitch);

    let lookback = ((shooter.rtt_ms as u64) * (tick_rate as u64) / 1000).min(MAX_LOOKBACK_TICKS);
    let target_tick = tick.saturating_sub(lookback);

    let mut best: Option<(Hit, f32)> = None;
    for victim in views {
        if victim.id == shooter.id
            || !victim.alive
            || victim.team == 0
            || victim.team == shooter.team
        {
            continue;
        }

        let pos = replayed_pos(victim.id, victim.pos, history, target_tick);
        let feet = [pos[0], pos[1], pos[2]];
        let head = [pos[0], pos[1] + victim.height, pos[2]];
        let (dist2, s, t) = ray_segment(origin, dir, feet, head);
        if dist2 > HIT_RADIUS * HIT_RADIUS || t > spec.max_range_m {
            continue;
        }

        // 掩体阻挡：命中点前的墙/边界挡路则跳过（穿透为后续里程碑 WEAPON-006）
        if let Some(wt) = ray_aabb(origin, dir, bounds) {
            if wt < t - 0.05 {
                continue;
            }
        }
        let mut blocked = false;
        for wall in walls {
            if let Some(wt) = ray_aabb(origin, dir, wall) {
                if wt < t - 0.05 {
                    blocked = true;
                    break;
                }
            }
        }
        if !blocked && !spec.melee {
            for smoke in smokes {
                if ray_sphere_blocked(origin, dir, t, smoke) {
                    blocked = true;
                    break;
                }
            }
        }
        if blocked {
            continue;
        }

        let (zone, headshot) = zone_from_s(s);
        let headshot = headshot && !spec.melee;
        let distance_m = t; // 沿射线的距离
        let damage = damage_for(&spec, distance_m, zone);

        if best.as_ref().is_none_or(|(_, bt)| t < *bt) {
            best = Some((
                Hit {
                    victim_id: victim.id,
                    damage,
                    zone,
                    distance_m,
                    headshot,
                },
                t,
            ));
        }
    }
    best.map(|(h, _)| h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player_view(id: u32, team: u8, pos: [f32; 3], crouching: bool, pitch: f32) -> PlayerView {
        PlayerView {
            id,
            pos,
            height: if crouching {
                CROUCH_HEIGHT
            } else {
                STAND_HEIGHT
            },
            yaw: 0.0,
            pitch,
            alive: true,
            team,
            weapon_id: super::super::weapon::WEAPON_P9,
            ammo: 12,
            reloading: false,
            next_fire_tick: 0,
            rtt_ms: 0,
        }
    }

    #[test]
    fn crouched_target_does_not_keep_standing_hit_height() {
        let shooter = player_view(1, 1, [0.0, 0.0, 0.0], false, 3.0);
        let standing = player_view(2, 2, [0.0, 0.0, -5.0], false, 0.0);
        let crouching = player_view(2, 2, [0.0, 0.0, -5.0], true, 0.0);
        let bounds = Aabb {
            min: [-100.0, -10.0, -100.0],
            max: [100.0, 10.0, 100.0],
        };
        let history = HashMap::new();

        assert!(fire_hitscan(
            &shooter,
            &[shooter, standing],
            &[],
            &bounds,
            &[],
            &history,
            0,
            64,
        )
        .is_some());
        assert!(fire_hitscan(
            &shooter,
            &[shooter, crouching],
            &[],
            &bounds,
            &[],
            &history,
            0,
            64,
        )
        .is_none());
    }

    #[test]
    fn knife_hit_is_limited_to_melee_range() {
        let mut shooter = player_view(1, 1, [0.0, 0.0, 0.0], false, 0.0);
        shooter.weapon_id = super::super::weapon::WEAPON_KNIFE;
        let near = player_view(2, 2, [0.0, 0.0, -2.0], false, 0.0);
        let far = player_view(2, 2, [0.0, 0.0, -3.0], false, 0.0);
        let bounds = Aabb {
            min: [-100.0, -10.0, -100.0],
            max: [100.0, 10.0, 100.0],
        };
        let history = HashMap::new();

        assert!(fire_hitscan(
            &shooter,
            &[shooter, near],
            &[],
            &bounds,
            &[],
            &history,
            0,
            64,
        )
        .is_some());
        assert!(fire_hitscan(
            &shooter,
            &[shooter, far],
            &[],
            &bounds,
            &[],
            &history,
            0,
            64,
        )
        .is_none());
    }
}
