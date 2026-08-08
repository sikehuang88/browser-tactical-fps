# 复核：`d7ff0e6` 对 `214671f` 审查问题的修复

审查范围：`214671f..d7ff0e6`（669 文件，+219 / -61089）
复核日期：2026-08-08
对应报告：[`2026-08-08-214671f.md`](./2026-08-08-214671f.md)

## 构建验证

| 检查项 | 结果 |
|---|---|
| `cargo build` / `cargo test` | ✅ 19 passed / 0 failed |
| `go build` / `go vet` / `go test` | ✅ 全通过 |
| `tsc --noEmit` / `vite build` | ✅ 通过，JS gzip 271KB |

## 逐条结论

| # | 问题 | 状态 |
|---|---|---|
| 1 | 无授权第三方资产 | 🟡 主体已解决，清单未强制 |
| 2 | 客户端假登录 | ✅ 完全修复 |
| 3 | 产物 201MB | 🟡 降至 36.77MB，仍超 §7 上限 1.77MB |
| 4 | 仓库膨胀 262MB | 🟡 工作树已清，历史未回收 |
| 5 | 延迟补偿 RTT | 🟡 时钟偏差已修，防伪造仍可绕过 |
| 6 | PostgreSQL 路径 | 🟡 开关已恢复，实现仍缺 |
| 7 | 签到发奖非幂等 | ✅ 完全修复 |
| 8.1 | Tauri 定位冲突 | 🟡 生成物已忽略，范围变更未记录 |
| 8.2 | CORS 硬编码 | ✅ 完全修复 |
| 8.3 | 错误信息泄露 | 🟡 主路径已修，遗留一处 |
| 8.4 | M4_PINK 严格支配 | ✅ 完全修复 |
| 8.5 | 固定窗口限流 | ✅ 完全修复 |

---

## 已完全修复（5 项）

### ISSUE-2 客户端假登录 ✅

采纳了方案 B。`StartupCinematic.tsx` 现在是纯展示 + 代号输入：

```ts
/**
 * 启动页：纯展示 + 本地代号输入。
 * 不做任何客户端"账号/密码"校验（已移除，避免可绕过的假鉴权与口令落盘），
 * 真实身份服务接入由 M3 后端完成。
 */
```

`grep -rn "passwordHash\|ACCOUNT_STORE_KEY\|hashPassword" client/src/` 已无结果。口令收集、无盐 SHA-256、localStorage 落盘三个缺陷同时消除。

### ISSUE-7 签到发奖幂等 ✅

完全按建议改为条件更新，互斥交给数据库而非连接池：

```go
result, err := tx.ExecContext(ctx, `INSERT INTO user_checkins(...) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET last_date=excluded.last_date,...
    WHERE user_checkins.last_date <> excluded.last_date`, ...)
n, err := result.RowsAffected()
if n == 0 { /* 今日已签，不发奖 */ }
```

迁移到 PostgreSQL 后不会再出现双发奖。与同文件 `ClaimTask` 的写法也一致了。

### ISSUE-8.2 CORS ✅

`allowedOriginsFromEnv()` 读 `FPSWEB_ALLOWED_ORIGINS`（逗号分隔），未配置时回落本地白名单。可部署到真实域名。

### ISSUE-8.4 武器平衡 ✅

M4_PINK 从"每项都更优"改成了真正的取舍：

| | R1（2700） | M4_PINK 改前 | M4_PINK 改后 |
|---|---|---|---|
| damage | 32.0 | 34.0 ↑ | **30.0 ↓** |
| fire_interval_ms | 100 | 83 ↑ | 90 ↑ |
| mag_size | 30 | 30 = | **25 ↓** |
| headshot_mult | 4.0 | 4.0 = | **3.5 ↓** |
| reload_ms | 2200 | 2100 ↑ | **2400 ↓** |
| falloff / range | 15/45/80 | 16/48/82 ↑ | **15/45/80 =** |

现在是"射速略快，但单发伤害、弹匣、爆头倍率、换弹都更差"，构成有意义的选择。

### ISSUE-8.5 限流 ✅

改为每 IP 令牌桶（`tokenBucket { tokens float64 }`），消除固定窗口的边界 2× 放大。

