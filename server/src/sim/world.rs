//! 世界：玩家集合 + 碰撞 + 战斗 + 回合 + 位置历史（延迟补偿）。
//! 每 tick 由 run_tick_loop 驱动，产出需广播给客户端的事件。

use std::collections::{HashMap, VecDeque};

use super::combat::{fire_hitscan, apply_damage, PlayerView};
use super::map::Collision;
use super::player::Player;
use super::round::RoundManager;
use super::weapon::get_weapon;
use crate::protocol::{
    DamageMsg, InputFrame, KillFeedMsg, RoundStateMsg, SnapshotEntity, TEAM_ATTACK, TEAM_DEFEND,
    BTN_ATTACK, BTN_RELOAD, PHASE_ACTIVE,
};

/// 世界向连接层广播的事件。
pub enum WorldEvent {
    KillFeed(KillFeedMsg),
    RoundState(RoundStateMsg),
    MatchEnd(u8, u8, u8), // winner, attack_score, defend_score
    Damage(u32, DamageMsg), // to_player_id, msg
}

pub struct World {
    players: HashMap<u32, Player>,
    collision: Collision,
    round: RoundManager,
    /// 每玩家位置历史（回溯窗口 128 tick ≈ 2s，用于延迟补偿）。
    history: HashMap<u32, VecDeque<(u64, [f32; 3])>>,
    tick: u64,
    tick_rate: u32,
    prev_match_ended: bool,
}

impl World {
    pub fn new(tick_rate: u32) -> Self {
        Self {
            players: HashMap::new(),
            collision: Collision::default(),
            round: RoundManager::new(),
            history: HashMap::new(),
            tick: 0,
            tick_rate,
            prev_match_ended: false,
        }
    }

    pub fn add_player(&mut self, id: u32, name: String) {
        // 按加入顺序奇偶分配队伍（1、3、5… 进攻；2、4… 防守），加入即稳定
        let team = if self.players.len() % 2 == 0 { TEAM_ATTACK } else { TEAM_DEFEND };
        let mut p = Player::new(id, name, super::map::SPAWN);
        p.team = team;
        self.players.insert(id, p);
        log::info!("玩家 {id} ({team}) 加入，当前 {} 人", self.players.len());
    }

    pub fn remove_player(&mut self, id: u32) {
        self.players.remove(&id);
        self.history.remove(&id);
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn set_input(&mut self, id: u32, frame: InputFrame) {
        if let Some(p) = self.players.get_mut(&id) {
            p.set_input(frame);
        }
    }

    pub fn set_rtt(&mut self, id: u32, rtt_ms: u32) {
        if let Some(p) = self.players.get_mut(&id) {
            p.set_rtt(rtt_ms);
        }
    }

    /// 步进一个 tick：输入 → 移动/历史 → 换弹/开火/命中 → 回合推进。
    pub fn step(&mut self, dt: f32) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let movement_allowed = self.round.phase == PHASE_ACTIVE;

        // 1) 收集本 tick 输入（每玩家最新帧）
        let mut inputs: HashMap<u32, InputFrame> = HashMap::new();
        for p in self.players.values_mut() {
            if let Some(frame) = p.take_input() {
                inputs.insert(p.id, frame);
            }
        }

        // 2) 移动（仅存活；冻结阶段可转身不可移动）+ 位置历史
        for (id, p) in self.players.iter_mut() {
            if !p.alive {
                continue;
            }
            if let Some(inp) = inputs.get(id) {
                p.apply_view(inp);
                if movement_allowed {
                    p.apply_movement(inp, dt, &self.collision);
                } else {
                    p.apply_gravity(dt, &self.collision);
                }
            } else if movement_allowed {
                p.apply_gravity(dt, &self.collision);
            }
            let entry = self.history.entry(*id).or_default();
            entry.push_back((self.tick, p.pos));
            while entry.len() > 128 {
                entry.pop_front();
            }
        }

        // 3) 换弹与开火（仅行动阶段）
        if movement_allowed {
            self.run_weapons(&inputs, &mut events);
        }

        // 4) 回合推进
        self.round.update(&mut self.players, &inputs, self.tick_rate);
        if self.round.dirty {
            log::info!("回合状态变更: phase={} round={} bomb={}", self.round.phase, self.round.round_number, self.round.bomb);
            events.push(WorldEvent::RoundState(self.round_state_msg()));
            self.round.dirty = false;
        }
        // 对局结束（上升沿，只发一次；重新开局后复位）
        if self.round.match_ended && !self.prev_match_ended {
            events.push(WorldEvent::MatchEnd(
                self.round.winner,
                self.round.attack_score,
                self.round.defend_score,
            ));
        }
        self.prev_match_ended = self.round.match_ended;

        self.tick += 1;
        events
    }

