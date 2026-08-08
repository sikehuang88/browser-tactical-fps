//! 投掷物实体：服务器权威弹道/反弹/引信（WEAPON-005）。
//! 客户端仅按 GrenadeSpawn 渲染飞行，玩法结果全部由本模块 + world 决定。

use super::map::{Aabb, ARENA_BOUNDS, GROUND_Y};
use crate::protocol::{GRENADE_FLASH, GRENADE_HE, GRENADE_SMOKE};

pub const GRENADE_RADIUS: f32 = 0.12;
pub const THROW_SPEED: f32 = 20.0;
const GRAVITY: f32 = 9.81;
const RESTITUTION: f32 = 0.35;
const HORIZ_DAMP: f32 = 0.7;

#[derive(Clone, Copy)]
pub struct Grenade {
    pub id: u32,
    pub kind: u8,
    pub owner: u32,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub age_ticks: u64,
    pub rest_ticks: u64,
    pub fuse_total: u64,
}

pub fn fuse_ticks(kind: u8, tick_rate: u32) -> u64 {
    let ms = match kind {
        GRENADE_SMOKE => 1500,
        GRENADE_FLASH => 2000,
        GRENADE_HE => 2500,
        _ => 2000,
    };
    (ms as u64 * tick_rate as u64 / 1000).max(1)
}

/// 推进一枚手雷一个 tick；返回 true 表示引信触发（需触发效果）。
/// 触发条件：到龄（age ≥ fuse）或 落地静止（rest 足够久且速度低）。
pub fn step_grenade(g: &mut Grenade, dt: f32, walls: &[Aabb]) -> bool {
    g.vel[1] -= GRAVITY * dt;
    g.pos[0] += g.vel[0] * dt;
    g.pos[1] += g.vel[1] * dt;
    g.pos[2] += g.vel[2] * dt;

    // 墙体反弹（按最小穿透轴反射）
    for w in walls {
        if point_in_aabb(g.pos, w) {
            let cx = (w.min[0] + w.max[0]) * 0.5;
            let cy = (w.min[1] + w.max[1]) * 0.5;
            let cz = (w.min[2] + w.max[2]) * 0.5;
            let dx = (g.pos[0] - cx).abs();
            let dy = (g.pos[1] - cy).abs();
            let dz = (g.pos[2] - cz).abs();
            if dx >= dy && dx >= dz {
                g.pos[0] = if g.pos[0] < cx {
                    w.min[0] - GRENADE_RADIUS
                } else {
                    w.max[0] + GRENADE_RADIUS
                };
                g.vel[0] = -g.vel[0] * RESTITUTION;
            } else if dy >= dx && dy >= dz {
                g.pos[1] = if g.pos[1] < cy {
                    w.min[1] - GRENADE_RADIUS
                } else {
                    w.max[1] + GRENADE_RADIUS
                };
                g.vel[1] = -g.vel[1] * RESTITUTION;
            } else {
                g.pos[2] = if g.pos[2] < cz {
                    w.min[2] - GRENADE_RADIUS
                } else {
                    w.max[2] + GRENADE_RADIUS
                };
                g.vel[2] = -g.vel[2] * RESTITUTION;
            }
        }
    }

    // 地面反弹
    let mut on_ground = false;
    if g.pos[1] <= GROUND_Y + GRENADE_RADIUS {
        g.pos[1] = GROUND_Y + GRENADE_RADIUS;
        if g.vel[1] < 0.0 {
            g.vel[1] = -g.vel[1] * RESTITUTION;
        }
        g.vel[0] *= HORIZ_DAMP;
        g.vel[2] *= HORIZ_DAMP;
        on_ground = true;
    }

    // 竞技区边界夹紧（防止手雷飞出地图）
    for i in 0..3 {
        if g.pos[i] < ARENA_BOUNDS.min[i] {
            g.pos[i] = ARENA_BOUNDS.min[i];
            g.vel[i] = g.vel[i].abs() * RESTITUTION;
        } else if g.pos[i] > ARENA_BOUNDS.max[i] {
            g.pos[i] = ARENA_BOUNDS.max[i];
            g.vel[i] = -g.vel[i].abs() * RESTITUTION;
        }
    }

    g.age_ticks += 1;
    if on_ground {
        g.rest_ticks += 1;
    } else {
        g.rest_ticks = 0;
    }
    g.age_ticks >= g.fuse_total
}

pub fn point_in_aabb(p: [f32; 3], aabb: &Aabb) -> bool {
    p[0] > aabb.min[0]
        && p[0] < aabb.max[0]
        && p[1] > aabb.min[1]
        && p[1] < aabb.max[1]
        && p[2] > aabb.min[2]
        && p[2] < aabb.max[2]
}
