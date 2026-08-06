//! 世界：玩家集合 + 碰撞 + 战斗 + 回合 + 位置历史（延迟补偿）。
//! 每 tick 由 run_tick_loop 驱动，产出需广播给客户端的事件。

use std::collections::{HashMap, VecDeque};

use super::combat::{apply_damage, fire_hitscan, forward_dir, HitZone, PlayerView, SmokeBlocker};
use super::grenade::{fuse_ticks, step_grenade, Grenade, THROW_SPEED};
use super::map::{Collision, BUY_ZONE_RADIUS, SPAWN_ATTACK, SPAWN_DEFEND};
use super::player::Player;
use super::round::RoundManager;
use super::weapon::{
    get_weapon, grenade_slot, shop_item, ShopKind, KILL_REWARD, MAX_GRENADES_PER_TYPE,
};
use crate::protocol::{
    BTN_ATTACK, BTN_RELOAD, BTN_THROW_FLASH, BTN_THROW_HE, BTN_THROW_SMOKE, DamageMsg,
    EconomyMsg, GrenadeExplodeMsg, GrenadeSpawnMsg, GRENADE_FLASH, GRENADE_HE, GRENADE_SMOKE,
    InputFrame, KillFeedMsg, RoundStateMsg, SnapshotEntity, TEAM_ATTACK, TEAM_DEFEND, PHASE_ACTIVE,
    PHASE_FREEZE,
};

/// 世界向连接层广播的事件。
pub enum WorldEvent {
    KillFeed(KillFeedMsg),
    RoundState(RoundStateMsg),
    MatchEnd(u8, u8, u8),     // winner, attack_score, defend_score
    Damage(u32, DamageMsg),   // to_player_id, msg
    Economy(u32, EconomyMsg), // to_player_id, msg
    GrenadeSpawn(GrenadeSpawnMsg),
    GrenadeExplode(GrenadeExplodeMsg),
    Flash(u32, u8), // player_id, strength 0..100
}