    /// 生成按 id 排序的快照实体（含死亡玩家，客户端据此隐藏/计分板展示）。
    pub fn snapshot(&self) -> Vec<SnapshotEntity> {
        let mut ids: Vec<u32> = self.players.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter()
            .filter_map(|id| self.players.get(&id))
            .map(Player::snapshot_entity)
            .collect()
    }

    fn run_weapons(&mut self, inputs: &HashMap<u32, InputFrame>, events: &mut Vec<WorldEvent>) {
        // 换弹（含空弹匣自动换弹）
        for p in self.players.values_mut() {
            if !p.alive {
                continue;
            }
            p.tick_reload();
            if let Some(inp) = inputs.get(&p.id) {
                let spec = p.weapon_spec();
                let reload_ticks = (spec.reload_ms * self.tick_rate / 1000).max(1);
                if inp.buttons & BTN_RELOAD != 0 && !p.reloading && p.ammo < spec.mag_size {
                    p.start_reload(reload_ticks);
                } else if inp.buttons & BTN_ATTACK != 0 && p.ammo == 0 && !p.reloading {
                    p.start_reload(reload_ticks);
                }
            }
        }

        // 视图快照（只读，供命中检测）
        let views: Vec<PlayerView> = self
            .players
            .values()
            .map(|p| PlayerView {
                id: p.id,
                pos: p.pos,
                crouching: p.crouching,
                yaw: p.yaw,
                pitch: p.pitch,
                alive: p.alive,
                team: p.team,
                weapon_id: p.weapon_id,
                ammo: p.ammo,
                reloading: p.reloading,
                next_fire_tick: p.next_fire_tick,
                rtt_ms: p.rtt_ms,
            })
            .collect();

        // 开火（统计本次扣弹量，结算阶段统一写入，避免双重借用）
        let mut fired: Vec<(u32, u32, Option<super::combat::Hit>)> = Vec::new();
        for v in &views {
            if !v.alive {
                continue;
            }
            if let Some(inp) = inputs.get(&v.id) {
                if inp.buttons & BTN_ATTACK != 0
                    && v.ammo > 0
                    && !v.reloading
                    && self.tick >= v.next_fire_tick
                {
                    let hit = fire_hitscan(
                        v,
                        &views,
                        self.collision.walls(),
                        self.collision.bounds(),
                        &self.history,
                        self.tick,
                        self.tick_rate,
                    );
                    fired.push((v.id, v.weapon_id, hit));
                }
            }
        }

        // 结算（弹药/射速 + 伤害/击杀）
        let mut deaths: Vec<(u32, u32, u8, bool, f32)> = Vec::new(); // shooter, victim, weapon, headshot, dist
        for (shooter_id, weapon_id, hit) in fired {
            let spec = get_weapon(weapon_id);
            let interval = (spec.fire_interval_ms as u64 * self.tick_rate as u64 / 1000).max(1);
            if let Some(shooter) = self.players.get_mut(&shooter_id) {
                shooter.consume_fire(self.tick, interval);
            }
            if let Some(hit) = hit {
                let (dealt, victim_health, victim_died) = {
                    let victim = match self.players.get_mut(&hit.victim_id) {
                        Some(v) => v,
                        None => continue,
                    };
                    let dealt = apply_damage(victim, hit.damage, hit.zone);
                    (dealt, victim.health as u16, !victim.alive)
                };
                events.push(WorldEvent::Damage(
                    shooter_id,
                    DamageMsg {
                        victim_id: hit.victim_id,
                        damage: dealt,
                        victim_health,
                    },
                ));
                if victim_died {
                    deaths.push((
                        shooter_id,
                        hit.victim_id,
                        weapon_id as u8,
                        hit.headshot,
                        hit.distance_m,
                    ));
                }
            }
        }

        for (shooter, victim, weapon_id, headshot, dist) in deaths {
            if let Some(v) = self.players.get_mut(&victim) {
                v.deaths += 1;
            }
            if let Some(k) = self.players.get_mut(&shooter) {
                k.kills += 1;
            }
            events.push(WorldEvent::KillFeed(KillFeedMsg {
                attacker_id: shooter,
                victim_id: victim,
                weapon_id,
                flags: if headshot { 1 } else { 0 },
                distance_cm: (dist * 100.0) as u16,
            }));
        }
    }

    fn round_state_msg(&self) -> RoundStateMsg {
        RoundStateMsg {
            phase: self.round.phase,
            round: self.round.round_number,
            time_ms: self.round.time_ms.min(u16::MAX as u32) as u16,
            attack_score: self.round.attack_score,
            defend_score: self.round.defend_score,
            bomb: self.round.bomb,
            bomb_site: self.round.bomb_site,
            winner: self.round.winner,
        }
    }
}
