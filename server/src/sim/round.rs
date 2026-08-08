//! 回合状态机 + 爆破逻辑（GAME-001/002/004）。
//! 服务器权威：冻结/行动/回合结束、攻守计分、炸弹安装/拆除/爆炸、换边、对局结束。

use std::collections::HashMap;

use super::map::{BOMB_SITES, DEFUSE_DISTANCE, PLANT_DISTANCE, SPAWN_ATTACK, SPAWN_DEFEND};
use super::player::Player;
use super::weapon::{
    DEFUSE_BONUS, LOSS_BASE, LOSS_CAP, LOSS_STREAK_BONUS, PLANT_BONUS, WIN_REWARD,
};
use crate::protocol::{
    BOMB_DEFUSED, BOMB_DEFUSING, BOMB_EXPLODED, BOMB_NONE, BOMB_PLANTED, BOMB_PLANTING, BTN_USE,
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
            rounds_to_win: 6,
            freeze_ms: 15_000,
            round_time_ms: 90_000,
            bomb_time_ms: 40_000,
            plant_ms: 3500,
            defuse_ms: 8000,
            round_end_ms: 4000,
            max_rounds: 10,
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
    planter_id: Option<u32>,
    plant_site: Option<u8>,
    defuser_id: Option<u32>,
    time_remainder: u32,
    loss_streak_attack: u32,
    loss_streak_defend: u32,
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
            planter_id: None,
            plant_site: None,
            defuser_id: None,
            time_remainder: 0,
            loss_streak_attack: 0,
            loss_streak_defend: 0,
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
                    p.team = if idx.is_multiple_of(2) {
                        TEAM_ATTACK
                    } else {
                        TEAM_DEFEND
                    };
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
        self.reset_interaction();
        self.time_remainder = 0;
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
        let (attack_players, defend_players) = team_player_counts(players);
        if self.phase == PHASE_IDLE {
            if attack_players == 0 || defend_players == 0 {
                return RoundOutcome::None;
            }
            self.begin_match(players);
            return RoundOutcome::None;
        }
        if self.phase == PHASE_MATCH_END {
            return RoundOutcome::MatchEnd;
        }

        if attack_players == 0 || defend_players == 0 {
            self.abort_match(players);
            return RoundOutcome::None;
        }

        self.advance_clock(tick_rate);

        match self.phase {
            PHASE_FREEZE if self.time_ms == 0 => {
                self.phase = PHASE_ACTIVE;
                self.time_ms = self.cfg.round_time_ms;
                self.time_remainder = 0;
                self.dirty = true;
            }
            PHASE_ACTIVE => {
                // 超时先于交互结算：归零后不得再开始/继续安装或拆除。
                if self.time_ms == 0 {
                    if self.bomb == BOMB_PLANTED || self.bomb == BOMB_DEFUSING {
                        // 炸弹已安装（拆除未完成也视为未拆掉）→ 爆炸，进攻方胜。
                        self.bomb = BOMB_EXPLODED;
                        self.dirty = true;
                        return self.finish_round(WINNER_ATTACK, players);
                    }
                    if self.bomb == BOMB_PLANTING {
                        // 安装中不算安装成功 → 超时未安装，防守方胜。
                        self.bomb = BOMB_NONE;
                        self.reset_interaction();
                        self.dirty = true;
                    }
                    return self.finish_round(WINNER_DEFEND, players);
                }
                self.update_bomb(players, inputs, tick_rate);
                // update_bomb 可能已结束本回合
                if self.phase != PHASE_ACTIVE {
                    return RoundOutcome::None;
                }
                let (a_alive, d_alive) = alive_counts(players);
                if a_alive == 0 && self.bomb != BOMB_PLANTED && self.bomb != BOMB_DEFUSING {
                    return self.finish_round(WINNER_DEFEND, players);
                }
                if d_alive == 0 {
                    return self.finish_round(WINNER_ATTACK, players);
                }
            }
            PHASE_ROUND_END if self.time_ms == 0 => {
                self.next_round(players);
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
            let mut ids: Vec<u32> = players.keys().copied().collect();
            ids.sort_unstable();
            for id in ids {
                let Some(p) = players.get(&id) else { continue };
                if !p.alive || p.team != TEAM_ATTACK || !holds_use(inputs, id) {
                    continue;
                }
                if let Some(site) = site_near(p.pos) {
                    planter = Some((id, site));
                    break;
                }
            }
            if let Some((planter_id, site)) = planter {
                self.plant_grace = 0;
                if self.bomb == BOMB_NONE
                    || self.planter_id != Some(planter_id)
                    || self.plant_site != Some(site)
                {
                    self.bomb = BOMB_PLANTING;
                    self.plant_ticks = 0;
                    self.planter_id = Some(planter_id);
                    self.plant_site = Some(site);
                    self.dirty = true;
                }
                self.plant_ticks += 1;
                let total = (self.cfg.plant_ms * tick_rate / 1000).max(1);
                if self.plant_ticks >= total {
                    self.bomb = BOMB_PLANTED;
                    self.bomb_site = site;
                    self.time_ms = self.cfg.bomb_time_ms;
                    self.time_remainder = 0;
                    self.plant_ticks = 0;
                    self.plant_grace = 0;
                    self.planter_id = None;
                    self.plant_site = None;
                    self.dirty = true;
                    // 安装奖励
                    if let Some(p) = players.get_mut(&planter_id) {
                        p.grant_money(PLANT_BONUS);
                    }
                }
            } else if self.bomb == BOMB_PLANTING {
                self.plant_grace += 1;
                if self.plant_grace >= GRACE_TICKS {
                    self.bomb = BOMB_NONE;
                    self.plant_ticks = 0;
                    self.plant_grace = 0;
                    self.planter_id = None;
                    self.plant_site = None;
                    self.dirty = true;
                }
            }
        } else if self.bomb == BOMB_PLANTED || self.bomb == BOMB_DEFUSING {
            let site_pos = BOMB_SITES[self.bomb_site as usize];
            let mut defuser: Option<u32> = None;
            let mut ids: Vec<u32> = players.keys().copied().collect();
            ids.sort_unstable();
            for id in ids {
                let Some(p) = players.get(&id) else { continue };
                if !p.alive
                    || p.team != TEAM_DEFEND
                    || !holds_use(inputs, id)
                    || dist2(p.pos, site_pos) > DEFUSE_DISTANCE * DEFUSE_DISTANCE
                {
                    continue;
                }
                defuser = Some(id);
                break;
            }
            if let Some(defuser_id) = defuser {
                self.defuse_grace = 0;
                if self.bomb == BOMB_PLANTED || self.defuser_id != Some(defuser_id) {
                    self.bomb = BOMB_DEFUSING;
                    self.defuse_ticks = 0;
                    self.defuser_id = Some(defuser_id);
                    self.dirty = true;
                }
                self.defuse_ticks += 1;
                let total = (self.cfg.defuse_ms * tick_rate / 1000).max(1);
                if self.defuse_ticks >= total {
                    self.bomb = BOMB_DEFUSED;
                    self.defuse_ticks = 0;
                    self.defuse_grace = 0;
                    self.defuser_id = None;
                    self.dirty = true;
                    // 拆除奖励
                    if let Some(p) = players.get_mut(&defuser_id) {
                        p.grant_money(DEFUSE_BONUS);
                    }
                    self.finish_round(WINNER_DEFEND, players);
                }
            } else if self.bomb == BOMB_DEFUSING {
                self.defuse_grace += 1;
                if self.defuse_grace >= GRACE_TICKS {
                    self.bomb = BOMB_PLANTED;
                    self.defuse_ticks = 0;
                    self.defuse_grace = 0;
                    self.defuser_id = None;
                    self.dirty = true;
                }
            }
        }
    }

    fn finish_round(&mut self, winner: u8, players: &mut HashMap<u32, Player>) -> RoundOutcome {
        self.phase = PHASE_ROUND_END;
        self.time_ms = self.cfg.round_end_ms;
        self.time_remainder = 0;
        self.winner = winner;
        if winner == WINNER_ATTACK {
            self.attack_score += 1;
            self.loss_streak_attack = 0;
            self.loss_streak_defend += 1;
        } else if winner == WINNER_DEFEND {
            self.defend_score += 1;
            self.loss_streak_defend = 0;
            self.loss_streak_attack += 1;
        }
        self.dirty = true;

        // 经济奖励：赢家固定奖励；输家按连续失败数递增（封顶）
        for p in players.values_mut() {
            let is_winner = (winner == WINNER_ATTACK && p.team == TEAM_ATTACK)
                || (winner == WINNER_DEFEND && p.team == TEAM_DEFEND);
            if is_winner {
                p.grant_money(WIN_REWARD);
            } else {
                let streak = if p.team == TEAM_ATTACK {
                    self.loss_streak_attack
                } else {
                    self.loss_streak_defend
                };
                let reward = (LOSS_BASE + LOSS_STREAK_BONUS * streak.min(4)).min(LOSS_CAP);
                p.grant_money(reward);
            }
        }

        if self.attack_score >= self.cfg.rounds_to_win
            || self.defend_score >= self.cfg.rounds_to_win
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
            // 打满 10 回合仍未到 6 胜时按比分判定，平局保持 WINNER_NONE。
            if self.attack_score > self.defend_score {
                self.winner = WINNER_ATTACK;
            } else if self.defend_score > self.attack_score {
                self.winner = WINNER_DEFEND;
            }
            self.dirty = true;
            return;
        }
        // 半场换边：前 5 回合结束后（第 6 回合开始）攻守互换。
        if self.round_number == 6 {
            for p in players.values_mut() {
                p.team = if p.team == TEAM_ATTACK {
                    TEAM_DEFEND
                } else {
                    TEAM_ATTACK
                };
            }
        }

        self.phase = PHASE_FREEZE;
        self.time_ms = self.cfg.freeze_ms;
        self.time_remainder = 0;
        self.bomb = BOMB_NONE;
        self.winner = WINNER_NONE;
        self.reset_interaction();
        self.reset_players(players);
        self.dirty = true;
    }

    fn reset_players(&self, players: &mut HashMap<u32, Player>) {
        for p in players.values_mut() {
            let spawn = if p.team == TEAM_ATTACK {
                SPAWN_ATTACK
            } else {
                SPAWN_DEFEND
            };
            p.reset_for_round(spawn);
        }
    }

    pub fn abort_match(&mut self, players: &mut HashMap<u32, Player>) {
        self.phase = PHASE_IDLE;
        self.round_number = 0;
        self.attack_score = 0;
        self.defend_score = 0;
        self.time_ms = 0;
        self.time_remainder = 0;
        self.bomb = BOMB_NONE;
        self.winner = WINNER_NONE;
        self.match_ended = false;
        self.loss_streak_attack = 0;
        self.loss_streak_defend = 0;
        self.reset_interaction();
        self.reset_players(players);
        self.dirty = true;
    }

    fn reset_interaction(&mut self) {
        self.plant_ticks = 0;
        self.defuse_ticks = 0;
        self.plant_grace = 0;
        self.defuse_grace = 0;
        self.planter_id = None;
        self.plant_site = None;
        self.defuser_id = None;
    }

    fn advance_clock(&mut self, tick_rate: u32) {
        if tick_rate == 0 || self.time_ms == 0 {
            return;
        }
        self.time_remainder += 1000;
        let decrement = self.time_remainder / tick_rate;
        self.time_remainder %= tick_rate;
        self.time_ms = self.time_ms.saturating_sub(decrement);
    }
}

