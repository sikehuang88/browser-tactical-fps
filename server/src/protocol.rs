//! 协议常量、信封编解码与消息结构体。与 client/src/core/net/codec.ts 同规格。
//! 线格式见 proto/README.md「M0 引导线格式」。
//! 完整编解码是双向规格，当前里程碑只消费其中一部分，未用到的函数/常量后续里程碑启用。
#![allow(dead_code)]

pub const MAGIC: u8 = 0xF5;
pub const PROTOCOL_VERSION: u8 = 0x02;

pub const MSG_HELLO: u8 = 0x01;
pub const MSG_WELCOME: u8 = 0x02;
pub const MSG_INPUT_FRAME: u8 = 0x03;
pub const MSG_SNAPSHOT: u8 = 0x04;
pub const MSG_PING: u8 = 0x05;
pub const MSG_PONG: u8 = 0x06;
pub const MSG_KICK: u8 = 0x07;
pub const MSG_ROUND_STATE: u8 = 0x08;
pub const MSG_KILL_FEED: u8 = 0x09;
pub const MSG_MATCH_END: u8 = 0x0A;
pub const MSG_DAMAGE: u8 = 0x0B;
pub const MSG_BUY: u8 = 0x0C;
pub const MSG_ECONOMY: u8 = 0x0D;
pub const MSG_GRENADE_SPAWN: u8 = 0x0E;
pub const MSG_GRENADE_EXPLODE: u8 = 0x0F;
pub const MSG_FLASH: u8 = 0x10;

// 队伍
pub const TEAM_ATTACK: u8 = 1;
pub const TEAM_DEFEND: u8 = 2;

// 回合阶段
pub const PHASE_IDLE: u8 = 0;
pub const PHASE_FREEZE: u8 = 1;
pub const PHASE_ACTIVE: u8 = 2;
pub const PHASE_ROUND_END: u8 = 3;
pub const PHASE_MATCH_END: u8 = 4;

// 炸弹状态
pub const BOMB_NONE: u8 = 0;
pub const BOMB_PLANTING: u8 = 1;
pub const BOMB_PLANTED: u8 = 2;
pub const BOMB_DEFUSING: u8 = 3;
pub const BOMB_EXPLODED: u8 = 4;
pub const BOMB_DEFUSED: u8 = 5;

// 获胜方
pub const WINNER_NONE: u8 = 0;
pub const WINNER_ATTACK: u8 = 1;
pub const WINNER_DEFEND: u8 = 2;

const FLAG_RELIABLE: u8 = 1 << 0;

/// 输入按钮位标记。
pub const BTN_FORWARD: u16 = 1 << 0;
pub const BTN_BACK: u16 = 1 << 1;
pub const BTN_LEFT: u16 = 1 << 2;
pub const BTN_RIGHT: u16 = 1 << 3;
pub const BTN_JUMP: u16 = 1 << 4;
pub const BTN_CROUCH: u16 = 1 << 5;
pub const BTN_SPRINT: u16 = 1 << 6;
pub const BTN_ATTACK: u16 = 1 << 7;
pub const BTN_USE: u16 = 1 << 8;
pub const BTN_RELOAD: u16 = 1 << 9;
pub const BTN_THROW_SMOKE: u16 = 1 << 10;
pub const BTN_THROW_FLASH: u16 = 1 << 11;
pub const BTN_THROW_HE: u16 = 1 << 12;
pub const BTN_EQUIP_FIREARM: u16 = 1 << 13;
pub const BTN_EQUIP_KNIFE: u16 = 1 << 14;
pub const BTN_EQUIP_SECONDARY: u16 = 1 << 15;

// 投掷物类型
pub const GRENADE_SMOKE: u8 = 1;
pub const GRENADE_FLASH: u8 = 2;
pub const GRENADE_HE: u8 = 3;

/// 踢出原因（与 KickReason 枚举对应）。
pub const KICK_VERSION_MISMATCH: u8 = 0;
pub const KICK_SERVER_FULL: u8 = 1;
pub const KICK_PROTOCOL_ERROR: u8 = 2;
pub const KICK_BANNED: u8 = 3;

#[derive(Debug, Clone)]
pub struct Envelope {
    pub msg_type: u8,
    pub seq: u32,
    pub payload: Vec<u8>,
}

/// 客户端输入帧（服务端权威消费）。
#[derive(Debug, Clone, Copy)]
pub struct InputFrame {
    pub seq: u32,
    pub buttons: u16,
    pub yaw_delta: i16,
    pub pitch_delta: i16,
    pub forward_axis: i8,
    pub strafe_axis: i8,
    pub client_sent_at_ms: u32,
}

