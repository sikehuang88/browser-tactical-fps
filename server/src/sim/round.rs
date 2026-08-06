//! 回合状态机 + 爆破逻辑（GAME-001/002/004）。
//! 服务器权威：冻结/行动/回合结束、攻守计分、炸弹安装/拆除/爆炸、换边、对局结束。

use std::collections::HashMap;

use super::map::{BOMB_SITES, DEFUSE_DISTANCE, PLANT_DISTANCE, SPAWN_ATTACK, SPAWN_DEFEND};
use super::player::Player;
use crate::protocol::{
    BOMB_DEFUSED, BOMB_DEFUSING, BOMB_NONE, BOMB_PLANTED, BOMB_PLANTING, BTN_USE,
    PHASE_ACTIVE, PHASE_FREEZE, PHASE_IDLE, PHASE_MATCH_END, PHASE_ROUND_END, TEAM_ATTACK,
    TEAM_DEFEND, WINNER_ATTACK, WINNER_DEFEND, WINNER_NONE,
};

#[derive(Clone, Copy)]
pub struct RoundConfig {
    pub rounds_to_win: u8,
    pub freeze_ms: u32,
    pub round_time_ms: u32,
    pub bomb_time_ms: u32,
    pub plant_ms: u32,
    pub defuse_ms: u32,
    pub round_end_ms: u32,
    pub max_rounds: u8,
}

impl Default for RoundConfig {
    fn default() -> Self {
        Self {
            rounds_to_win: 3,
            freeze_ms: 4000,
            round_time_ms: 90_000,
            bomb_time_ms: 40_000,
            plant_ms: 3500,
            defuse_ms: 8000,
            round_end_ms: 4000,
            max_rounds: 5, // 2 × rounds_to_win - 1
        }
    }
}

#[derive(PartialEq, Clone, Copy)]
pub enum RoundOutcome {
    None,
    MatchEnd,
}

pub struct RoundManager {
    pub cfg: RoundConfig,
    pub phase: u8,
    pub round_number: u8,
    pub attack_score: u8,
    pub defend_score: u8,
    pub time_ms: u32,
    pub bomb: u8,
    pub bomb_site: u8,
    pub winner: u8,
    /// 状态发生对客户端可见变化，世界据此广播 RoundState。
    pub dirty: bool,
    pub match_ended: bool,
    plant_ticks: u32,
    defuse_ticks: u32,
    /// 安装/拆除的输入间隙宽限（容忍输入帧与服务器 tick 错位的抖动）。
    plant_grace: u32,
    defuse_grace: u32,
}

/// 连续多少个 tick 无 USE 输入才取消安装/拆除（3 tick ≈ 47ms）。
const GRACE_TICKS: u32 = 3;

impl Default for RoundManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RoundManager {
    pub fn new() -> Self {
        Self {
            cfg: RoundConfig::default(),
            phase: PHASE_IDLE,
            round_number: 0,
            attack_score: 0,
            defend_score: 0,
            time_ms: 0,
            bomb: BOMB_NONE,
            bomb_site: 0,
            winner: WINNER_NONE,
            dirty: true,
            match_ended: false,
            plant_ticks: 0,
            defuse_ticks: 0,
            plant_grace: 0,
            defuse_grace: 0,
        }
    }

    /// 开始对局：队伍在加入时已按奇偶分配，此处补齐未分配玩家并进入首回合冻结。
    pub fn begin_match(&mut self, players: &mut HashMap<u32, Player>) {
        let mut idx = 0usize;
        let mut ids: Vec<u32> = players.keys().copied().collect();
        ids.sort_unstable();
        for id in ids {
            if let Some(p) = players.get_mut(&id) {
                if p.team == 0 {
                    p.team = if idx % 2 == 0 { TEAM_ATTACK } else { TEAM_DEFEND };
                }
                idx += 1;
            }
        }
        self.round_number = 1;
        self.attack_score = 0;
        self.defend_score = 0;
        self.phase = PHASE_FREEZE;
        self.time_ms = self.cfg.freeze_ms;
        self.bomb = BOMB_NONE;
        self.winner = WINNER_NONE;
        self.match_ended = false;
        self.reset_players(players);
        self.dirty = true;
    }

