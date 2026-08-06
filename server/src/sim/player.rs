//! 玩家实体：移动状态机 + 战斗状态（队伍/存活/武器/经济）。
//! 服务器权威计算速度/位移，客户端输入仅提供按钮与视角增量。

use super::map::Collision;
use super::weapon::{get_weapon, WeaponSpec};
use crate::protocol::{InputFrame, SnapshotEntity, BTN_CROUCH, BTN_JUMP, BTN_SPRINT};

const GRAVITY: f32 = 9.81;
const STAND_HEIGHT: f32 = 1.8;
const CROUCH_HEIGHT: f32 = 1.35;
const HALF_W: f32 = 0.32;
const WALK_SPEED: f32 = 3.8;
const SPRINT_SPEED: f32 = 5.4;
const CROUCH_SPEED: f32 = 1.6;
const ACCEL: f32 = 40.0;
const FRICTION: f32 = 24.0;
const JUMP_VEL: f32 = 4.6;
const MAX_PITCH_DEG: f32 = 89.0;

pub struct Player {
    pub id: u32,
    #[allow(dead_code)] // 名称用于后续计分板/击杀播报
    pub name: String,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub on_ground: bool,
    pub crouching: bool,
    pub health: i16,
    pub team: u8, // 1=attack 2=defend（分配后固定，换边时翻转）
    pub alive: bool,
    pub armor: u32,
    pub weapon_id: u32,
    pub ammo: u32,
    pub reloading: bool,
    pub kills: u32,
    pub deaths: u32,
    pub money: u32,
    /// 投掷物库存 [烟雾, 闪光, 高爆]。
    pub grenades: [u32; 3],
    pub rtt_ms: u32,
    move_speed: f32,
    reload_remaining_ticks: u32,
    pub next_fire_tick: u64,
    pending_input: Option<InputFrame>,
    last_seq: u32,
}

impl Player {
    pub fn new(id: u32, name: String, spawn: [f32; 3]) -> Self {
        let weapon = get_weapon(super::weapon::WEAPON_P9); // 默认手枪
        Self {
            id,
            name,
            pos: spawn,
            vel: [0.0; 3],
            yaw: 0.0,
            pitch: 0.0,
            on_ground: true,
            crouching: false,
            health: 100,
            team: 0,
            alive: true,
            armor: 0,
            weapon_id: weapon.id,
            ammo: weapon.mag_size,
            reloading: false,
            kills: 0,
            deaths: 0,
            money: super::weapon::START_MONEY,
            grenades: [0; 3],
            rtt_ms: 0,
            move_speed: 0.0,
            reload_remaining_ticks: 0,
            next_fire_tick: 0,
            pending_input: None,
            last_seq: 0,
        }
    }

    /// 每回合重置：回出生点、满血；装备回初始（资金保留，购买系统每回合重新采购）。
    pub fn reset_for_round(&mut self, spawn: [f32; 3]) {
        self.pos = spawn;
        self.vel = [0.0; 3];
        self.yaw = if self.team == 1 { 0.0 } else { 180.0 };
        self.pitch = 0.0;
        self.on_ground = true;
        self.crouching = false;
        self.health = 100;
        self.alive = true;
        self.armor = 0;
        self.grenades = [0; 3];
        self.set_primary(super::weapon::WEAPON_P9);
        self.reloading = false;
        self.reload_remaining_ticks = 0;
        self.next_fire_tick = 0;
    }

    /// 更换主武器并补满弹药。
    pub fn set_primary(&mut self, weapon_id: u32) {
        let spec = get_weapon(weapon_id);
        self.weapon_id = spec.id;
        self.ammo = spec.mag_size;
        self.reloading = false;
        self.reload_remaining_ticks = 0;
        self.next_fire_tick = 0;
    }

    pub fn grant_money(&mut self, amount: u32) {
        self.money = (self.money + amount).min(super::weapon::MAX_MONEY);
    }

    pub fn spend_money(&mut self, amount: u32) -> bool {
        if self.money < amount {
            return false;
        }
        self.money -= amount;
        true
    }

    pub fn set_rtt(&mut self, ms: u32) {
        self.rtt_ms = ms;
    }

    /// 输入序号单调校验：乱序/重复帧丢弃（NET-006）。
    pub fn set_input(&mut self, frame: InputFrame) {
        if frame.seq > self.last_seq {
            self.last_seq = frame.seq;
            self.pending_input = Some(frame);
        }
    }

    pub fn take_input(&mut self) -> Option<InputFrame> {
        self.pending_input.take()
    }

