//! 玩家实体：移动状态机 + 战斗状态（队伍/存活/武器/经济）。
//! 服务器权威计算速度/位移，客户端输入仅提供按钮与视角增量。

use super::map::Collision;
use super::weapon::{get_weapon, WeaponSpec};
use crate::protocol::{
    InputFrame, SnapshotEntity, BTN_CROUCH, BTN_EQUIP_FIREARM, BTN_EQUIP_KNIFE,
    BTN_EQUIP_SECONDARY, BTN_JUMP, BTN_SPRINT,
};

const GRAVITY: f32 = 18.0;
const STAND_HEIGHT: f32 = 1.8;
const CROUCH_HEIGHT: f32 = 1.35;
const HALF_W: f32 = 0.32;
const WALK_SPEED: f32 = 3.8;
const SPRINT_SPEED: f32 = 5.4;
const CROUCH_SPEED: f32 = 1.6;
const GROUND_ACCEL: f32 = 30.0;
const AIR_ACCEL: f32 = 8.0;
const FRICTION: f32 = 22.0;
const JUMP_VEL: f32 = 5.4;
const MAX_PITCH_DEG: f32 = 89.0;
const CROUCH_TRANSITION_SECS: f32 = 0.22;
const RECOVERY_DELAY_SECS: f32 = 0.18;
const RECOVERY_RATE: f32 = 8.0;

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
    /// 当前碰撞高度（下蹲过渡用，1.35..1.8）。
    pub height: f32,
    /// 玩家请求的下蹲目标（由 tick_stance 平滑过渡）。
    crouch_requested: bool,
    pub sprinting: bool,
    pub health: i16,
    pub team: u8, // 1=attack 2=defend（分配后固定，换边时翻转）
    pub alive: bool,
    pub armor: u32,
    pub weapon_id: u32,
    pub firearm_weapon_id: u32,
    pub secondary_weapon_id: u32,
    pub ammo: u32,
    firearm_ammo: u32,
    secondary_ammo: u32,
    pub reloading: bool,
    pub kills: u32,
    pub deaths: u32,
    pub money: u32,
    /// 投掷物库存 [烟雾, 闪光, 高爆]。
    pub grenades: [u32; 3],
    pub rtt_ms: u32,
    /// 上一个通过合理性校验的 RTT（防客户端突变伪造）。
    pub last_trusted_rtt: u32,
    move_speed: f32,
    reload_remaining_ticks: u32,
    pub next_fire_tick: u64,
    recoil_shot_index: u32,
    recoil_accumulated_pitch: f32,
    recoil_accumulated_yaw: f32,
    ticks_since_fire: u32,
    pub charge_ticks: u32,
    pub weapon_refund: Option<(u32, u32)>,
    pending_input: Option<InputFrame>,
    active_input: Option<InputFrame>,
    input_silence_ticks: u32,
    last_seq: u32,
    last_buttons: u16,
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
            height: STAND_HEIGHT,
            crouch_requested: false,
            sprinting: false,
            health: 100,
            team: 0,
            alive: true,
            armor: 0,
            weapon_id: weapon.id,
            firearm_weapon_id: weapon.id,
            secondary_weapon_id: weapon.id,
            ammo: weapon.mag_size,
            firearm_ammo: weapon.mag_size,
            secondary_ammo: weapon.mag_size,
            reloading: false,
            kills: 0,
            deaths: 0,
            money: super::weapon::START_MONEY,
            grenades: [0; 3],
            rtt_ms: 0,
            last_trusted_rtt: 0,
            move_speed: 0.0,
            reload_remaining_ticks: 0,
            next_fire_tick: 0,
            recoil_shot_index: 0,
            recoil_accumulated_pitch: 0.0,
            recoil_accumulated_yaw: 0.0,
            ticks_since_fire: 0,
            charge_ticks: 0,
            weapon_refund: None,
            pending_input: None,
            active_input: None,
            input_silence_ticks: 0,
            last_seq: 0,
            last_buttons: 0,
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
        self.height = STAND_HEIGHT;
        self.crouch_requested = false;
        self.sprinting = false;
        self.health = 100;
        self.alive = true;
        self.armor = 0;
        self.grenades = [0; 3];
        self.secondary_weapon_id = super::weapon::WEAPON_P9;
        self.secondary_ammo = get_weapon(super::weapon::WEAPON_P9).mag_size;
        self.set_primary(super::weapon::WEAPON_P9);
        self.reloading = false;
        self.reload_remaining_ticks = 0;
        self.next_fire_tick = 0;
        self.recoil_shot_index = 0;
        self.recoil_accumulated_pitch = 0.0;
        self.recoil_accumulated_yaw = 0.0;
        self.ticks_since_fire = 0;
        self.charge_ticks = 0;
        self.weapon_refund = None;
        self.last_buttons = 0;
        self.pending_input = None;
        self.active_input = None;
        self.input_silence_ticks = 0;
    }

    /// 更换主武器并补满弹药。
    pub fn set_primary(&mut self, weapon_id: u32) {
        if self.weapon_id == self.secondary_weapon_id {
            self.secondary_ammo = self.ammo;
        } else {
            self.store_active_ammo();
        }
        let spec = get_weapon(weapon_id);
        self.firearm_weapon_id = spec.id;
        self.firearm_ammo = spec.mag_size;
        self.weapon_id = spec.id;
        self.ammo = self.firearm_ammo;
        self.reloading = false;
        self.reload_remaining_ticks = 0;
        self.next_fire_tick = 0;
        self.recoil_shot_index = 0;
        self.recoil_accumulated_pitch = 0.0;
        self.recoil_accumulated_yaw = 0.0;
        self.ticks_since_fire = 0;
        self.charge_ticks = 0;
    }

    pub fn apply_weapon_switch(&mut self, pressed: u16) {
        if pressed & BTN_EQUIP_KNIFE != 0 {
            self.store_active_ammo();
            self.weapon_id = super::weapon::WEAPON_KNIFE;
            self.reloading = false;
            self.reload_remaining_ticks = 0;
            self.recoil_accumulated_pitch = 0.0;
            self.recoil_accumulated_yaw = 0.0;
            self.ticks_since_fire = 0;
            self.charge_ticks = 0;
        } else if pressed & BTN_EQUIP_SECONDARY != 0 {
            self.switch_to_secondary();
        } else if pressed & BTN_EQUIP_FIREARM != 0 {
            self.switch_to_primary();
        }
    }

    pub fn switch_to_primary(&mut self) {
        self.store_active_ammo();
        self.weapon_id = self.firearm_weapon_id;
        self.ammo = self.firearm_ammo;
        self.reloading = false;
        self.reload_remaining_ticks = 0;
        self.next_fire_tick = 0;
        self.recoil_shot_index = 0;
        self.recoil_accumulated_pitch = 0.0;
        self.recoil_accumulated_yaw = 0.0;
        self.ticks_since_fire = 0;
        self.charge_ticks = 0;
    }

    pub fn switch_to_secondary(&mut self) {
        self.store_active_ammo();
        self.weapon_id = self.secondary_weapon_id;
        self.ammo = self.secondary_ammo;
        self.reloading = false;
        self.reload_remaining_ticks = 0;
        self.next_fire_tick = 0;
        self.recoil_shot_index = 0;
        self.recoil_accumulated_pitch = 0.0;
        self.recoil_accumulated_yaw = 0.0;
        self.ticks_since_fire = 0;
        self.charge_ticks = 0;
    }

    fn store_active_ammo(&mut self) {
        if self.weapon_id == self.firearm_weapon_id {
            self.firearm_ammo = self.ammo;
        } else if self.weapon_id == self.secondary_weapon_id {
            self.secondary_ammo = self.ammo;
        }
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

    /// Reuse movement buttons between network frames, but apply view deltas and button edges once.
    pub fn input_for_tick(&mut self, timeout_ticks: u32) -> (Option<InputFrame>, u16) {
        let mut pressed = 0;
        let mut fresh = false;
        if let Some(frame) = self.pending_input.take() {
            pressed = self.button_edges(frame.buttons);
            self.active_input = Some(frame);
            self.input_silence_ticks = 0;
            fresh = true;
        } else {
            self.input_silence_ticks = self.input_silence_ticks.saturating_add(1);
        }

        if self.input_silence_ticks > timeout_ticks {
            if self.last_buttons != 0 {
                self.button_edges(0);
            }
            if let Some(input) = self.active_input.as_mut() {
                input.buttons = 0;
                input.forward_axis = 0;
                input.strafe_axis = 0;
            }
        }

        let mut input = self.active_input;
        if !fresh {
            if let Some(frame) = input.as_mut() {
                frame.yaw_delta = 0;
                frame.pitch_delta = 0;
            }
        }
        (input, pressed)
    }

    pub fn button_edges(&mut self, buttons: u16) -> u16 {
        let pressed = buttons & !self.last_buttons;
        self.last_buttons = buttons;
        pressed
    }

    /// 应用视角与下蹲（冻结阶段也可转身）。
    pub fn apply_view(&mut self, input: &InputFrame) {
        let yaw_input = input.yaw_delta as f32 / 100.0;
        let pitch_input = input.pitch_delta as f32 / 100.0;
        // 手动压枪先抵消后坐力“欠账”，剩余部分才自动回复，避免双重补偿。
        if pitch_input < 0.0 && self.recoil_accumulated_pitch > 0.0 {
            self.recoil_accumulated_pitch = (self.recoil_accumulated_pitch + pitch_input).max(0.0);
        }
        if (yaw_input < 0.0 && self.recoil_accumulated_yaw > 0.0)
            || (yaw_input > 0.0 && self.recoil_accumulated_yaw < 0.0)
        {
            self.recoil_accumulated_yaw = if self.recoil_accumulated_yaw > 0.0 {
                (self.recoil_accumulated_yaw + yaw_input).max(0.0)
            } else {
                (self.recoil_accumulated_yaw + yaw_input).min(0.0)
            };
        }
        self.yaw = normalize_deg(self.yaw + input.yaw_delta as f32 / 100.0);
        self.pitch = clamp(
            self.pitch + input.pitch_delta as f32 / 100.0,
            -MAX_PITCH_DEG,
            MAX_PITCH_DEG,
        );
        self.crouch_requested = input.buttons & BTN_CROUCH != 0;
    }

    /// 一步权威移动。视角已应用，此处仅处理速度/位移/跳跃/重力/碰撞。
    pub fn apply_movement(
        &mut self,
        input: &InputFrame,
        pressed: u16,
        dt: f32,
        collision: &Collision,
    ) {
        let height = self.height;
        let mut forward = input.forward_axis as f32 / 127.0;
        let mut strafe = input.strafe_axis as f32 / 127.0;
        let input_length = (forward * forward + strafe * strafe).sqrt();
        if input_length > 1.0 {
            forward /= input_length;
            strafe /= input_length;
        }
        let sprint = input.buttons & BTN_SPRINT != 0 && forward > 0.1 && !self.crouching;
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
        let accel = if has_move {
            if self.on_ground {
                GROUND_ACCEL
            } else {
                AIR_ACCEL
            }
        } else {
            FRICTION
        };

        (self.vel[0], self.vel[2]) =
            move_toward_2d(self.vel[0], self.vel[2], want_x, want_z, accel * dt);
        self.move_speed = (self.vel[0] * self.vel[0] + self.vel[2] * self.vel[2]).sqrt();
        self.sprinting = sprint && self.move_speed > WALK_SPEED * 0.85;

        if pressed & BTN_JUMP != 0 && self.on_ground {
            self.vel[1] = JUMP_VEL;
            self.on_ground = false;
        }
        self.vel[1] -= GRAVITY * dt;

        self.on_ground = collision.step(&mut self.pos, &mut self.vel, dt, HALF_W, height);
    }

    /// 无输入 tick 仅施加重力与摩擦。
    pub fn apply_gravity(&mut self, dt: f32, collision: &Collision) {
        self.sprinting = false;
        self.vel[1] -= GRAVITY * dt;
        (self.vel[0], self.vel[2]) =
            move_toward_2d(self.vel[0], self.vel[2], 0.0, 0.0, FRICTION * dt);
        self.move_speed = (self.vel[0] * self.vel[0] + self.vel[2] * self.vel[2]).sqrt();
        let height = self.height;
        self.on_ground = collision.step(&mut self.pos, &mut self.vel, dt, HALF_W, height);
    }

    /// 下蹲过渡：0.22s 内平滑切换碰撞高度；crouching 表示实际姿态阈值。
    pub fn tick_stance(&mut self, dt: f32) {
        let target = if self.crouch_requested {
            CROUCH_HEIGHT
        } else {
            STAND_HEIGHT
        };
        let rate = (STAND_HEIGHT - CROUCH_HEIGHT) / CROUCH_TRANSITION_SECS;
        let max_delta = rate * dt;
        let delta = (target - self.height).clamp(-max_delta, max_delta);
        self.height = (self.height + delta).clamp(CROUCH_HEIGHT, STAND_HEIGHT);
        self.crouching = self.height < (STAND_HEIGHT + CROUCH_HEIGHT) * 0.5;
    }

    /// 后坐力回复：停火 0.18s 后按指数衰减回到开火前视角。
    pub fn tick_recoil_recovery(&mut self, dt: f32, tick_rate: u32) {
        self.ticks_since_fire = self.ticks_since_fire.saturating_add(1);
        let delay_ticks = (RECOVERY_DELAY_SECS * tick_rate as f32).max(1.0) as u32;
        if self.ticks_since_fire < delay_ticks {
            return;
        }
        let decay = 1.0 - (-dt * RECOVERY_RATE).exp();
        let dp = self.recoil_accumulated_pitch * decay;
        let dy = self.recoil_accumulated_yaw * decay;
        self.pitch = clamp(self.pitch - dp, -MAX_PITCH_DEG, MAX_PITCH_DEG);
        self.yaw = normalize_deg(self.yaw - dy);
        self.recoil_accumulated_pitch -= dp;
        self.recoil_accumulated_yaw -= dy;
    }

    // ---------- 武器状态 ----------

    pub fn weapon_spec(&self) -> WeaponSpec {
        get_weapon(self.weapon_id)
    }

    /// 消耗一发弹药并设定下一次开火 tick（由世界按武器射速计算间隔）。
    pub fn record_fire(&mut self, tick: u64, interval_ticks: u64, consume_ammo: bool) {
        if consume_ammo {
            self.ammo = self.ammo.saturating_sub(1);
            self.store_active_ammo();
        }
        let (pitch, yaw) = recoil_for_weapon(self.weapon_id, self.recoil_shot_index);
        self.pitch = clamp(self.pitch + pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG);
        self.yaw = normalize_deg(self.yaw + yaw);
        self.recoil_accumulated_pitch += pitch;
        self.recoil_accumulated_yaw += yaw;
        self.ticks_since_fire = 0;
        self.recoil_shot_index = self.recoil_shot_index.wrapping_add(1);
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
                self.store_active_ammo();
                self.reloading = false;
                self.recoil_shot_index = 0;
                self.recoil_accumulated_pitch = 0.0;
                self.recoil_accumulated_yaw = 0.0;
                self.ticks_since_fire = 0;
            }
        }
    }

    pub fn start_reload(&mut self, reload_ticks: u32) {
        self.reloading = true;
        self.reload_remaining_ticks = reload_ticks.max(1);
    }

    pub fn snapshot_entity(&self) -> SnapshotEntity {
        let flags = if self.move_speed > 0.1 { 1 } else { 0 }
            | if self.crouching { 2 } else { 0 }
            | if self.reloading { 4 } else { 0 }
            | if self.sprinting { 8 } else { 0 };
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
            weapon_id: self.weapon_id as u8,
            ammo: self.ammo.min(u8::MAX as u32) as u8,
        }
    }
}

