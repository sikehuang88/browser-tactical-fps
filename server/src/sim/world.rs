//! 世界：玩家集合 + 碰撞 + 战斗 + 回合 + 位置历史（延迟补偿）。
//! 每 tick 由 run_tick_loop 驱动，产出需广播给客户端的事件。

use std::collections::{HashMap, VecDeque};

use super::combat::{apply_damage, fire_hitscan, forward_dir, HitZone, PlayerView, SmokeBlocker};
use super::grenade::{fuse_ticks, step_grenade, Grenade, THROW_SPEED};
use super::map::{Collision, BUY_ZONE_RADIUS, SPAWN_ATTACK, SPAWN_DEFEND};
use super::player::Player;
use super::round::RoundManager;
use super::weapon::{
    get_weapon, grenade_slot, laser_damage_ratio, shop_item, ShopKind, KILL_REWARD,
    LASER_CHARGE_MAX_MS, LASER_CHARGE_MIN_MS, MAX_GRENADES_PER_TYPE, WEAPON_LASER_CANNON,
};
use crate::protocol::{
    DamageMsg, EconomyMsg, GrenadeExplodeMsg, GrenadeSpawnMsg, InputFrame, KillFeedMsg,
    RoundStateMsg, SnapshotEntity, BTN_ATTACK, BTN_EQUIP_FIREARM, BTN_EQUIP_KNIFE,
    BTN_EQUIP_SECONDARY, BTN_RELOAD, BTN_THROW_FLASH, BTN_THROW_HE, BTN_THROW_SMOKE, GRENADE_FLASH,
    GRENADE_HE, GRENADE_SMOKE, PHASE_ACTIVE, PHASE_FREEZE, PHASE_ROUND_END, TEAM_ATTACK,
    TEAM_DEFEND,
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
        // Keep teams balanced even when players disconnect and reconnect.
        let attack = self
            .players
            .values()
            .filter(|p| p.team == TEAM_ATTACK)
            .count();
        let defend = self
            .players
            .values()
            .filter(|p| p.team == TEAM_DEFEND)
            .count();
        let team = if attack <= defend {
            TEAM_ATTACK
        } else {
            TEAM_DEFEND
        };
        let spawn = if team == TEAM_ATTACK {
            SPAWN_ATTACK
        } else {
            SPAWN_DEFEND
        };
        let mut p = Player::new(id, name, spawn);
        p.team = team;
        if team == TEAM_DEFEND {
            p.yaw = 180.0; // 防守方面向进攻方
        }
        if self.round.phase == PHASE_ACTIVE || self.round.phase == PHASE_ROUND_END {
            p.alive = false;
            p.health = 0;
        }
        self.players.insert(id, p);
        log::info!("玩家 {id} ({team}) 加入，当前 {} 人", self.players.len());
    }

    pub fn remove_player(&mut self, id: u32) {
        self.players.remove(&id);
        self.history.remove(&id);
        self.grenades.retain(|_, g| g.owner != id);
        if self.players.is_empty() {
            self.round = RoundManager::new();
            self.prev_match_ended = false;
            self.pending_events.clear();
            self.smokes.clear();
        } else {
            let attack = self.players.values().any(|p| p.team == TEAM_ATTACK);
            let defend = self.players.values().any(|p| p.team == TEAM_DEFEND);
            if !attack || !defend {
                self.round.abort_match(&mut self.players);
            }
        }
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    /// 注册成功后立即向所有玩家同步当前回合状态，并向新玩家下发经济，
    /// 避免中途加入者显示 Round 0 / 资金 0。
    pub fn notify_registered(&mut self, player_id: u32) {
        self.pending_events
            .push(WorldEvent::RoundState(self.round_state_msg()));
        if let Some(p) = self.players.get(&player_id) {
            self.pending_events
                .push(WorldEvent::Economy(player_id, economy_msg_of(p)));
        }
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
        let mut pressed: HashMap<u32, u16> = HashMap::new();
        let input_timeout_ticks = (self.tick_rate / 4).max(1);
        for p in self.players.values_mut() {
            let (input, new_presses) = p.input_for_tick(input_timeout_ticks);
            if new_presses != 0 {
                pressed.insert(p.id, new_presses);
            }
            if let Some(frame) = input {
                inputs.insert(p.id, frame);
            }
        }

        // 2) 移动（仅存活；冻结阶段可转身不可移动）+ 位置历史
        for (id, p) in self.players.iter_mut() {
            if !p.alive {
                continue;
            }
            let switch = pressed.get(id).copied().unwrap_or(0)
                & (BTN_EQUIP_FIREARM | BTN_EQUIP_SECONDARY | BTN_EQUIP_KNIFE);
            if switch != 0 {
                p.apply_weapon_switch(switch);
            }
            if let Some(inp) = inputs.get(id) {
                p.apply_view(inp);
                if movement_allowed {
                    p.apply_movement(
                        inp,
                        pressed.get(id).copied().unwrap_or(0),
                        dt,
                        &self.collision,
                    );
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
            self.run_weapons(&inputs, &pressed, &mut events);
            self.run_grenades(&inputs, &pressed, &mut events);
        }
        self.update_grenades(dt, &mut events);
        self.smokes.retain(|s| s.until_tick > self.tick);

        // 4) 回合推进
        self.round
            .update(&mut self.players, &inputs, self.tick_rate);
        if self.round.dirty {
            log::info!(
                "回合状态变更: phase={} round={} bomb={}",
                self.round.phase,
                self.round.round_number,
                self.round.bomb
            );
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

    fn run_weapons(
        &mut self,
        inputs: &HashMap<u32, InputFrame>,
        pressed: &HashMap<u32, u16>,
        events: &mut Vec<WorldEvent>,
    ) {
        // 换弹（含空弹匣自动换弹）
        for p in self.players.values_mut() {
            if !p.alive {
                continue;
            }
            p.tick_reload();
            if let Some(inp) = inputs.get(&p.id) {
                let spec = p.weapon_spec();
                if spec.melee {
                    continue;
                }
                let reload_ticks = (spec.reload_ms * self.tick_rate / 1000).max(1);
                let wants_reload = (inp.buttons & BTN_RELOAD != 0 && p.ammo < spec.mag_size)
                    || (inp.buttons & BTN_ATTACK != 0 && p.ammo == 0);
                if wants_reload && !p.reloading {
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
            .map(|s| SmokeBlocker {
                pos: s.pos,
                radius: s.radius,
            })
            .collect();

        // 开火（统计本次扣弹量，结算阶段统一写入，避免双重借用）
        let mut fired: Vec<(u32, u32, u32, Option<super::combat::Hit>)> = Vec::new();
        let laser_max_ticks = (LASER_CHARGE_MAX_MS * self.tick_rate / 1000).max(1);
        let laser_min_ticks = (LASER_CHARGE_MIN_MS * self.tick_rate / 1000).max(1);

        // 激光炮：按住蓄力，松手释放（服务器权威）。
        for p in self.players.values_mut() {
            if !p.alive || p.weapon_id != WEAPON_LASER_CANNON {
                continue;
            }
            let held = inputs
                .get(&p.id)
                .map(|f| f.buttons & BTN_ATTACK != 0)
                .unwrap_or(false);
            if held && p.ammo > 0 && !p.reloading {
                p.charge_ticks = p.charge_ticks.saturating_add(1).min(laser_max_ticks);
            } else {
                if p.charge_ticks >= laser_min_ticks && p.ammo > 0 && !p.reloading {
                    if let Some(v) = views.iter().find(|v| v.id == p.id) {
                        if self.tick >= v.next_fire_tick {
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
                            fired.push((p.id, p.weapon_id, p.charge_ticks, hit));
                        }
                    }
                }
                p.charge_ticks = 0;
            }
        }

        for v in &views {
            if !v.alive {
                continue;
            }
            if let Some(inp) = inputs.get(&v.id) {
                let spec = get_weapon(v.weapon_id);
                if v.weapon_id == WEAPON_LASER_CANNON {
                    continue; // 激光炮走蓄力释放逻辑
                }
                let attack = if spec.automatic {
                    inp.buttons & BTN_ATTACK != 0
                } else {
                    pressed.get(&v.id).copied().unwrap_or(0) & BTN_ATTACK != 0
                };
                if attack
                    && (spec.melee || v.ammo > 0)
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
                    fired.push((v.id, v.weapon_id, 0, hit));
                }
            }
        }

        // 结算（弹药/射速 + 伤害/击杀）
        for (shooter_id, weapon_id, charge_ticks, hit) in fired {
            let spec = get_weapon(weapon_id);
            let interval = (spec.fire_interval_ms as u64 * self.tick_rate as u64 / 1000).max(1);
            if let Some(shooter) = self.players.get_mut(&shooter_id) {
                shooter.record_fire(self.tick, interval, !spec.melee);
            }
            if let Some(hit) = hit {
                let mut damage = hit.damage;
                if weapon_id == WEAPON_LASER_CANNON {
                    damage *= laser_damage_ratio(charge_ticks, laser_min_ticks, laser_max_ticks);
                }
                self.resolve_damage(
                    shooter_id,
                    hit.victim_id,
                    damage,
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
    #[allow(clippy::too_many_arguments)] // 结算上下文较长，后续可收敛为 Context 结构体
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
    fn run_grenades(
        &mut self,
        inputs: &HashMap<u32, InputFrame>,
        pressed: &HashMap<u32, u16>,
        events: &mut Vec<WorldEvent>,
    ) {
        let mut thrown: Vec<(u32, u8)> = Vec::new(); // (player, kind)
        for (id, p) in self.players.iter() {
            if !p.alive {
                continue;
            }
            let Some(_) = inputs.get(id) else { continue };
            let buttons = pressed.get(id).copied().unwrap_or(0);
            let kind = if buttons & BTN_THROW_SMOKE != 0 {
                Some(GRENADE_SMOKE)
            } else if buttons & BTN_THROW_FLASH != 0 {
                Some(GRENADE_FLASH)
            } else if buttons & BTN_THROW_HE != 0 {
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
                id: g.id,
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
            let Some(g) = self.grenades.remove(&id) else {
                continue;
            };
            let pos = g.pos;
            events.push(WorldEvent::GrenadeExplode(GrenadeExplodeMsg {
                id: g.id,
                kind: g.kind,
                pos,
            }));
            match g.kind {
                GRENADE_HE => {
                    // 爆炸伤害：半径 6m，中心 98，随距离衰减；不伤投掷者
                    let radius = 6.0;
                    let victims: Vec<u32> = self
                        .players
                        .iter()
                        .filter(|(id, p)| {
                            **id != g.owner && p.alive && dist2(p.pos, pos) <= radius * radius
                        })
                        .map(|(id, _)| *id)
                        .collect();
                    for vid in victims {
                        let d = dist2(self.players.get(&vid).unwrap().pos, pos).sqrt();
                        let dmg = 98.0 * (1.0 - d / radius).max(0.0);
                        let mut origin = self.players.get(&vid).unwrap().pos;
                        origin[1] += 1.0;
                        if segment_blocked(origin, pos, &walls) {
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
                            let mut dir = [
                                pos[0] - p.pos[0],
                                pos[1] - (p.pos[1] + 1.6),
                                pos[2] - p.pos[2],
                            ];
                            let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
                            if len < 1e-4 {
                                return None;
                            }
                            let eye = [
                                p.pos[0],
                                p.pos[1] + if p.crouching { 1.2 } else { 1.6 },
                                p.pos[2],
                            ];
                            if segment_blocked(eye, pos, &walls) {
                                return None;
                            }
                            for v in dir.iter_mut() {
                                *v /= len;
                            }
                            let fwd = forward_dir(p.yaw, p.pitch);
                            let dot = fwd[0] * dir[0] + fwd[1] * dir[1] + fwd[2] * dir[2];
                            if dot <= 0.0 {
                                return None;
                            }
                            let strength = (100.0 * (1.0 - d / radius) * (0.3 + 0.7 * dot))
                                .clamp(0.0, 100.0) as u8;
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
            time_ms: self.round.time_ms,
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
        let spawn = if player.team == TEAM_ATTACK {
            SPAWN_ATTACK
        } else {
            SPAWN_DEFEND
        };
        let dx = player.pos[0] - spawn[0];
        let dz = player.pos[2] - spawn[2];
        if dx * dx + dz * dz > BUY_ZONE_RADIUS * BUY_ZONE_RADIUS {
            return false;
        }
        match item.kind {
            ShopKind::Weapon(wid) => {
                if player.weapon_refund == Some((wid, item.cost)) && player.firearm_weapon_id == wid
                {
                    player.set_primary(super::weapon::WEAPON_P9);
                    player.weapon_refund = None;
                    player.grant_money(item.cost);
                } else {
                    if !player.spend_money(item.cost) {
                        return false;
                    }
                    player.set_primary(wid);
                    player.weapon_refund = Some((wid, item.cost));
                }
            }
            ShopKind::Armor => {
                if player.armor > 0 {
                    return false;
                }
                if !player.spend_money(item.cost) {
                    return false;
                }
                player.armor = 100;
            }
            ShopKind::Grenade(kind) => {
                let slot = grenade_slot(kind);
                if player.grenades[slot] >= MAX_GRENADES_PER_TYPE {
                    return false;
                }
                if !player.spend_money(item.cost) {
                    return false;
                }
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

fn segment_blocked(origin: [f32; 3], target: [f32; 3], walls: &[super::map::Aabb]) -> bool {
    let delta = [
        target[0] - origin[0],
        target[1] - origin[1],
        target[2] - origin[2],
    ];
    walls.iter().any(|wall| {
        crate::sim::combat::ray_aabb(origin, delta, wall).is_some_and(|t| t > 0.001 && t < 0.999)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BOMB_PLANTED, BTN_ATTACK, BTN_THROW_SMOKE};
    use crate::sim::weapon::{SHOP_RIFLE, WEAPON_LASER_CANNON, WEAPON_P9, WEAPON_R1};

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

    fn active_world() -> World {
        let mut world = World::new(64);
        world.add_player(1, "attack".into());
        world.add_player(2, "defend".into());
        world.round.begin_match(&mut world.players);
        world.round.phase = PHASE_ACTIVE;
        world.round.time_ms = 90_000;
        world.round.dirty = false;
        world
    }

    #[test]
    fn weapon_refund_never_creates_money() {
        let mut world = active_world();
        world.round.phase = PHASE_FREEZE;
        world.players.get_mut(&1).unwrap().money = 6_000;

        assert!(world.buy(1, SHOP_RIFLE));
        assert_eq!(world.players[&1].money, 3_300);
        assert_eq!(world.players[&1].weapon_id, WEAPON_R1);

        assert!(world.buy(1, SHOP_RIFLE));
        assert_eq!(world.players[&1].money, 6_000);
        assert_eq!(world.players[&1].weapon_id, WEAPON_P9);

        assert!(world.buy(1, SHOP_RIFLE));
        assert_eq!(world.players[&1].money, 3_300);
    }

    #[test]
    fn held_grenade_button_throws_once() {
        let mut world = active_world();
        world.players.get_mut(&1).unwrap().grenades[0] = 3;

        world.set_input(1, input(1, BTN_THROW_SMOKE));
        world.step(1.0 / 64.0);
        assert_eq!(world.grenades.len(), 1);
        assert_eq!(world.players[&1].grenades[0], 2);

        world.set_input(1, input(2, BTN_THROW_SMOKE));
        world.step(1.0 / 64.0);
        assert_eq!(world.grenades.len(), 1);
        assert_eq!(world.players[&1].grenades[0], 2);
    }

    #[test]
    fn semiautomatic_weapon_requires_a_new_press() {
        let mut world = active_world();
        assert_eq!(world.players[&1].weapon_id, WEAPON_P9);

        world.set_input(1, input(1, BTN_ATTACK));
        world.step(1.0 / 64.0);
        assert_eq!(world.players[&1].ammo, 11);

        for seq in 2..20 {
            world.set_input(1, input(seq, BTN_ATTACK));
            world.step(1.0 / 64.0);
        }
        assert_eq!(world.players[&1].ammo, 11);

        world.set_input(1, input(20, 0));
        world.step(1.0 / 64.0);
        world.set_input(1, input(21, BTN_ATTACK));
        world.step(1.0 / 64.0);
        assert_eq!(world.players[&1].ammo, 10);
    }

    #[test]
    fn laser_charges_while_held_and_fires_on_release() {
        let mut world = active_world();
        world.players.get_mut(&1).unwrap().weapon_id = WEAPON_LASER_CANNON;
        world.players.get_mut(&1).unwrap().ammo = 10;

        // 按住蓄力：不消耗弹药
        for seq in 1..=64 {
            world.set_input(1, input(seq, BTN_ATTACK));
            world.step(1.0 / 64.0);
        }
        assert_eq!(world.players[&1].ammo, 10);
        assert!(world.players[&1].charge_ticks > 0);

        // 松手释放：消耗一发
        world.set_input(1, input(65, 0));
        world.step(1.0 / 64.0);
        assert_eq!(world.players[&1].ammo, 9);
        assert_eq!(world.players[&1].charge_ticks, 0);
    }

    #[test]
    fn planted_bomb_survives_attacker_elimination() {
        let mut world = active_world();
        world.round.bomb = BOMB_PLANTED;
        world.round.time_ms = 40_000;
        let attacker = world.players.get_mut(&1).unwrap();
        attacker.alive = false;
        attacker.health = 0;

        world.step(1.0 / 64.0);
        assert_eq!(world.round.phase, PHASE_ACTIVE);
        assert_eq!(world.round.bomb, BOMB_PLANTED);
    }

    #[test]
    fn reconnect_balances_the_missing_team() {
        let mut world = active_world();
        world.remove_player(1);
        world.add_player(3, "replacement".into());

        assert_eq!(world.players[&2].team, TEAM_DEFEND);
        assert_eq!(world.players[&3].team, TEAM_ATTACK);
    }

    #[test]
    fn segment_occlusion_uses_fractional_ray_parameter() {
        let wall = super::super::map::Aabb {
            min: [2.0, 0.0, -1.0],
            max: [3.0, 2.0, 1.0],
        };
        assert!(segment_blocked([0.0, 1.0, 0.0], [5.0, 1.0, 0.0], &[wall]));
        assert!(!segment_blocked([0.0, 1.0, 0.0], [1.0, 1.0, 0.0], &[wall]));
    }
}
