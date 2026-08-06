# Web 客户端

Vite + TypeScript + React + Three.js。React 只负责登录/大厅/设置/结算等非实时界面；对局 HUD 使用轻量 DOM 层；渲染与模拟走引擎核心。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
```

## 模块结构

```
src/
├── main.tsx             # React 入口
├── core/                # 引擎核心
│   ├── clock.ts         # 时间源（performance.now 封装）
│   ├── input.ts         # 键盘/鼠标输入 → 输入帧（Pointer Lock）
│   ├── engine.ts        # 固定步长主循环（64Hz 模拟 + rAF 渲染）
│   └── net/             # 网络层
│       ├── codec.ts     # M0 引导二进制线格式编解码（见 proto/README）
│       ├── transport.ts # 传输抽象（WebSocket / WebTransport 预留）
│       ├── websocketTransport.ts
│       ├── webtransportTransport.ts  # M0 占位，特性检测
│       ├── factory.ts
│       └── connection.ts # 握手/心跳/事件分发
├── snapshot/
│   └── interpolator.ts  # 远端实体快照插值
├── prediction/
│   └── localPlayer.ts   # 本地玩家客户端预测 + 服务器校正
├── render/
│   ├── renderer.ts      # WebGL2 渲染器（WebGPU 特性检测，M2 接入）
│   ├── scene.ts         # 灰盒测试地图
│   ├── playerView.ts    # 第一人称摄像机 + 武器视图
│   └── entityView.ts    # 远端玩家实体网格
├── game/
│   ├── map.ts           # 碰撞体（AABB）与地图数据
│   ├── match.ts         # 对局编排：离线演示 / 联网对拍
│   ├── MatchScreen.tsx  # 对局页面（挂载引擎 + HUD）
│   ├── entityStore.ts
│   └── weapons/         # 武器配置（版本化）
└── ui/                  # 非实时界面
    ├── App.tsx / Lobby.tsx / Settings.tsx / Scoreboard.tsx
```

## 两种模式

- **离线演示**（默认）：本地权威模拟，用于验证渲染/移动/碰撞/武器管线，无需服务器。
- **联网对拍**：设置 → 服务器地址 `ws://127.0.0.1:9000/ws` → 开启联网模式。客户端提交输入帧，服务器回传快照；本地预测 + 服务器校正。

## 关键决策

- 输入帧只在指针锁定后生效；鼠标移动转为相对增量（厘度），与服务器一致。
- 世界单位：客户端内部用**米**，与服务器线格式的**厘米 int16** 在 codec 边界转换。
- 实体渲染走快照插值；本地玩家走预测（无插值延迟）。