    /// 应用视角与下蹲（冻结阶段也可转身）。
    pub fn apply_view(&mut self, input: &InputFrame) {
        self.yaw = normalize_deg(self.yaw + input.yaw_delta as f32 / 100.0);
        self.pitch = clamp(
            self.pitch + input.pitch_delta as f32 / 100.0,
            -MAX_PITCH_DEG,
            MAX_PITCH_DEG,
        );
        self.crouching = input.buttons & BTN_CROUCH != 0;
    }

    /// 一步权威移动。视角已应用，此处仅处理速度/位移/跳跃/重力/碰撞。
    pub fn apply_movement(&mut self, input: &InputFrame, dt: f32, collision: &Collision) {
        let height = if self.crouching { CROUCH_HEIGHT } else { STAND_HEIGHT };

        let forward = input.forward_axis as f32 / 127.0;
        let strafe = input.strafe_axis as f32 / 127.0;
        let sprint = input.buttons & BTN_SPRINT != 0 && !self.crouching;
        let max_speed = if self.crouching {
            CROUCH_SPEED
        } else if sprint {
            SPRINT_SPEED
        } else {
            WALK_SPEED
        };
        let yaw_rad = self.yaw.to_radians();

        // 前向/右向量与第一人称相机一致：yaw=0 → -Z，右 = +X
        let want_x = (-forward * yaw_rad.sin() + strafe * yaw_rad.cos()) * max_speed;
        let want_z = (-forward * yaw_rad.cos() - strafe * yaw_rad.sin()) * max_speed;
        let has_move = forward * forward + strafe * strafe > 0.01;
        let accel = if has_move { ACCEL } else { FRICTION };

        self.vel[0] = approach(self.vel[0], want_x, accel * dt);
        self.vel[2] = approach(self.vel[2], want_z, accel * dt);
        self.move_speed = (self.vel[0] * self.vel[0] + self.vel[2] * self.vel[2]).sqrt();

        if input.buttons & BTN_JUMP != 0 && self.on_ground {
            self.vel[1] = JUMP_VEL;
            self.on_ground = false;
        }
        self.vel[1] -= GRAVITY * dt;

        self.on_ground = collision.step(&mut self.pos, &mut self.vel, dt, HALF_W, height);
    }

    /// 无输入 tick 仅施加重力与摩擦。
    pub fn apply_gravity(&mut self, dt: f32, collision: &Collision) {
        self.move_speed = 0.0;
        self.vel[1] -= GRAVITY * dt;
        self.vel[0] = approach(self.vel[0], 0.0, FRICTION * dt);
        self.vel[2] = approach(self.vel[2], 0.0, FRICTION * dt);
        let height = if self.crouching { CROUCH_HEIGHT } else { STAND_HEIGHT };
        self.on_ground = collision.step(&mut self.pos, &mut self.vel, dt, HALF_W, height);
    }

    // ---------- 武器状态 ----------

    pub fn weapon_spec(&self) -> WeaponSpec {
        get_weapon(self.weapon_id)
    }

    /// 消耗一发弹药并设定下一次开火 tick（由世界按武器射速计算间隔）。
    pub fn consume_fire(&mut self, tick: u64, interval_ticks: u64) {
        self.ammo = self.ammo.saturating_sub(1);
        self.next_fire_tick = tick + interval_ticks.max(1);
    }

    pub fn tick_reload(&mut self) {
        if !self.reloading {
            return;
        }
        if self.reload_remaining_ticks > 0 {
            self.reload_remaining_ticks -= 1;
            if self.reload_remaining_ticks == 0 {
                let spec = self.weapon_spec();
                self.ammo = spec.mag_size;
                self.reloading = false;
            }
        }
    }

    pub fn start_reload(&mut self, reload_ticks: u32) {
        self.reloading = true;
        self.reload_remaining_ticks = reload_ticks.max(1);
    }

    pub fn snapshot_entity(&self) -> SnapshotEntity {
        let flags =
            if self.move_speed > 0.1 { 1 } else { 0 } | if self.crouching { 2 } else { 0 };
        SnapshotEntity {
            id: self.id,
            flags,
            x: (self.pos[0] * 100.0) as i16,
            y: (self.pos[1] * 100.0) as i16,
            z: (self.pos[2] * 100.0) as i16,
            yaw: (self.yaw * 100.0) as i16,
            pitch: (self.pitch * 100.0) as i16,
            health: self.health,
            team: self.team,
        }
    }
}

fn approach(current: f32, target: f32, max_delta: f32) -> f32 {
    let d = target - current;
    if d.abs() <= max_delta {
        target
    } else {
        current + d.signum() * max_delta
    }
}

fn normalize_deg(v: f32) -> f32 {
    let mut v = v;
    while v > 180.0 {
        v -= 360.0;
    }
    while v < -180.0 {
        v += 360.0;
    }
    v
}

fn clamp(v: f32, min: f32, max: f32) -> f32 {
    v.max(min).min(max)
}
