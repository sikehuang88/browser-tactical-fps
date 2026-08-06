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

这是**项目脚手架**：目录结构、构建管线、最小可运行骨架与模块划分已就位，各模块的完整业务逻辑按里程碑逐步填充。未实现项一律以 `// TODO(Mx)` 标记并在各子目录 README 说明。

## 开发约定

- 客户端提交**输入帧**，不提交可信位置/命中/伤害（服务器权威）。
- 实时对局链路与业务 API 严格隔离。
- 游戏配置/武器/地图均版本化。
- 高频快照走不可靠通道，关键事件走可靠通道。
