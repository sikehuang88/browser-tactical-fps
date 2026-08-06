# 部署参考

```bash
docker compose -f docker-compose.yml up -d
```

## 组件

| 服务 | 端口 | 说明 |
|---|---|---|
| postgres | 5432 | 永久战绩/用户/封禁（RPO≤15min 需定期备份） |
| redis | 6379 | 匹配队列等可重建临时状态 |
| backend | 8080 | 业务 API（认证/资料/匹配/战绩） |
| gameserver | 9000 | 64 tick 实时服务器（对局实例） |

## 说明

- 本地开发不需要 Docker：三端分别用 `make backend-run` / `make server-run` / `make client-dev`。
- 业务后端接入数据库后需先跑迁移：`psql $PG_DSN -f ../backend/migrations/0001_init.sql`。
- 实时服务器当前为**单实例示意**；正式环境按队列/地区自动扩缩容并保留冷启动缓冲（OPS-002）。
- 发布遵循分环境灰度 + 可回滚，客户端/协议/配置/服务器版本需兼容检查（OPS-004）。

## 网络模拟联调

在客户端与游戏服务器之间插入延迟/抖动/带宽限制代理：

```bash
# 服务器正常监听 9000；代理监听 9001 注入 100ms 延迟
node ../tools/net-sim/index.js --listen 9001 --target 127.0.0.1:9000 --delay-ms 100 --jitter-ms 20
# 客户端「设置 → 服务器地址」填 ws://127.0.0.1:9001/ws
```