    /// 每 tick 推进。输入帧用于安装/拆除交互（USE 按钮）。
    pub fn update(
        &mut self,
        players: &mut HashMap<u32, Player>,
        inputs: &HashMap<u32, crate::protocol::InputFrame>,
        tick_rate: u32,
    ) -> RoundOutcome {
        if self.phase == PHASE_IDLE {
            // 不足双方各一名玩家时不推进，防止空阵容空转
            if players.len() < 2 {
                return RoundOutcome::None;
            }
            self.begin_match(players);
            return RoundOutcome::None;
        }
        if self.phase == PHASE_MATCH_END {
            // 对局结束后有新玩家加入 → 重新开局
            if players.len() >= 2 {
                self.begin_match(players);
                return RoundOutcome::None;
            }
            return RoundOutcome::MatchEnd;
        }

        let ms_per_tick = 1000 / tick_rate;
        self.time_ms = self.time_ms.saturating_sub(ms_per_tick);

        match self.phase {
            PHASE_FREEZE => {
                if self.time_ms == 0 {
                    self.phase = PHASE_ACTIVE;
                    self.time_ms = self.cfg.round_time_ms;
                    self.dirty = true;
                }
            }
            PHASE_ACTIVE => {
                self.update_bomb(players, inputs, tick_rate);
                // update_bomb 可能已结束本回合
                if self.phase != PHASE_ACTIVE {
                    return RoundOutcome::None;
                }
                if self.bomb == crate::protocol::BOMB_PLANTED && self.time_ms == 0 {
                    // 炸弹爆炸 → 进攻方胜
                    self.bomb = crate::protocol::BOMB_EXPLODED;
                    self.dirty = true;
                    return self.finish_round(WINNER_ATTACK);
                }
                if self.bomb == BOMB_NONE && self.time_ms == 0 {
                    // 超时未安装 → 防守方胜
                    return self.finish_round(WINNER_DEFEND);
                }
                let (a_alive, d_alive) = alive_counts(players);
                if a_alive == 0 {
                    return self.finish_round(WINNER_DEFEND);
                }
                if d_alive == 0 {
                    return self.finish_round(WINNER_ATTACK);
                }
            }
            PHASE_ROUND_END => {
                if self.time_ms == 0 {
                    self.next_round(players);
                }
            }
            _ => {}
        }
        RoundOutcome::None
    }

    /// 安装/拆除进度。安装：NONE → PLANTING → PLANTED；拆除：PLANTED → DEFUSING → DEFUSED。
    /// 全程推进，并带输入间隙宽限（容忍输入帧与 tick 错位）。
    fn update_bomb(
        &mut self,
        players: &mut HashMap<u32, Player>,
        inputs: &HashMap<u32, crate::protocol::InputFrame>,
        tick_rate: u32,
    ) {
        if self.bomb == BOMB_NONE || self.bomb == BOMB_PLANTING {
            let mut planter: Option<(u32, u8)> = None;
            for (id, p) in players.iter() {
                if !p.alive || p.team != TEAM_ATTACK || !holds_use(inputs, *id) {
                    continue;
                }
                if let Some(site) = site_near(p.pos) {
                    planter = Some((*id, site));
                    break;
                }
            }
            if let Some((_, site)) = planter {
                self.plant_grace = 0;
                if self.bomb == BOMB_NONE {
                    self.bomb = BOMB_PLANTING;
                    self.dirty = true;
                }
                self.plant_ticks += 1;
                let total = (self.cfg.plant_ms * tick_rate / 1000).max(1);
                if self.plant_ticks >= total {
                    self.bomb = BOMB_PLANTED;
                    self.bomb_site = site;
                    self.time_ms = self.cfg.bomb_time_ms;
                    self.plant_ticks = 0;
                    self.plant_grace = 0;
                    self.dirty = true;
                }
            } else if self.bomb == BOMB_PLANTING {
                self.plant_grace += 1;
                if self.plant_grace >= GRACE_TICKS {
                    self.bomb = BOMB_NONE;
                    self.plant_ticks = 0;
                    self.plant_grace = 0;
                    self.dirty = true;
                }
            }
        } else if self.bomb == BOMB_PLANTED || self.bomb == BOMB_DEFUSING {
            let site_pos = BOMB_SITES[self.bomb_site as usize];
            let mut defuser: Option<u32> = None;
            for (id, p) in players.iter() {
                if !p.alive
                    || p.team != TEAM_DEFEND
                    || !holds_use(inputs, *id)
                    || dist2(p.pos, site_pos) > DEFUSE_DISTANCE * DEFUSE_DISTANCE
                {
                    continue;
                }
                defuser = Some(*id);
                break;
            }
            if defuser.is_some() {
                self.defuse_grace = 0;
                if self.bomb == BOMB_PLANTED {
                    self.bomb = BOMB_DEFUSING;
                    self.dirty = true;
                }
                self.defuse_ticks += 1;
                let total = (self.cfg.defuse_ms * tick_rate / 1000).max(1);
                if self.defuse_ticks >= total {
                    self.bomb = BOMB_DEFUSED;
                    self.defuse_ticks = 0;
                    self.defuse_grace = 0;
                    self.dirty = true;
                    self.finish_round(WINNER_DEFEND);
                    return;
                }
            } else if self.bomb == BOMB_DEFUSING {
                self.defuse_grace += 1;
                if self.defuse_grace >= GRACE_TICKS {
                    self.bomb = BOMB_PLANTED;
                    self.defuse_ticks = 0;
                    self.defuse_grace = 0;
                    self.dirty = true;
                }
            }
        }
    }

