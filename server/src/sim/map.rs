//! 灰盒地图碰撞数据（AABB），与 client/src/game/map.ts 同规格。
//! 服务器权威：客户端不得修改碰撞数据穿墙/飞行（MOVE-003）。

#[derive(Clone, Copy, Debug)]
pub struct Aabb {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

pub const GROUND_Y: f32 = 0.0;
pub const SPAWN: [f32; 3] = [0.0, GROUND_Y, 8.0];

pub const ARENA_BOUNDS: Aabb = Aabb {
    min: [-24.0, -1.0, -24.0],
    max: [24.0, 8.0, 24.0],
};

/// 内部掩体（与客户端 WALLS 一致）。
pub const WALLS: [Aabb; 6] = [
    Aabb { min: [-8.0, 0.0, -2.0], max: [-6.0, 2.4, 4.0] },
    Aabb { min: [6.0, 0.0, -6.0], max: [9.0, 2.2, -4.0] },
    Aabb { min: [-4.0, 0.0, 10.0], max: [-1.0, 3.0, 12.0] },
    Aabb { min: [3.0, 0.0, 4.0], max: [5.0, 1.2, 7.0] },
    Aabb { min: [-12.0, 0.0, -8.0], max: [-10.0, 4.0, -6.0] },
    Aabb { min: [-2.0, 0.0, -12.0], max: [1.0, 2.0, -9.0] },
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
                pos[0] = if vel[0] > 0.0 { w.min[0] - half_w } else { w.max[0] + half_w };
                vel[0] = 0.0;
            }
        }
        pos[0] = clamp(pos[0], self.bounds.min[0] + half_w, self.bounds.max[0] - half_w);

        // Z 轴
        pos[2] += vel[2] * dt;
        for w in &self.walls {
            if overlaps(pos[0], pos[1], pos[2], half_w, height, w) {
                pos[2] = if vel[2] > 0.0 { w.min[2] - half_w } else { w.max[2] + half_w };
                vel[2] = 0.0;
            }
        }
        pos[2] = clamp(pos[2], self.bounds.min[2] + half_w, self.bounds.max[2] - half_w);

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

fn clamp(v: f32, min: f32, max: f32) -> f32 {
    v.max(min).min(max)
}
