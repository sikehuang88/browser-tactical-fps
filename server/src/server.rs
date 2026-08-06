//! 连接处理与 64 tick 权威模拟循环。

use std::collections::HashMap;
use std::error::Error;
use std::net::SocketAddr;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

use crate::config::Config;
use crate::protocol::{
    decode_hello, decode_input_frame, decode_ping, encode_damage, encode_envelope, encode_kick,
    encode_kill_feed, encode_match_end, encode_pong, encode_round_state, encode_snapshot,
    encode_welcome, parse_envelope, InputFrame, KICK_SERVER_FULL, KICK_VERSION_MISMATCH,
    MSG_DAMAGE, MSG_HELLO, MSG_INPUT_FRAME, MSG_KICK, MSG_KILL_FEED, MSG_MATCH_END, MSG_PING,
    MSG_PONG, MSG_ROUND_STATE, MSG_SNAPSHOT, MSG_WELCOME,
};
use crate::sim::{World, WorldEvent};
use crate::telemetry::TickStats;

/// 连接 → 模拟循环 的消息。
pub enum InboundMsg {
    Register {
        name: String,
        out_tx: mpsc::Sender<OutboundMsg>,
        resp: oneshot::Sender<Result<u32, String>>,
    },
    Input {
        player_id: u32,
        frame: InputFrame,
    },
    Ping {
        player_id: u32,
        client_sent_at_ms: u32,
    },
    Disconnect {
        player_id: u32,
    },
}

/// 模拟循环 → 连接 的消息（预编码，快照走不可靠通道语义，channel 满则丢弃；
/// 回合/击杀/结算等关键事件可靠送达）。
#[derive(Clone)]
pub enum OutboundMsg {
    Snapshot(Vec<u8>),
    Pong(Vec<u8>),
    RoundState(Vec<u8>),
    KillFeed(Vec<u8>),
    MatchEnd(Vec<u8>),
    Damage(Vec<u8>),
}

/// 权威模拟循环：固定 tick 频率，批处理输入、步进世界、广播快照。
pub async fn run_tick_loop(cfg: Config, mut rx: mpsc::Receiver<InboundMsg>) {
    let mut world = World::new(cfg.tick_rate);
    let mut players: HashMap<u32, mpsc::Sender<OutboundMsg>> = HashMap::new();
    let mut next_id: u32 = 0;
    let mut tick: u32 = 0;
    let dt = 1.0 / cfg.tick_rate as f32;

    let interval_dur = Duration::from_micros((1_000_000_f64 / cfg.tick_rate as f64) as u64);
    let mut interval = tokio::time::interval(interval_dur);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let snapshot_every = (cfg.tick_rate / 32).max(1);
    let mut stats = TickStats::new(cfg.tick_rate);

    loop {
        interval.tick().await;

        // 批处理本 tick 前的所有入站消息
        while let Ok(msg) = rx.try_recv() {
            handle_inbound(msg, &mut world, &mut players, &mut next_id, &mut stats, &cfg);
        }

        let start = Instant::now();
        let events = world.step(dt);
        stats.record(start.elapsed());

        // 广播关键事件（可靠通道）
        for ev in events {
            match ev {
                WorldEvent::KillFeed(k) => {
                    let bytes =
                        encode_envelope(MSG_KILL_FEED, tick, &encode_kill_feed(&k), true);
                    broadcast(&players, OutboundMsg::KillFeed(bytes));
                }
                WorldEvent::RoundState(s) => {
                    log::info!("广播 RoundState: phase={} round={} t={}ms", s.phase, s.round, s.time_ms);
                    let bytes =
                        encode_envelope(MSG_ROUND_STATE, tick, &encode_round_state(&s), true);
                    broadcast(&players, OutboundMsg::RoundState(bytes));
                }
                WorldEvent::MatchEnd(w, a, d) => {
                    let bytes = encode_envelope(
                        MSG_MATCH_END,
                        tick,
                        &encode_match_end(w, a, d, 0),
                        true,
                    );
                    broadcast(&players, OutboundMsg::MatchEnd(bytes));
                }
                WorldEvent::Damage(to, dmg) => {
                    let bytes = encode_envelope(
                        MSG_DAMAGE,
                        tick,
                        &encode_damage(dmg.victim_id, dmg.damage, dmg.victim_health),
                        true,
                    );
                    if let Some(tx) = players.get(&to) {
                        let _ = tx.try_send(OutboundMsg::Damage(bytes));
                    }
                }
            }
        }

        if !players.is_empty() && tick % snapshot_every == 0 {
            let entities = world.snapshot();
            if !entities.is_empty() {
                let payload = encode_snapshot(tick, &entities);
                let bytes = encode_envelope(MSG_SNAPSHOT, tick, &payload, false);
                for tx in players.values() {
                    let _ = tx.try_send(OutboundMsg::Snapshot(bytes.clone()));
                }
            }
        }

        tick = tick.wrapping_add(1);
        if tick % cfg.tick_rate == 0 {
            stats.log_and_reset();
        }
    }
}

