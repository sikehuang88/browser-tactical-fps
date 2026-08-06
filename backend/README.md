# 业务后端（Go）

认证、用户资料、匹配桩、版本化配置下发。纯标准库实现，离线可编译。

## 运行

```bash
go run ./cmd/api --addr :8080
# 可选：--pg-dsn "postgres://..." --token-secret "..."

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
| POST | /api/v1/matchmaking/queue | Bearer | 进入匹配队列（桩） |
| DELETE | /api/v1/matchmaking/queue | Bearer | 退出队列 |

统一错误格式：`{"error":{"code","message","requestId"}}`；所有响应带 `X-Request-Id`。

## 结构

```
cmd/api/main.go            # 入口：内存 store 默认，--pg-dsn 接 PostgreSQL
internal/
├── auth/                  # HMAC-SHA256 短期令牌（OAuth/OIDC 的 M0 占位）
├── server/                # 路由、中间件（requestID/日志/限频/recover）、处理器
├── store/                 # 数据接口 + 内存实现 + PostgreSQL 骨架
├── user/                  # 游客账户 / 资料
├── matchmaking/           # 匹配队列桩
└── gameconfig/            # 版本化配置下发
migrations/0001_init.sql   # 参考 PostgreSQL schema
```

## 骨架阶段说明

- 默认内存 store，重启即失；接入 PostgreSQL 后实现 `internal/store/postgres` 并跑迁移。
- 令牌为自研 HMAC 签名（占位），正式接入第三方 OAuth/OIDC（AUTH-002）。
- 匹配仅返回占位结果，真实队列/组队/就绪确认在 M2（MATCH-001~003）。