fn holds_use(inputs: &HashMap<u32, crate::protocol::InputFrame>, id: u32) -> bool {
    inputs
        .get(&id)
        .map(|f| f.buttons & BTN_USE != 0)
        .unwrap_or(false)
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

fn team_player_counts(players: &HashMap<u32, Player>) -> (u32, u32) {
    let mut attack = 0;
    let mut defend = 0;
    for p in players.values() {
        if p.team == TEAM_ATTACK {
            attack += 1;
        } else if p.team == TEAM_DEFEND {
            defend += 1;
        }
    }
    (attack, defend)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::InputFrame;

    fn input(seq: u32, buttons: u16) -> InputFrame {
        InputFrame {
            seq,
            buttons,
            yaw_delta: 0,
            pitch_delta: 0,
            forward_axis: 0,
            strafe_axis: 0,
            client_sent_at_ms: 0,
        }
    }

    fn players() -> HashMap<u32, Player> {
        let mut players = HashMap::new();
        let mut attack = Player::new(1, "attack".into(), BOMB_SITES[0]);
        attack.team = TEAM_ATTACK;
        let mut defend = Player::new(2, "defend".into(), SPAWN_DEFEND);
        defend.team = TEAM_DEFEND;
        players.insert(1, attack);
        players.insert(2, defend);
        players
    }

    #[test]
    fn round_clock_decrements_exactly_one_second_at_64hz() {
        let mut round = RoundManager::new();
        let mut players = players();
        round.begin_match(&mut players);

        for _ in 0..64 {
            round.update(&mut players, &HashMap::new(), 64);
        }
        assert_eq!(round.time_ms, round.cfg.freeze_ms - 1_000);
    }

    #[test]
    fn plant_progress_is_bound_to_player_and_site() {
        let mut round = RoundManager::new();
        let mut players = players();
        let mut second = Player::new(3, "second".into(), BOMB_SITES[1]);
        second.team = TEAM_ATTACK;
        players.insert(3, second);
        round.phase = PHASE_ACTIVE;
        round.bomb = BOMB_PLANTING;
        round.planter_id = Some(1);
        round.plant_site = Some(0);
        round.plant_ticks = 100;

        let mut inputs = HashMap::new();
        inputs.insert(3, input(1, BTN_USE));
        round.update_bomb(&mut players, &inputs, 64);

        assert_eq!(round.planter_id, Some(3));
        assert_eq!(round.plant_site, Some(1));
        assert_eq!(round.plant_ticks, 1);
    }

    #[test]
    fn plant_is_rejected_after_round_timeout() {
        let mut round = RoundManager::new();
        let mut players = players();
        round.phase = PHASE_ACTIVE;
        round.time_ms = 0;
        round.bomb = BOMB_NONE;

        let mut inputs = HashMap::new();
        inputs.insert(1, input(1, BTN_USE)); // 攻击方站在 A 点
        round.update(&mut players, &inputs, 64);

        assert_eq!(round.phase, PHASE_ROUND_END);
        assert_eq!(round.winner, WINNER_DEFEND);
        assert_eq!(round.bomb, BOMB_NONE);
    }

    #[test]
    fn defuse_cannot_finish_after_round_timeout() {
        let mut round = RoundManager::new();
        let mut players = players();
        players.get_mut(&2).unwrap().pos = BOMB_SITES[0];
        round.phase = PHASE_ACTIVE;
        round.time_ms = 0;
        round.bomb = BOMB_PLANTED;
        round.bomb_site = 0;

        let mut inputs = HashMap::new();
        inputs.insert(2, input(1, BTN_USE));
        round.update(&mut players, &inputs, 64);

        assert_eq!(round.phase, PHASE_ROUND_END);
        assert_eq!(round.winner, WINNER_ATTACK);
        assert_eq!(round.bomb, BOMB_EXPLODED);
    }
}