fn broadcast(players: &HashMap<u32, mpsc::Sender<OutboundMsg>>, out: OutboundMsg) {
    for tx in players.values() {
        let _ = tx.try_send(out.clone());
    }
}

fn handle_inbound(
    msg: InboundMsg,
    world: &mut World,
    players: &mut HashMap<u32, mpsc::Sender<OutboundMsg>>,
    next_id: &mut u32,
    stats: &mut TickStats,
    cfg: &Config,
) {
    match msg {
        InboundMsg::Register { name, out_tx, resp } => {
            if world.player_count() >= cfg.max_players {
                let _ = resp.send(Err("服务器已满".into()));
                return;
            }
            *next_id += 1;
            let id = *next_id;
            world.add_player(id, name);
            players.insert(id, out_tx);
            let _ = resp.send(Ok(id));
        }
        InboundMsg::Input { player_id, frame } => {
            stats.record_input_lag(now_ms().saturating_sub(frame.client_sent_at_ms));
            world.set_input(player_id, frame);
        }
        InboundMsg::Ping { player_id, client_sent_at_ms } => {
            let now = now_ms();
            // 估算 RTT（假设对称）用于命中延迟补偿
            let est_rtt = now.saturating_sub(client_sent_at_ms).saturating_mul(2);
            world.set_rtt(player_id, est_rtt);
            if let Some(tx) = players.get(&player_id) {
                let bytes = encode_envelope(MSG_PONG, 0, &encode_pong(client_sent_at_ms, now), true);
                let _ = tx.try_send(OutboundMsg::Pong(bytes));
            }
        }
        InboundMsg::Disconnect { player_id } => {
            world.remove_player(player_id);
            players.remove(&player_id);
            log::info!("玩家 {player_id} 断开");
        }
    }
}