---

## 部分修复 / 仍有缺口（7 项）

### ISSUE-5 延迟补偿 RTT 🟡 —— 本轮最需要继续跟进的一项

**真实的改进**：跨机器时钟相减的 bug 确实消除了。服务器不再算 `now_ms() - client_sent_at_ms`，改用客户端在 pong 里同钟测得的 RTT。之前"客户端时钟偏差 >200ms 就恒定吃满回溯"和"诚实玩家回溯窗口砍半"两个问题都不存在了。

**仍未成立的部分**：注释与提交信息称"突变校验……防止伪造'高延迟'获得更大回溯窗口"，但校验只挡住*变化*，挡不住*一开始就报高*：

```rust
// server/src/sim/world.rs:149
let clamped = rtt_ms.min(200);
let trusted = if p.last_trusted_rtt == 0 || clamped.abs_diff(p.last_trusted_rtt) <= 60 {
    clamped                    // ← last_trusted_rtt == 0 时无条件接受
} else {
    p.last_trusted_rtt
};
```

- `last_trusted_rtt` 初值为 0，**第一次上报无任何校验**。客户端首个 ping 直接报 200，之后每次都报 200（与历史差 0，永远通过），即可永久锁定最大回溯窗口。
- 即便加上首次校验，60ms 的容差也允许 4 秒内以 `0 → 60 → 120 → 180 → 200` 爬坡到上限（客户端每秒一次 ping）。

RTT 的取值范围仍然 100% 由客户端决定，只是变更速率受限。这与 §6「服务端**不接受**客户端上报的命中、伤害、资金或胜负」的精神以及 §9「不信任客户端」不一致 —— 回溯窗口直接决定命中判定结果。

**建议**（同原报告）：服务器自己配对测量。维护 `ping_seq → Instant` 映射，pong 回来时 `sent_instant.elapsed()`，单一时钟、不可伪造、无需任何启发式校验：

```rust
// 发 ping 时记录
pending_pings.insert(seq, Instant::now());
// 收 pong 时
if let Some(sent) = pending_pings.remove(&seq) {
    let rtt = sent.elapsed().as_millis().min(200) as u32;
    world.set_rtt(player_id, rtt);
}
```

### ISSUE-3 产物体积 🟡

201MB → **36.77MB**（38,555,365 字节），压缩率 82%，是很大的进步。`startup-cg.mp4`（53MB）已删除，改用 poster 静态图。但 §7 上限是 35MB，**仍超出 1.77MB**。

当前最大单文件：

| 文件 | 体积 |
|---|---|
| `assets/store/商店军械台.glb` | 8.05 MB |
| `assets/weapons/barrett.glb` | 5.17 MB |
| `assets/ground/ground.glb` | 4.03 MB |
| `assets/weapons/m4-pink.glb` | 3.39 MB |
| `assets/characters/operator-vanguard.glb` | 3.23 MB |

`ground.glb` / `m4-pink.glb` / `operator-vanguard.glb` 体积与 `214671f` 时完全一致，说明这三个**没有过 Draco 压缩**（清单里只有 barrett 和商店军械台标了"Draco 压缩"）。把这三个也压一遍即可回到预算内。

另外 CI 体积门禁仍未落地，没有东西防止下次回退。

### ISSUE-1 无授权资产 🟡

清理很彻底：`游戏资产/` 整个目录、`client/public/assets/polyblast/`、Mixamo fbx、`*+3d+model.glb` 全部删除，`git ls-files | grep -iE "mixamo|\+3d\+model|\.fbx$|polyblast"` 已无结果。新增 `client/public/assets-manifest.json` 登记授权。

两点缺口：

1. **清单未强制**。`grep -rn "assets-manifest" client/src/ tools/ Makefile` 无结果 —— 它目前纯粹是一份说明文档，构建和 CI 都不读它。§8 要求的是「**只加载签名清单内**资源」，需要构建期校验：清单外的二进制不打包，清单内的校验 hash。
2. **保留资产的溯源标注为 `internal`**，但其中 `barrett.glb`、`商店军械台.glb`、`assault-rifle.glb`、`pistol.glb` 等正是从已删除的市场命名文件（`巴雷特.glb`、`assault+rifle+3d+model.glb`、`pistol+3d+model.glb`）派生的压缩版本。删掉原始文件、重命名并标注 `internal` 不改变几何体的来源。**建议对这批模型补充实际来源与授权凭证**，若确实来自模型交易站需保留购买/许可记录；无法举证的应替换。这一条如果不澄清，ISSUE-1 的法律风险并未真正关闭。