/// 烟雾云（阻挡命中 + 客户端视觉）。
pub struct SmokeCloud {
    pub pos: [f32; 3],
    pub radius: f32,
    pub until_tick: u64,
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
    /// 非 step 路径产生的事件（如购买）在下次 step 时随事件一并产出。
    pending_events: Vec<WorldEvent>,
    grenades: HashMap<u32, Grenade>,
    smokes: Vec<SmokeCloud>,
    next_grenade_id: u32,
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
            pending_events: Vec::new(),
            grenades: HashMap::new(),
            smokes: Vec::new(),
            next_grenade_id: 0,
        }
    }

    pub fn add_player(&mut self, id: u32, name: String) {
        // 按加入顺序奇偶分配队伍（1、3、5… 进攻；2、4… 防守），加入即稳定
        let team = if self.players.len() % 2 == 0 { TEAM_ATTACK } else { TEAM_DEFEND };
        let spawn = if team == TEAM_ATTACK { SPAWN_ATTACK } else { SPAWN_DEFEND };
        let mut p = Player::new(id, name, spawn);
        p.team = team;
        if team == TEAM_DEFEND {
            p.yaw = 180.0; // 防守方面向进攻方
        }
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

    /// 步进一个 tick：输入 → 移动/历史 → 换弹/开火/命中 → 投掷物 → 回合推进。
    pub fn step(&mut self, dt: f32) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        events.append(&mut std::mem::take(&mut self.pending_events));
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

        // 3) 换弹/开火/投掷（仅行动阶段）+ 投掷物推进
        if movement_allowed {
            self.run_weapons(&inputs, &mut events);
            self.run_grenades(&inputs, &mut events);
        }
        self.update_grenades(dt, &mut events);
        self.smokes.retain(|s| s.until_tick > self.tick);

        // 4) 回合推进
        self.round.update(&mut self.players, &inputs, self.tick_rate);
        if self.round.dirty {
            log::info!("回合状态变更: phase={} round={} bomb={}", self.round.phase, self.round.round_number, self.round.bomb);
            events.push(WorldEvent::RoundState(self.round_state_msg()));
            self.round.dirty = false;
            // 回合切换时向所有玩家下发经济（资金可能已因胜负/奖励变化）
            for id in self.players.keys().copied().collect::<Vec<u32>>() {
                if let Some(p) = self.players.get(&id) {
                    events.push(WorldEvent::Economy(id, economy_msg_of(p)));
                }
            }
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

        // 视图快照（只读，供命中检测）+ 烟雾阻挡
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
        let smokes: Vec<SmokeBlocker> = self
            .smokes
            .iter()
            .map(|s| SmokeBlocker { pos: s.pos, radius: s.radius })
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
                        &smokes,
                        &self.history,
                        self.tick,
                        self.tick_rate,
                    );
                    fired.push((v.id, v.weapon_id, hit));
                }
            }
        }

        // 结算（弹药/射速 + 伤害/击杀）
        for (shooter_id, weapon_id, hit) in fired {
            let spec = get_weapon(weapon_id);
            let interval = (spec.fire_interval_ms as u64 * self.tick_rate as u64 / 1000).max(1);
            if let Some(shooter) = self.players.get_mut(&shooter_id) {
                shooter.consume_fire(self.tick, interval);
            }
            if let Some(hit) = hit {
                self.resolve_damage(
                    shooter_id,
                    hit.victim_id,
                    hit.damage,
                    hit.zone,
                    weapon_id,
                    hit.headshot,
                    hit.distance_m,
                    events,
                );
            }
        }
    }

    /// 统一的伤害/击杀结算（武器与手雷共用）：伤害 → 死亡 → 击杀奖励/播报。
    fn resolve_damage(
        &mut self,
        attacker: u32,
        victim_id: u32,
        dmg: f32,
        zone: HitZone,
        weapon_id: u32,
        headshot: bool,
        distance_m: f32,
        events: &mut Vec<WorldEvent>,
    ) {
        let (dealt, victim_health, victim_died) = {
            let victim = match self.players.get_mut(&victim_id) {
                Some(v) => v,
                None => return,
            };
            let dealt = apply_damage(victim, dmg, zone);
            (dealt, victim.health as u16, !victim.alive)
        };
        events.push(WorldEvent::Damage(
            attacker,
            DamageMsg {
                victim_id,
                damage: dealt,
                victim_health,
            },
        ));
        if !victim_died {
            return;
        }
        if let Some(v) = self.players.get_mut(&victim_id) {
            v.deaths += 1;
        }
        if let Some(k) = self.players.get_mut(&attacker) {
            k.kills += 1;
            k.grant_money(KILL_REWARD);
            let em = economy_msg_of(k);
            events.push(WorldEvent::Economy(attacker, em));
        }
        events.push(WorldEvent::KillFeed(KillFeedMsg {
            attacker_id: attacker,
            victim_id,
            weapon_id: weapon_id as u8,
            flags: if headshot { 1 } else { 0 },
            distance_cm: (distance_m * 100.0) as u16,
        }));
    }

    /// 投掷：按投掷按钮生成手雷（仅行动阶段）。
    fn run_grenades(&mut self, inputs: &HashMap<u32, InputFrame>, events: &mut Vec<WorldEvent>) {
        let mut thrown: Vec<(u32, u8)> = Vec::new(); // (player, kind)
        for (id, p) in self.players.iter() {
            if !p.alive {
                continue;
            }
            let Some(inp) = inputs.get(id) else { continue };
            let kind = if inp.buttons & BTN_THROW_SMOKE != 0 {
                Some(GRENADE_SMOKE)
            } else if inp.buttons & BTN_THROW_FLASH != 0 {
                Some(GRENADE_FLASH)
            } else if inp.buttons & BTN_THROW_HE != 0 {
                Some(GRENADE_HE)
            } else {
                None
            };
            if let Some(kind) = kind {
                let slot = grenade_slot(kind);
                if p.grenades[slot] > 0 {
                    thrown.push((*id, kind));
                }
            }
        }

        for (pid, kind) in thrown {
            let (pos, dir, pvel) = {
                let p = self.players.get(&pid).unwrap();
                let eye = [
                    p.pos[0],
                    p.pos[1] + if p.crouching { 1.2 } else { 1.6 },
                    p.pos[2],
                ];
                let dir = forward_dir(p.yaw, p.pitch);
                (eye, dir, p.vel)
            };
            let slot = grenade_slot(kind);
            if let Some(p) = self.players.get_mut(&pid) {
                p.grenades[slot] = p.grenades[slot].saturating_sub(1);
                let em = economy_msg_of(p);
                events.push(WorldEvent::Economy(pid, em));
            }
            self.next_grenade_id += 1;
            let vel = [
                dir[0] * THROW_SPEED + pvel[0] * 0.3,
                dir[1] * THROW_SPEED + pvel[1] * 0.3,
                dir[2] * THROW_SPEED + pvel[2] * 0.3,
            ];
            let g = Grenade {
                id: self.next_grenade_id,
                kind,
                owner: pid,
                pos,
                vel,
                age_ticks: 0,
                rest_ticks: 0,
                fuse_total: fuse_ticks(kind, self.tick_rate),
            };
            events.push(WorldEvent::GrenadeSpawn(GrenadeSpawnMsg {
                kind,
                owner_id: pid,
                pos,
                vel,
            }));
            self.grenades.insert(g.id, g);
        }
    }

    /// 推进所有手雷并处理触发效果（爆炸/烟雾/闪光）。
    fn update_grenades(&mut self, dt: f32, events: &mut Vec<WorldEvent>) {
        let walls = self.collision.walls().to_vec();
        let mut triggered: Vec<u32> = Vec::new();
        for g in self.grenades.values_mut() {
            if step_grenade(g, dt, &walls) {
                triggered.push(g.id);
            }
        }
        for id in triggered {
            let Some(g) = self.grenades.remove(&id) else { continue };
            let pos = g.pos;
            events.push(WorldEvent::GrenadeExplode(GrenadeExplodeMsg { kind: g.kind, pos }));
            match g.kind {
                GRENADE_HE => {
                    // 爆炸伤害：半径 6m，中心 98，随距离衰减；不伤投掷者
                    let radius = 6.0;
                    let victims: Vec<u32> = self
                        .players
                        .iter()
                        .filter(|(id, p)| **id != g.owner && p.alive && dist2(p.pos, pos) <= radius * radius)
                        .map(|(id, _)| *id)
                        .collect();
                    for vid in victims {
                        let d = dist2(self.players.get(&vid).unwrap().pos, pos).sqrt();
                        let dmg = 98.0 * (1.0 - d / radius).max(0.0);
                        // 掩体阻挡（简化为直线穿透判定）
                        let origin = self.players.get(&vid).unwrap().pos;
                        if let Some(wt) = crate::sim::combat::ray_aabb(origin, [pos[0]-origin[0], pos[1]-origin[1], pos[2]-origin[2]], self.collision.bounds()) {
                            let dir_len = dist2(pos, origin).sqrt();
                            if wt < dir_len - 0.1 {
                                continue;
                            }
                        }
                        let mut blocked = false;
                        for wall in &walls {
                            let dir = [pos[0]-origin[0], pos[1]-origin[1], pos[2]-origin[2]];
                            if let Some(wt) = crate::sim::combat::ray_aabb(origin, dir, wall) {
                                if wt < dist2(pos, origin).sqrt() - 0.1 {
                                    blocked = true;
                                    break;
                                }
                            }
                        }
                        if blocked {
                            continue;
                        }
                        self.resolve_damage(g.owner, vid, dmg, HitZone::Body, 0, false, d, events);
                    }
                }
                GRENADE_SMOKE => {
                    self.smokes.push(SmokeCloud {
                        pos,
                        radius: 2.5,
                        until_tick: self.tick + 15 * self.tick_rate as u64,
                    });
                }
                GRENADE_FLASH => {
                    // 闪光：半径 20m，朝向判定
                    let radius = 20.0;
                    let affected: Vec<(u32, u8)> = self
                        .players
                        .iter()
                        .filter(|(_, p)| p.alive && dist2(p.pos, pos) <= radius * radius)
                        .filter_map(|(id, p)| {
                            let d = dist2(p.pos, pos).sqrt();
                            let mut dir = [pos[0]-p.pos[0], pos[1]-(p.pos[1]+1.6), pos[2]-p.pos[2]];
                            let len = (dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]).sqrt();
                            if len < 1e-4 {
                                return None;
                            }
                            for v in dir.iter_mut() { *v /= len; }
                            let fwd = forward_dir(p.yaw, p.pitch);
                            let dot = fwd[0]*dir[0] + fwd[1]*dir[1] + fwd[2]*dir[2];
                            if dot <= 0.0 {
                                return None;
                            }
                            let strength = (100.0 * (1.0 - d / radius) * (0.3 + 0.7 * dot)).clamp(0.0, 100.0) as u8;
                            Some((*id, strength))
                        })
                        .collect();
                    for (pid, strength) in affected {
                        events.push(WorldEvent::Flash(pid, strength));
                    }
                }
                _ => {}
            }
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

    /// 购买/退款请求（服务器权威：冻结期 + 购买区 + 资金校验，GAME-003）。
    pub fn buy(&mut self, player_id: u32, item_id: u8) -> bool {
        if self.round.phase != PHASE_FREEZE {
            return false;
        }
        let item = match shop_item(item_id) {
            Some(i) => i,
            None => return false,
        };
        let player = match self.players.get_mut(&player_id) {
            Some(p) => p,
            None => return false,
        };
        if !player.alive {
            return false;
        }
        // 购买区：围绕各自出生点
        let spawn = if player.team == TEAM_ATTACK { SPAWN_ATTACK } else { SPAWN_DEFEND };
        let dx = player.pos[0] - spawn[0];
        let dz = player.pos[2] - spawn[2];
        if dx * dx + dz * dz > BUY_ZONE_RADIUS * BUY_ZONE_RADIUS {
            return false;
        }
        if player.money < item.cost {
            return false;
        }

        match item.kind {
            ShopKind::Weapon(wid) => {
                if player.weapon_id == wid {
                    // 退款窗口：重复购买同款武器即退款
                    player.grant_money(item.cost);
                } else {
                    player.spend_money(item.cost);
                    player.set_primary(wid);
                }
            }
            ShopKind::Armor => {
                if player.armor > 0 {
                    return false;
                }
                player.spend_money(item.cost);
                player.armor = 100;
            }
            ShopKind::Grenade(kind) => {
                let slot = grenade_slot(kind);
                if player.grenades[slot] >= MAX_GRENADES_PER_TYPE {
                    return false;
                }
                player.spend_money(item.cost);
                player.grenades[slot] += 1;
            }
        }

        let em = economy_msg_of(player);
        self.pending_events.push(WorldEvent::Economy(player_id, em));
        true
    }
}

fn economy_msg_of(p: &Player) -> EconomyMsg {
    EconomyMsg {
        player_id: p.id,
        money: p.money.min(u16::MAX as u32) as u16,
        weapon_id: p.weapon_id as u8,
        armor: if p.armor > 0 { 1 } else { 0 },
        n_smoke: p.grenades[0] as u8,
        n_flash: p.grenades[1] as u8,
        n_he: p.grenades[2] as u8,
    }
}

fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}