/// 快照中的单个实体（已量化）。
pub struct SnapshotEntity {
    pub id: u32,
    pub flags: u8,
    pub x: i16,
    pub y: i16,
    pub z: i16,
    pub yaw: i16,
    pub pitch: i16,
    pub health: i16,
    pub team: u8,
    pub weapon_id: u8,
    pub ammo: u8,
}

// ---------- 信封 ----------

pub fn encode_envelope(msg_type: u8, seq: u32, payload: &[u8], reliable: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(10 + payload.len());
    out.push(MAGIC);
    out.push(PROTOCOL_VERSION);
    out.push(if reliable { FLAG_RELIABLE } else { 0 });
    out.push(msg_type);
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

pub fn parse_envelope(data: &[u8]) -> Result<Envelope, String> {
    if data.len() < 10 {
        return Err("信封过短".into());
    }
    if data[0] != MAGIC {
        return Err("协议魔数错误".into());
    }
    let ver = data[1];
    if ver != PROTOCOL_VERSION {
        return Err(format!("协议版本不兼容: {ver}"));
    }
    let msg_type = data[3];
    let seq = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
    let len = u16::from_be_bytes([data[8], data[9]]) as usize;
    if 10 + len > data.len() {
        return Err("负载长度越界".into());
    }
    Ok(Envelope {
        msg_type,
        seq,
        payload: data[10..10 + len].to_vec(),
    })
}

// ---------- Hello / Welcome ----------

pub fn encode_hello(version: (u8, u8, u8), name: &str) -> Vec<u8> {
    let bytes = name.as_bytes();
    let n = bytes.len().min(32);
    let mut out = Vec::with_capacity(4 + n);
    out.push(version.0);
    out.push(version.1);
    out.push(version.2);
    out.push(n as u8);
    out.extend_from_slice(&bytes[..n]);
    out
}

pub fn decode_hello(payload: &[u8]) -> Result<(u8, u8, u8, String), String> {
    if payload.len() < 4 {
        return Err("Hello 负载过短".into());
    }
    let major = payload[0];
    let minor = payload[1];
    let patch = payload[2];
    let n = payload[3] as usize;
    if 4 + n > payload.len() {
        return Err("Hello 名称长度越界".into());
    }
    let name = String::from_utf8_lossy(&payload[4..4 + n]).into_owned();
    Ok((major, minor, patch, name))
}

pub fn encode_welcome(player_id: u32, tick_rate: u16, server_rtt_ms: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(10);
    out.extend_from_slice(&player_id.to_be_bytes());
    out.extend_from_slice(&tick_rate.to_be_bytes());
    out.extend_from_slice(&server_rtt_ms.to_be_bytes());
    out
}

// ---------- InputFrame ----------

pub fn decode_input_frame(p: &[u8]) -> Result<InputFrame, String> {
    if p.len() < 16 {
        return Err("输入帧负载过短".into());
    }
    let u32_at = |i: usize| u32::from_be_bytes([p[i], p[i + 1], p[i + 2], p[i + 3]]);
    let i16_at = |i: usize| i16::from_be_bytes([p[i], p[i + 1]]);
    Ok(InputFrame {
        seq: u32_at(0),
        buttons: u16::from_be_bytes([p[4], p[5]]),
        yaw_delta: i16_at(6),
        pitch_delta: i16_at(8),
        forward_axis: p[10] as i8,
        strafe_axis: p[11] as i8,
        client_sent_at_ms: u32_at(12),
    })
}

// ---------- Snapshot ----------

pub fn encode_snapshot(tick: u32, entities: &[SnapshotEntity]) -> Vec<u8> {
    let mut out = Vec::with_capacity(5 + entities.len() * 20);
    out.extend_from_slice(&tick.to_be_bytes());
    out.push(entities.len().min(255) as u8);
    for e in entities {
        out.extend_from_slice(&e.id.to_be_bytes());
        out.push(e.flags);
        out.extend_from_slice(&e.x.to_be_bytes());
        out.extend_from_slice(&e.y.to_be_bytes());
        out.extend_from_slice(&e.z.to_be_bytes());
        out.extend_from_slice(&e.yaw.to_be_bytes());
        out.extend_from_slice(&e.pitch.to_be_bytes());
        out.extend_from_slice(&e.health.to_be_bytes());
        out.push(e.team);
        out.push(e.weapon_id);
        out.push(e.ammo);
    }
    out
}

// ---------- Ping / Pong / Kick ----------

pub fn decode_ping(payload: &[u8]) -> (u32, u32) {
    if payload.len() < 4 {
        return (0, 0);
    }
    let sent = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
    let measured_rtt = if payload.len() >= 8 {
        u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]])
    } else {
        0
    };
    (sent, measured_rtt)
}