/// 处理单个连接：Hello → Register → Welcome，之后进入读写双循环。
pub async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    inbound: mpsc::Sender<InboundMsg>,
    cfg: Config,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::warn!("ws 升级失败 {addr}: {e}");
            return Ok(());
        }
    };
    let (mut sink, mut reader) = ws.split();

    // 1) 等待 Hello
    let (major, minor, patch, name) = match read_hello(&mut reader).await? {
        Some(h) => h,
        None => return Ok(()),
    };
    if (major, minor, patch) != (0, 1, 0) {
        log::warn!("版本不匹配来自 {addr}: {major}.{minor}.{patch}");
        let kick = encode_envelope(MSG_KICK, 0, &encode_kick(KICK_VERSION_MISMATCH, "版本不匹配"), true);
        let _ = sink.send(Message::Binary(kick.into())).await;
        return Ok(());
    }
    log::info!("握手 {name} ({addr}) v{major}.{minor}.{patch}");

    // 2) 注册
    let (out_tx, out_rx) = mpsc::channel::<OutboundMsg>(64);
    let (resp_tx, resp_rx) = oneshot::channel();
    if inbound
        .send(InboundMsg::Register { name, out_tx, resp: resp_tx })
        .await
        .is_err()
    {
        return Ok(());
    }
    let player_id = match resp_rx.await {
        Ok(Ok(id)) => id,
        Ok(Err(reason)) => {
            let kick = encode_envelope(MSG_KICK, 0, &encode_kick(KICK_SERVER_FULL, &reason), true);
            let _ = sink.send(Message::Binary(kick.into())).await;
            return Ok(());
        }
        Err(_) => return Ok(()),
    };

    // 3) Welcome
    let welcome = encode_envelope(MSG_WELCOME, 0, &encode_welcome(player_id, cfg.tick_rate as u16, 0), true);
    if sink.send(Message::Binary(welcome.into())).await.is_err() {
        let _ = inbound.send(InboundMsg::Disconnect { player_id }).await;
        return Ok(());
    }

    // 4) 写循环（快照/心跳回包）
    let writer = tokio::spawn(writer_loop(sink, out_rx));

    // 5) 读循环
    loop {
        let msg = match reader.next().await {
            Some(Ok(m)) => m,
            Some(Err(e)) => {
                log::warn!("ws 读取错误 {addr}: {e}");
                break;
            }
            None => break,
        };
        match msg {
            Message::Binary(data) => {
                let env = match parse_envelope(&data) {
                    Ok(e) => e,
                    Err(err) => {
                        log::warn!("协议错误来自 {addr}: {err}");
                        continue;
                    }
                };
                match env.msg_type {
                    MSG_INPUT_FRAME => match decode_input_frame(&env.payload) {
                        Ok(frame) => {
                            if inbound
                                .send(InboundMsg::Input { player_id, frame })
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(e) => log::warn!("输入帧解码失败: {e}"),
                    },
                    MSG_PING => {
                        let ts = decode_ping(&env.payload);
                        if inbound
                            .send(InboundMsg::Ping { player_id, client_sent_at_ms: ts })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    MSG_HELLO => { /* 重复握手，忽略 */ }
                    _ => {}
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    let _ = inbound.send(InboundMsg::Disconnect { player_id }).await;
    writer.abort();
    Ok(())
}

/// 读首包 Hello（忽略其他消息直到收到合法 Hello）。
async fn read_hello<S>(reader: &mut S) -> Result<Option<(u8, u8, u8, String)>, WsError>
where
    S: futures_util::Stream<Item = Result<Message, WsError>> + Unpin,
{
    loop {
        let msg = match reader.next().await {
            Some(Ok(m)) => m,
            Some(Err(e)) => return Err(e),
            None => return Ok(None),
        };
        match msg {
            Message::Binary(data) => {
                let env = match parse_envelope(&data) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                if env.msg_type == MSG_HELLO {
                    if let Ok(h) = decode_hello(&env.payload) {
                        return Ok(Some(h));
                    }
                }
            }
            Message::Close(_) => return Ok(None),
            _ => {}
        }
    }
}

/// 将模拟循环下发的消息写入 socket。
async fn writer_loop<S>(mut sink: S, mut rx: mpsc::Receiver<OutboundMsg>)
where
    S: futures_util::Sink<Message> + Unpin,
{
    while let Some(out) = rx.recv().await {
        let payload = match out {
            OutboundMsg::Snapshot(b)
            | OutboundMsg::Pong(b)
            | OutboundMsg::RoundState(b)
            | OutboundMsg::KillFeed(b)
            | OutboundMsg::MatchEnd(b)
            | OutboundMsg::Damage(b) => b,
        };
        if sink.send(Message::Binary(payload.into())).await.is_err() {
            break;
        }
    }
}

fn now_ms() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u32
}
