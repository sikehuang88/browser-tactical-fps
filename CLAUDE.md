# 项目约定（给 AI 助手）

## 工作方式
- 这是多模块 monorepo：`client/`（TS+Three.js）、`server/`（Rust）、`backend/`（Go）、`proto/`（协议）。
- 每次改动保持服务器权威原则：客户端只发输入帧，服务器定胜负。
- 未实现功能以 `// TODO(Mx)` 标记，Mx 对应需求文档里程碑（M0~M4）。
- 构建验证：`make check`（Windows 无 make 时逐条执行）：
  - `cd client && npx tsc --noEmit && npm run build`
  - `cd server && cargo build`
  - `cd backend && go build ./...`

## 关键决策记录
- 传输：M0 用 WebSocket + 手写二进制编解码（见 `proto/` 线格式文档）；WebTransport 为后续目标，接口已预留。
- 坐标编码：世界坐标使用**厘米 int16**（±327.67m）做量化，低带宽。
- 后端骨架阶段用内存 store，PostgreSQL 参考迁移在 `backend/migrations/`。
- 客户端「离线演示模式」为脚手架自检手段，正式对局必须联网。

## 语言
- 代码注释、标识符：英文。
- README/文档对用户可见部分：简体中文。