pub fn encode_pong(client_sent_at_ms: u32, server_recv_at_ms: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(8);
    out.extend_from_slice(&client_sent_at_ms.to_be_bytes());
    out.extend_from_slice(&server_recv_at_ms.to_be_bytes());
    out
}

pub fn encode_kick(reason: u8, detail: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + detail.len());
    out.push(reason);
    out.extend_from_slice(detail.as_bytes());
    out
}

// ---------- RoundState / KillFeed / MatchEnd / Damage ----------

#[derive(Clone, Copy, Debug)]
pub struct RoundStateMsg {
    pub phase: u8,
    pub round: u8,
    pub time_ms: u32,
    pub attack_score: u8,
    pub defend_score: u8,
    pub bomb: u8,
    pub bomb_site: u8,
    pub winner: u8,
}

pub fn encode_round_state(s: &RoundStateMsg) -> Vec<u8> {
    let mut out = Vec::with_capacity(11);
    out.push(s.phase);
    out.push(s.round);
    out.extend_from_slice(&s.time_ms.to_be_bytes());
    out.push(s.attack_score);
    out.push(s.defend_score);
    out.push(s.bomb);
    out.push(s.bomb_site);
    out.push(s.winner);
    out
}

#[derive(Clone, Copy, Debug)]
pub struct KillFeedMsg {
    pub attacker_id: u32,
    pub victim_id: u32,
    pub weapon_id: u8,
    pub flags: u8,
    pub distance_cm: u16,
}

pub fn encode_kill_feed(k: &KillFeedMsg) -> Vec<u8> {
    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&k.attacker_id.to_be_bytes());
    out.extend_from_slice(&k.victim_id.to_be_bytes());
    out.push(k.weapon_id);
    out.push(k.flags);
    out.extend_from_slice(&k.distance_cm.to_be_bytes());
    out
}

pub fn encode_match_end(winner: u8, attack_score: u8, defend_score: u8, reason: u8) -> Vec<u8> {
    vec![winner, attack_score, defend_score, reason]
}

#[derive(Clone, Copy, Debug)]
pub struct DamageMsg {
    pub victim_id: u32,
    pub damage: u16,
    pub victim_health: u16,
}

pub fn encode_damage(victim_id: u32, damage: u16, victim_health: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(8);
    out.extend_from_slice(&victim_id.to_be_bytes());
    out.extend_from_slice(&damage.to_be_bytes());
    out.extend_from_slice(&victim_health.to_be_bytes());
    out
}

// ---------- Buy / Economy / Grenade / Flash ----------

pub fn decode_buy(payload: &[u8]) -> Option<u8> {
    payload.first().copied()
}

#[derive(Clone, Copy, Debug)]
pub struct EconomyMsg {
    pub player_id: u32,
    pub money: u16,
    pub weapon_id: u8,
    pub armor: u8,
    pub n_smoke: u8,
    pub n_flash: u8,
    pub n_he: u8,
}

pub fn encode_economy(e: &EconomyMsg) -> Vec<u8> {
    let mut out = Vec::with_capacity(11);
    out.extend_from_slice(&e.player_id.to_be_bytes());
    out.extend_from_slice(&e.money.to_be_bytes());
    out.push(e.weapon_id);
    out.push(e.armor);
    out.push(e.n_smoke);
    out.push(e.n_flash);
    out.push(e.n_he);
    out
}

#[derive(Clone, Copy, Debug)]
pub struct GrenadeSpawnMsg {
    pub id: u32,
    pub kind: u8,
    pub owner_id: u32,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
}

pub fn encode_grenade_spawn(g: &GrenadeSpawnMsg) -> Vec<u8> {
    let mut out = Vec::with_capacity(21);
    out.extend_from_slice(&g.id.to_be_bytes());
    out.push(g.kind);
    out.extend_from_slice(&g.owner_id.to_be_bytes());
    for i in 0..3 {
        out.extend_from_slice(&((g.pos[i] * 100.0) as i16).to_be_bytes());
    }
    for i in 0..3 {
        out.extend_from_slice(&((g.vel[i] * 100.0) as i16).to_be_bytes());
    }
    out
}

#[derive(Clone, Copy, Debug)]
pub struct GrenadeExplodeMsg {
    pub id: u32,
    pub kind: u8,
    pub pos: [f32; 3],
}

pub fn encode_grenade_explode(g: &GrenadeExplodeMsg) -> Vec<u8> {
    let mut out = Vec::with_capacity(11);
    out.extend_from_slice(&g.id.to_be_bytes());
    out.push(g.kind);
    for i in 0..3 {
        out.extend_from_slice(&((g.pos[i] * 100.0) as i16).to_be_bytes());
    }
    out
}

pub fn encode_flash(strength: u8) -> Vec<u8> {
    vec![strength]
}
