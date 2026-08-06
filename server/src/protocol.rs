//! 协议常量、信封编解码与消息结构体。与 client/src/core/net/codec.ts 同规格。
//! 线格式见 proto/README.md「M0 引导线格式」。
//! 完整编解码是双向规格，当前里程碑只消费其中一部分，未用到的函数/常量后续里程碑启用。
#![allow(dead_code)]

pub const MAGIC: u8 = 0xF5;
pub const PROTOCOL_VERSION: u8 = 0x01;

pub const MSG_HELLO: u8 = 0x01;
pub const MSG_WELCOME: u8 = 0x02;
pub const MSG_INPUT_FRAME: u8 = 0x03;
pub const MSG_SNAPSHOT: u8 = 0x04;
pub const MSG_PING: u8 = 0x05;
pub const MSG_PONG: u8 = 0x06;
pub const MSG_KICK: u8 = 0x07;

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

/// 踢出原因（与 KickReason 枚举对应）。
pub const KICK_VERSION_MISMATCH: u8 = 0;
pub const KICK_SERVER_FULL: u8 = 1;
pub const KICK_PROTOCOL_ERROR: u8 = 2;

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
    let mut out = Vec::with_capacity(5 + entities.len() * 17);
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
    }
    out
}

// ---------- Ping / Pong / Kick ----------

pub fn decode_ping(payload: &[u8]) -> u32 {
    if payload.len() < 4 {
        return 0;
    }
    u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]])
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