    fn finish_round(&mut self, winner: u8) -> RoundOutcome {
        self.phase = PHASE_ROUND_END;
        self.time_ms = self.cfg.round_end_ms;
        self.winner = winner;
        if winner == WINNER_ATTACK {
            self.attack_score += 1;
        } else if winner == WINNER_DEFEND {
            self.defend_score += 1;
        }
        self.dirty = true;

        if self.attack_score >= self.cfg.rounds_to_win || self.defend_score >= self.cfg.rounds_to_win
        {
            self.phase = PHASE_MATCH_END;
            self.match_ended = true;
            self.dirty = true;
            return RoundOutcome::MatchEnd;
        }
        RoundOutcome::None
    }

    fn next_round(&mut self, players: &mut HashMap<u32, Player>) {
        self.round_number += 1;
        if self.round_number > self.cfg.max_rounds {
            self.phase = PHASE_MATCH_END;
            self.match_ended = true;
            self.dirty = true;
            return;
        }
        // 换边策略：队伍加入时已固定，攻守换边在后续里程碑完善（GAME-001 换边）

        self.phase = PHASE_FREEZE;
        self.time_ms = self.cfg.freeze_ms;
        self.bomb = BOMB_NONE;
        self.winner = WINNER_NONE;
        self.plant_ticks = 0;
        self.defuse_ticks = 0;
        self.plant_grace = 0;
        self.defuse_grace = 0;
        self.reset_players(players);
        self.dirty = true;
    }

    fn reset_players(&self, players: &mut HashMap<u32, Player>) {
        for p in players.values_mut() {
            let spawn = if p.team == TEAM_ATTACK { SPAWN_ATTACK } else { SPAWN_DEFEND };
            p.reset_for_round(spawn);
        }
    }
}

fn holds_use(inputs: &HashMap<u32, crate::protocol::InputFrame>, id: u32) -> bool {
    inputs.get(&id).map(|f| f.buttons & BTN_USE != 0).unwrap_or(false)
}

fn site_near(pos: [f32; 3]) -> Option<u8> {
    for (i, site) in BOMB_SITES.iter().enumerate() {
        if dist2(pos, *site) <= PLANT_DISTANCE * PLANT_DISTANCE {
            return Some(i as u8);
        }
    }
    None
}

fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

fn alive_counts(players: &HashMap<u32, Player>) -> (u32, u32) {
    let mut a = 0;
    let mut d = 0;
    for p in players.values() {
        if !p.alive {
            continue;
        }
        if p.team == TEAM_ATTACK {
            a += 1;
        } else if p.team == TEAM_DEFEND {
            d += 1;
        }
    }
    (a, d)
}
