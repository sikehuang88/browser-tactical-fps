//! 玩家实体：移动状态机。服务器权威计算速度/位移，客户端输入仅提供按钮与视角增量。

use super::map::Collision;
use crate::protocol::{
    InputFrame, SnapshotEntity, BTN_CROUCH, BTN_JUMP, BTN_SPRINT,
};

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
    move_speed: f32,
    pending_input: Option<InputFrame>,
    last_seq: u32,
}

impl Player {
    pub fn new(id: u32, name: String, spawn: [f32; 3]) -> Self {
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
            move_speed: 0.0,
            pending_input: None,
            last_seq: 0,
        }
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

    /// 一步权威移动。输入可能为 None（该 tick 无输入，仅施加重力保持权威）。
    pub fn step(&mut self, dt: f32, collision: &Collision, input: Option<InputFrame>) {
        if let Some(input) = input {
            self.apply_movement(&input, dt, collision);
        } else {
            self.apply_gravity(dt, collision);
        }
    }

    pub fn snapshot_entity(&self) -> SnapshotEntity {
        let flags = if self.move_speed > 0.1 { 1 } else { 0 } | if self.crouching { 2 } else { 0 };
        SnapshotEntity {
            id: self.id,
            flags,
            x: (self.pos[0] * 100.0) as i16,
            y: (self.pos[1] * 100.0) as i16,
            z: (self.pos[2] * 100.0) as i16,
            yaw: (self.yaw * 100.0) as i16,
            pitch: (self.pitch * 100.0) as i16,
            health: self.health,
        }
    }

    fn apply_movement(&mut self, input: &InputFrame, dt: f32, collision: &Collision) {
        self.yaw = normalize_deg(self.yaw + input.yaw_delta as f32 / 100.0);
        self.pitch = clamp(self.pitch + input.pitch_delta as f32 / 100.0, -MAX_PITCH_DEG, MAX_PITCH_DEG);

        self.crouching = input.buttons & BTN_CROUCH != 0;
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

        let want_x = (forward * yaw_rad.sin() + strafe * yaw_rad.cos()) * max_speed;
        let want_z = (forward * yaw_rad.cos() - strafe * yaw_rad.sin()) * max_speed;
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

    fn apply_gravity(&mut self, dt: f32, collision: &Collision) {
        self.move_speed = 0.0;
        self.vel[1] -= GRAVITY * dt;
        // 无输入时水平速度逐渐衰减
        self.vel[0] = approach(self.vel[0], 0.0, FRICTION * dt);
        self.vel[2] = approach(self.vel[2], 0.0, FRICTION * dt);
        let height = if self.crouching { CROUCH_HEIGHT } else { STAND_HEIGHT };
        self.on_ground = collision.step(&mut self.pos, &mut self.vel, dt, HALF_W, height);
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