fn recoil_for_weapon(weapon_id: u32, shot_index: u32) -> (f32, f32) {
    let n = (shot_index % 6) as usize;
    match weapon_id {
        super::weapon::WEAPON_R1 => (
            [1.15, 1.25, 1.35, 1.45, 1.55, 1.65][n],
            [0.2, -0.28, 0.32, -0.2, 0.26, -0.15][n],
        ),
        super::weapon::WEAPON_S4 => (
            [0.72, 0.79, 0.86, 0.93, 1.0, 1.07][n],
            [0.38, -0.48, 0.54, -0.42, 0.5, -0.34][n],
        ),
        super::weapon::WEAPON_M1 => (3.4, if n.is_multiple_of(2) { 0.16 } else { -0.16 }),
        super::weapon::WEAPON_P9 => (1.05, if n.is_multiple_of(2) { 0.2 } else { -0.2 }),
        super::weapon::WEAPON_M4_PINK => (
            [1.25, 1.36, 1.47, 1.58, 1.69, 1.8][n],
            [0.22, -0.3, 0.34, -0.23, 0.28, -0.18][n],
        ),
        super::weapon::WEAPON_LASER_CANNON => {
            (2.25, if n.is_multiple_of(2) { 0.24 } else { -0.24 })
        }
        super::weapon::WEAPON_GATLING => (
            [0.45, 0.5, 0.55, 0.6, 0.65, 0.7][n],
            [0.15, -0.18, 0.2, -0.15, 0.18, -0.12][n],
        ),
        _ => (0.0, 0.0),
    }
}

