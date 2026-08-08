# Web版 5v5 战术竞技FPS

浏览器内运行的 5v5 爆破模式战术竞技射击游戏（独立原创项目，不复制任何现有作品的商标、资产或源码）。

> 本项目仅借鉴 5v5 战术竞技 FPS 的通用玩法，所有名称、美术、地图、武器、音频均为原创。技术需求见 `docs/requirements.md`。

## 技术栈

| 层 | 技术 |
|---|---|
| Web 客户端 | TypeScript · Three.js (WebGPU 优先 / WebGL2 回退) · React (仅非实时界面) · Web Audio API |
| 实时游戏服务器 | Rust · tokio · 64 tick/s 服务器权威模拟 |
| 业务后端 | Go · stdlib HTTP · PostgreSQL + Redis（骨架阶段内存实现） |
| 网络协议 | 二进制线格式 · WebSocket（M0）/ WebTransport（后续） |
| 资产 | glTF/GLB · KTX2/Basis · Draco/Meshopt |

## 仓库布局

```
fps游戏/
├── proto/          # 共享协议规范 (protobuf 目标定义 + M0 引导二进制格式文档)
├── client/         # Web 客户端（Vite + React + Three.js）
├── server/         # 实时游戏服务器（Rust，64 tick 权威模拟）
├── backend/        # 业务后端（Go：认证/用户/匹配/战绩/封禁）
├── deploy/         # docker-compose 等部署参考
├── tools/net-sim/  # 网络模拟工具（延迟/抖动/丢包）
└── docs/           # 架构与技术文档
```

## 快速开始

### Web 客户端（离线演示模式）

```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

打开页面 → 点 "进入对局" → 鼠标点击锁定指针 → WASD 移动、空格跳跃、Shift 疾跑、Ctrl 下蹲。未配置服务器时运行本地演示模式（本地权威模拟），验证移动、碰撞与第一人称渲染管线。

### Rust 实时服务器

```bash
cd server
cargo run -- --port 9000 --tick-rate 64
```

启动 64 tick 权威模拟循环 + WebSocket 端口。可连接对拍：

```bash
cargo run -- --port 9000 --tick-rate 64   # 终端 A：服务器
cd client && npm run dev                  # 终端 B：浏览器客户端
```

客户端在「设置 → 服务器地址」填入 `ws://127.0.0.1:9000/ws` 并开启联网模式，即可看到客户端预测与服务器快照对拍。

### Go 业务后端

```bash
cd backend
go run ./cmd/api --addr :8080
# 默认内存 store，无需数据库即可跑通
curl http://localhost:8080/healthz
curl -X POST http://localhost:8080/api/v1/auth/guest
```

可选环境变量：`FPSWEB_ALLOWED_ORIGINS`（逗号分隔的前端来源白名单，默认本地开发地址），生产部署请显式配置。

### 网络模拟联调（延迟/抖动/带宽）

在客户端与游戏服务器之间插入代理，体验弱网效果：

```bash
node tools/net-sim/index.js --listen 9001 --target 127.0.0.1:9000 \
  --delay-ms 100 --jitter-ms 20 --bandwidth-kbps 200
# 客户端「设置 → 服务器地址」填 ws://127.0.0.1:9001/ws
```

### 部署

```bash
docker compose -f deploy/docker-compose.yml up -d   # 拉起 postgres/redis/backend/gameserver
```

完整技术需求见 `docs/requirements.md`，架构说明见 `docs/architecture.md`。

## 里程碑对应

| 仓库部分 | 对应需求文档里程碑 |
|---|---|
| client/ 渲染 + 移动 + 灰盒地图 | M0 技术验证 |
| server/ 64 tick + 预测/校正对拍 | M0 技术验证 |
| backend/ 认证 + 用户 + 匹配桩 | M1 垂直切片 |
| proto/ + deploy/ + tools/ | 贯穿 |

## 当前状态

项目骨架 + **M0→M1 对局核心玩法垂直切片**已就位并通过联调验证：

**已实现（服务器权威）**
- 移动/跳跃/下蹲/疾跑 + 客户端预测/校正 + 快照插值（灰盒地图）
- **射击与命中**：射线命中、头/躯干/腿伤害区、距离衰减、护甲减伤、掩体阻挡、≤200ms 延迟补偿回溯、换弹/弹药
- **爆破回合状态机**：冻结/行动/回合结束/对局结束、攻守计分、换弹、**炸弹安装/拆除/爆炸结算**、不足双方不空转、对局结束可重开
- **经济系统（GAME-003）**：初始资金、胜负/连续失败/击杀/安装拆除奖励、资金上限、冻结期购买+退款窗口、购买区校验、装备/投掷物库存
- **投掷物（WEAPON-005）**：烟雾/闪光/高爆，服务器权威弹道/反弹/引信，**烟雾阻挡命中判定**、闪光朝向判定与致盲、爆炸范围伤害，投掷物生成/生效广播
- 击杀播报、伤害摘要、回合状态、队伍、经济状态实时下发
- 64 tick/s，单局 P99 tick < 0.1ms（远低于 12ms 目标）

**客户端表现**
- HUD：回合计时/比分/阶段、炸弹状态、击杀播报、队伍、死亡覆盖、对局结算、**金钱/投掷物计数/购买菜单**
- **音效（AUDIO-001/002）**：Web Audio 程序化枪声/换弹/脚步/投掷/爆炸/闪光/购买/击杀，分类混音 + 空间声像与距离衰减
- 玩家按队伍着色（攻击橙/防守蓝），死亡隐藏；第一人称视角/移动公式已校准（与命中射线一致）
- 投掷物飞行视觉、烟雾云、闪光致盲覆盖层

**仍待后续里程碑**（`TODO(Mx)` 标记）
- 墙体穿透、语音、断线重连、WebTransport、真实匹配/房间、皮肤/经济扩展

## 开发约定

- 客户端提交**输入帧**，不提交可信位置/命中/伤害（服务器权威）。
- 实时对局链路与业务 API 严格隔离。
- 游戏配置/武器/地图均版本化。
- 高频快照走不可靠通道，关键事件走可靠通道。
- 运行时资源由 `client/public/assets-manifest.json` 授权清单登记，构建期强制校验：未登记资源不打包。
