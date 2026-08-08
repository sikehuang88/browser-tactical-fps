//! 灰盒地图碰撞数据（AABB），与 client/src/game/map.ts 同规格。
//! 服务器权威：客户端不得修改碰撞数据穿墙/飞行（MOVE-003）。

#[derive(Clone, Copy, Debug)]
pub struct Aabb {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

pub const GROUND_Y: f32 = 0.0;
/// 进攻方出生点。
pub const SPAWN_ATTACK: [f32; 3] = [0.0, GROUND_Y, 24.0];
/// 防守方出生点。
pub const SPAWN_DEFEND: [f32; 3] = [0.0, GROUND_Y, -24.0];
/// Bomb sites: A long, B short, C mid courtyard. The round protocol still carries a site index.
pub const BOMB_SITES: [[f32; 3]; 3] = [[-14.0, 0.0, -10.0], [14.0, 0.0, -10.0], [0.0, 0.0, 0.0]];
/// 安装/拆除交互距离。
pub const PLANT_DISTANCE: f32 = 2.0;
pub const DEFUSE_DISTANCE: f32 = 2.0;
/// 购买区半径（围绕各自出生点）。
pub const BUY_ZONE_RADIUS: f32 = 5.0;

pub const ARENA_BOUNDS: Aabb = Aabb {
    min: [-28.0, -1.0, -28.0],
    max: [28.0, 10.0, 28.0],
};

/// Original desert-town three-lane blockout (must mirror client/src/game/map.ts).
pub const WALLS: [Aabb; 18] = [
    Aabb {
        min: [-24.0, 0.0, -22.0],
        max: [-19.0, 4.5, -5.0],
    },
    Aabb {
        min: [-24.0, 0.0, 3.0],
        max: [-19.0, 4.5, 22.0],
    },
    Aabb {
        min: [-19.0, 0.0, -22.0],
        max: [-8.0, 3.6, -20.0],
    },
    Aabb {
        min: [-19.0, 0.0, -14.0],
        max: [-8.0, 3.6, -12.0],
    },
    Aabb {
        min: [-19.0, 0.0, -6.0],
        max: [-8.0, 3.6, -4.0],
    },
    Aabb {
        min: [19.0, 0.0, -22.0],
        max: [24.0, 4.5, -5.0],
    },
    Aabb {
        min: [19.0, 0.0, 3.0],
        max: [24.0, 4.5, 22.0],
    },
    Aabb {
        min: [8.0, 0.0, -22.0],
        max: [19.0, 3.6, -20.0],
    },
    Aabb {
        min: [8.0, 0.0, -14.0],
        max: [19.0, 3.6, -12.0],
    },
    Aabb {
        min: [8.0, 0.0, -6.0],
        max: [19.0, 3.6, -4.0],
    },
    Aabb {
        min: [-5.0, 0.0, -8.0],
        max: [-1.0, 1.3, -2.0],
    },
    Aabb {
        min: [1.0, 0.0, 2.0],
        max: [5.0, 1.3, 8.0],
    },
    Aabb {
        min: [-12.0, 0.0, 9.0],
        max: [-5.0, 2.4, 12.0],
    },
    Aabb {
        min: [5.0, 0.0, 9.0],
        max: [12.0, 2.4, 12.0],
    },
    Aabb {
        min: [-11.0, 0.0, 21.0],
        max: [-3.0, 1.4, 24.0],
    },
    Aabb {
        min: [3.0, 0.0, 21.0],
        max: [11.0, 1.4, 24.0],
    },
    Aabb {
        min: [-11.0, 0.0, -24.0],
        max: [-3.0, 1.4, -21.0],
    },
    Aabb {
        min: [3.0, 0.0, -24.0],
        max: [11.0, 1.4, -21.0],
    },
];

pub struct Collision {
    walls: Vec<Aabb>,
    bounds: Aabb,
    ground_y: f32,
}

impl Default for Collision {
    fn default() -> Self {
        Self {
            walls: WALLS.to_vec(),
            bounds: ARENA_BOUNDS,
            ground_y: GROUND_Y,
        }
    }
}

impl Collision {
    pub fn walls(&self) -> &[Aabb] {
        &self.walls
    }

    pub fn bounds(&self) -> &Aabb {
        &self.bounds
    }

    /// 逐轴移动 + AABB 碰撞解析，返回是否落地。pos[1] 为脚底高度。
    pub fn step(
        &self,
        pos: &mut [f32; 3],
        vel: &mut [f32; 3],
        dt: f32,
        half_w: f32,
        height: f32,
    ) -> bool {
        let mut on_ground = false;

        // X 轴
        pos[0] += vel[0] * dt;
        for w in &self.walls {
            if overlaps(pos[0], pos[1], pos[2], half_w, height, w) {
                pos[0] = if vel[0] > 0.0 {
                    w.min[0] - half_w
                } else {
                    w.max[0] + half_w
                };
                vel[0] = 0.0;
            }
        }
        let min_x = self.bounds.min[0] + half_w;
        let max_x = self.bounds.max[0] - half_w;
        if pos[0] < min_x {
            pos[0] = min_x;
            if vel[0] < 0.0 {
                vel[0] = 0.0;
            }
        } else if pos[0] > max_x {
            pos[0] = max_x;
            if vel[0] > 0.0 {
                vel[0] = 0.0;
            }
        }

        // Z 轴
        pos[2] += vel[2] * dt;
        for w in &self.walls {
            if overlaps(pos[0], pos[1], pos[2], half_w, height, w) {
                pos[2] = if vel[2] > 0.0 {
                    w.min[2] - half_w
                } else {
                    w.max[2] + half_w
                };
                vel[2] = 0.0;
            }
        }
        let min_z = self.bounds.min[2] + half_w;
        let max_z = self.bounds.max[2] - half_w;
        if pos[2] < min_z {
            pos[2] = min_z;
            if vel[2] < 0.0 {
                vel[2] = 0.0;
            }
        } else if pos[2] > max_z {
            pos[2] = max_z;
            if vel[2] > 0.0 {
                vel[2] = 0.0;
            }
        }

        // Y 轴（地面）
        pos[1] += vel[1] * dt;
        if pos[1] <= self.ground_y {
            pos[1] = self.ground_y;
            vel[1] = 0.0;
            on_ground = true;
        }

        on_ground
    }
}

fn overlaps(x: f32, y: f32, z: f32, half_w: f32, height: f32, w: &Aabb) -> bool {
    x + half_w > w.min[0]
        && x - half_w < w.max[0]
        && y + height > w.min[1]
        && y < w.max[1]
        && z + half_w > w.min[2]
        && z - half_w < w.max[2]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arena_bounds_clear_outward_velocity() {
        let collision = Collision::default();
        let mut pos = [ARENA_BOUNDS.max[0] - 0.32, 0.0, 0.0];
        let mut vel = [8.0, 0.0, 0.0];
        collision.step(&mut pos, &mut vel, 1.0 / 64.0, 0.32, 1.8);
        assert_eq!(pos[0], ARENA_BOUNDS.max[0] - 0.32);
        assert_eq!(vel[0], 0.0);
    }
}
