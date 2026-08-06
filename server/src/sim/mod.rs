//! 服务器权威模拟：碰撞、玩家、武器、命中、回合、世界步进。

mod combat;
mod map;
mod player;
mod round;
mod weapon;
mod world;

pub use world::{World, WorldEvent};