fn move_toward_2d(
    current_x: f32,
    current_z: f32,
    target_x: f32,
    target_z: f32,
    max_delta: f32,
) -> (f32, f32) {
    let dx = target_x - current_x;
    let dz = target_z - current_z;
    let distance = (dx * dx + dz * dz).sqrt();
    if distance <= max_delta || distance == 0.0 {
        return (target_x, target_z);
    }
    let scale = max_delta / distance;
    (current_x + dx * scale, current_z + dz * scale)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn input(seq: u32, buttons: u16, forward: i8, strafe: i8) -> InputFrame {
        InputFrame {
            seq,
            buttons,
            yaw_delta: 25,
            pitch_delta: -10,
            forward_axis: forward,
            strafe_axis: strafe,
            client_sent_at_ms: 0,
        }
    }

    #[test]
    fn diagonal_input_never_exceeds_walk_speed() {
        let collision = Collision::default();
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        let frame = input(1, 0, 127, 127);
        for _ in 0..32 {
            player.apply_movement(&frame, 0, 1.0 / 64.0, &collision);
        }
        let speed = (player.vel[0] * player.vel[0] + player.vel[2] * player.vel[2]).sqrt();
        assert!(speed <= WALK_SPEED + 0.001, "diagonal speed was {speed}");
    }

    #[test]
    fn held_jump_does_not_auto_repeat_after_landing() {
        let collision = Collision::default();
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        let frame = input(1, BTN_JUMP, 0, 0);
        player.apply_movement(&frame, BTN_JUMP, 1.0 / 64.0, &collision);
        for _ in 0..96 {
            player.apply_movement(&frame, 0, 1.0 / 64.0, &collision);
        }
        assert!(player.on_ground);
        assert_eq!(player.pos[1], 0.0);
        assert_eq!(player.vel[1], 0.0);
    }

    #[test]
    fn active_input_is_reused_then_cleared_after_timeout() {
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        player.set_input(input(1, BTN_SPRINT, 127, 0));

        let (first, _) = player.input_for_tick(2);
        let first = first.unwrap();
        assert_eq!(first.forward_axis, 127);
        assert_eq!(first.yaw_delta, 25);

        let (reused, _) = player.input_for_tick(2);
        let reused = reused.unwrap();
        assert_eq!(reused.forward_axis, 127);
        assert_eq!(reused.yaw_delta, 0);

        player.input_for_tick(2);
        let (timed_out, _) = player.input_for_tick(2);
        let timed_out = timed_out.unwrap();
        assert_eq!(timed_out.forward_axis, 0);
        assert_eq!(timed_out.buttons, 0);
    }

    #[test]
    fn knife_switch_preserves_firearm_and_ammo() {
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        player.set_primary(super::super::weapon::WEAPON_R1);
        player.ammo = 7;

        player.apply_weapon_switch(BTN_EQUIP_KNIFE);
        assert_eq!(player.weapon_id, super::super::weapon::WEAPON_KNIFE);
        assert_eq!(player.ammo, 7);

        player.apply_weapon_switch(BTN_EQUIP_FIREARM);
        assert_eq!(player.weapon_id, super::super::weapon::WEAPON_R1);
        assert_eq!(player.ammo, 7);
    }

    #[test]
    fn secondary_switch_preserves_primary_and_pistol_ammo() {
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        player.set_primary(super::super::weapon::WEAPON_R1);
        player.ammo = 6;

        player.apply_weapon_switch(BTN_EQUIP_SECONDARY);
        assert_eq!(player.weapon_id, super::super::weapon::WEAPON_P9);
        assert_eq!(player.ammo, 12);

        player.ammo = 9;
        player.apply_weapon_switch(BTN_EQUIP_FIREARM);
        assert_eq!(player.weapon_id, super::super::weapon::WEAPON_R1);
        assert_eq!(player.ammo, 6);

        player.apply_weapon_switch(BTN_EQUIP_SECONDARY);
        assert_eq!(player.weapon_id, super::super::weapon::WEAPON_P9);
        assert_eq!(player.ammo, 9);
    }

    #[test]
    fn recoil_recovers_after_fire_stops() {
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        player.weapon_id = super::super::weapon::WEAPON_P9;
        player.record_fire(0, 10, true);
        let pitch_after = player.pitch;
        assert!(pitch_after > 0.0);

        for _ in 0..96 {
            player.tick_recoil_recovery(1.0 / 64.0, 64);
        }
        assert!(
            player.pitch < pitch_after * 0.3,
            "后坐力未回复: pitch={} after={}",
            player.pitch,
            pitch_after
        );
    }

    #[test]
    fn crouch_transition_smooths_height() {
        let mut player = Player::new(1, "player".into(), [0.0, 0.0, 0.0]);
        assert_eq!(player.height, STAND_HEIGHT);

        player.crouch_requested = true;
        player.tick_stance(1.0 / 64.0);
        assert!(player.height < STAND_HEIGHT && player.height > CROUCH_HEIGHT);

        for _ in 0..64 {
            player.tick_stance(1.0 / 64.0);
        }
        assert!((player.height - CROUCH_HEIGHT).abs() < 0.001);
    }
}
