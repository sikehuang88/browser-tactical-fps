# 业务后端（Go）

认证、用户资料、匹配桩、版本化配置下发。默认使用本地 SQLite 持久化玩家数据。

## 运行

```bash
go run ./cmd/api --addr :8080 --db data/fpsweb.db
# 可选：--token-secret "..."

# 冒烟
curl http://localhost:8080/healthz
curl -X POST http://localhost:8080/api/v1/auth/guest \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"test-device-1","language":"zh-CN"}'
```

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | /healthz | - | 健康检查 |
| GET | /api/v1/config | - | 版本化游戏配置（武器/协议版本） |
| POST | /api/v1/auth/guest | - | 游客登录 → 短期访问令牌 |
| GET | /api/v1/me | Bearer | 当前用户资料 |
| GET | /api/v1/tasks | Bearer | 当前用户的服务器任务与进度 |
| GET | /api/v1/checkin | Bearer | 当前用户每日签到状态 |
| POST | /api/v1/checkin | Bearer | 领取当日签到积分 |
| POST | /api/v1/tasks/{taskID}/track | Bearer | 设置服务器端追踪任务 |
| POST | /api/v1/tasks/{taskID}/claim | Bearer | 领取已完成任务奖励 |
| POST | /api/v1/matchmaking/queue | Bearer | 进入匹配队列（桩） |
| DELETE | /api/v1/matchmaking/queue | Bearer | 退出队列 |

统一错误格式：`{"error":{"code","message","requestId"}}`；所有响应带 `X-Request-Id`。

## 结构

```
cmd/api/main.go            # 入口：SQLite store 默认，--db 指定文件
internal/
├── auth/                  # HMAC-SHA256 短期令牌（OAuth/OIDC 的 M0 占位）
├── server/                # 路由、中间件（requestID/日志/限频/recover）、处理器
├── store/                 # 数据接口 + SQLite 持久化实现
├── user/                  # 游客账户 / 资料
├── matchmaking/           # 匹配队列桩
└── gameconfig/            # 版本化配置下发
migrations/0001_init.sql   # 参考 PostgreSQL schema
```

## 数据库说明

- 默认数据库文件为 `data/fpsweb.db`，启动时自动创建用户和任务表。
- 可通过 `--db` 指定 SQLite 文件路径；使用 `:memory:` 可临时切换为内存数据库。
- 令牌为自研 HMAC 签名（占位），正式接入第三方 OAuth/OIDC（AUTH-002）。
- 匹配仅返回占位结果，真实队列/组队/就绪确认在 M2（MATCH-001~003）。