### ISSUE-4 仓库膨胀 🟡

工作树干净了，但 `git count-objects -vH` 仍显示 `size-pack: 262.14 MiB` —— 删除操作只是在历史上追加了"删除"记录，旧的 blob 全部还在。新克隆仍需下载 262MB。

要真正回收需 `git filter-repo` 重写历史（会改写所有 commit hash，需团队协调）。这是个"越晚越贵"的决定，建议尽快定夺。

### ISSUE-6 PostgreSQL 路径 🟡

- ✅ `--pg-dsn` 标志已恢复，指定时会明确报错而非静默回落
- ✅ 补了 `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 5000`，读并发改善
- ⚠️ `SetMaxOpenConns(1)` 仍在（对 SQLite 写串行化是必要的，已加注释说明，可接受）
- ⚠️ `postgres.go` 所有方法仍返回"未实现"

§15「≥1000 并发在线」的能力缺口没有变化。按原建议，task/checkin 表结构现已稳定，是补齐 PostgreSQL 实现的合适时机（M2）。

### ISSUE-8.1 Tauri 🟡

`.gitignore` 已补 `client/src-tauri/gen/`，生成物已从索引移除（`git ls-files | grep -c "src-tauri/gen"` = 0）。

但 Tauri 桌面壳本身保留，而 `docs/requirements.md` §2「PC 桌面浏览器，键鼠输入」和 README「浏览器内直接运行」未做任何更新。按 §19 变更规则，这属于首发范围变更，应记录原因/影响/负责人/目标版本/验收标准。

### ISSUE-8.3 错误信息泄露 🟡

`handleClaimTask` 修得很规范 —— 内部记日志，对外返回固定文案：

```go
s.deps.Logger.Error("claim task failed", "err", err, "requestId", reqID, "userId", userIDFrom(r))
writeError(w, http.StatusConflict, "task_not_ready", "任务尚未完成、已过期或已领取", reqID)
```

但 `router.go:135` `handleMatchmakingQueue` 还有一处漏网：

```go
writeError(w, http.StatusBadRequest, "invalid_request", err.Error(), reqID)
```

`Matchmaking.Enqueue` 的返回值会原样透出。风险低于前者（多为参数校验文案），但建议一并按同样模式处理。

---

## 其他观察

### 本轮修复没有配套回归测试

Rust 仍是 19 个测试（与 `214671f` 相同），Go 侧 `sqlite_test.go` / `memory_test.go` 未改动。以下修复缺少测试保护，容易在后续重构中静默回退：

- `ClaimCheckIn` 幂等（建议：同一 userID 连续两次 claim，断言第二次 `Reward == 0` 且 credits 不变）
- `set_rtt` 突变校验（建议：断言超出 60ms 容差的上报被拒绝 —— 顺带会暴露首次上报无校验的问题）
- `allowedOriginsFromEnv` 解析（建议：设置环境变量后断言白名单）

### 文档未同步

`README.md` / `docs/requirements.md` 在本轮无实质更新。建议补充：资产清单机制（§8）、`FPSWEB_ALLOWED_ORIGINS` 部署配置、Tauri 范围变更（§19）。

---

## 下一步建议优先级

1. **ISSUE-5** —— RTT 改服务器侧 `Instant` 配对测量。这是唯一仍直接影响命中判定公平性的问题。
2. **ISSUE-1 溯源** —— 澄清保留模型的实际来源与授权，否则法律风险未关闭。
3. **ISSUE-3** —— 压缩剩余 3 个未 Draco 处理的模型（约 10.6MB → 预计可省 3~5MB），回到 35MB 预算内，并加 CI 门禁。
4. **ISSUE-4** —— 尽早决定是否 `filter-repo` 重写历史。
5. 补齐上述三项回归测试。
