# 实时游戏服务器（Rust）

64 tick/s 服务器权威模拟 + WebSocket 接入。移动、命中、经济、回合结果均以本服务器为准（客户端只提交输入帧）。

## 运行

```bash
cargo run -- --port 9000 --tick-rate 64
# 可选参数：
#   --tick-rate 32|64|128  模拟频率（压测环境可切换）
#   --max-players 10       单实例上限
```

## 结构

```
src/
├── main.rs        # 入口：监听、启动 tick 循环
├── config.rs      # 命令行配置
├── protocol.rs    # M0 引导线格式编解码（与客户端同规格）
├── server.rs      # 连接握手、读写循环、tick 循环、广播
├── sim/           # 服务器权威模拟
│   ├── map.rs     # AABB 碰撞（与客户端同一碰撞规格）
│   ├── player.rs  # 玩家移动状态机
│   └── world.rs   # 玩家集合 + 步进 + 快照
└── telemetry.rs   # tick 耗时 + 输入延迟统计（每秒日志）
```

## 权威性

- 客户端发送 `InputFrame`（按钮 + 视角增量 + 轴），服务器独立计算速度/位移/碰撞。
- 快照按 id 排序、量化编码（厘米/厘度 int16）下发给所有玩家。
- 版本协商：Hello 携带客户端版本，不匹配即 Kick。
- 快照每 2 tick（32Hz）广播一次，channel 满时丢弃（不可靠语义）。

## 客户端对拍

```bash
cargo run -- --port 9000 --tick-rate 64   # 终端 A
cd ../client && npm run dev                # 终端 B，设置 → 联网对拍
```

可在浏览器开两个标签页各连一个客户端，互相能看到对方移动（实体渲染）。
