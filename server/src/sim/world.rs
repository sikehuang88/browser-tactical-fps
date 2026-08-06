//! 世界：玩家集合 + 碰撞 + 每 tick 步进与快照生成。
//! M0 单实例服务全部玩家（10 人）；兴趣管理/分区分房间为后续里程碑。

use std::collections::HashMap;

use super::map::{Collision, SPAWN};
use super::player::Player;
use crate::protocol::{InputFrame, SnapshotEntity};

pub struct World {
    players: HashMap<u32, Player>,
    collision: Collision,
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

impl World {
    pub fn new() -> Self {
        Self {
            players: HashMap::new(),
            collision: Collision::default(),
        }
    }

    pub fn add_player(&mut self, id: u32, name: String) {
        self.players.insert(id, Player::new(id, name.clone(), SPAWN));
        log::info!("玩家 {id} ({name}) 加入，当前 {} 人", self.players.len());
    }

    pub fn remove_player(&mut self, id: u32) {
        self.players.remove(&id);
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn set_input(&mut self, id: u32, frame: InputFrame) {
        if let Some(p) = self.players.get_mut(&id) {
            p.set_input(frame);
        }
    }

    /// 步进一个 tick。每玩家应用其最新输入；无输入则仅施加重力。
    pub fn step(&mut self, dt: f32) {
        for p in self.players.values_mut() {
            let input = p.take_input();
            p.step(dt, &self.collision, input);
        }
    }

    /// 生成按 id 排序的快照实体（保证确定性）。
    pub fn snapshot(&self) -> Vec<SnapshotEntity> {
        let mut ids: Vec<u32> = self.players.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter()
            .filter_map(|id| self.players.get(&id))
            .map(Player::snapshot_entity)
            .collect()
    }
}
