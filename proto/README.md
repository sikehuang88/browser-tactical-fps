# 共享协议规范

客户端与服务器（实时链路 + 业务 API）之间传输数据的唯一契约。

## 设计原则

- **二进制编码**，禁止在高频状态同步中使用冗余 JSON。
- **协议版本协商**：握手阶段比对版本，不兼容版本在进入对局前拦截。
- **通道分离**：高频快照走不可靠通道；关键事件（握手、结算、Kick）走可靠通道。
- **量化编码**：世界坐标使用厘米 `int16`（±327.67m），角度使用厘度 `int16`。
- 客户端只提交**输入帧**，不提交可信位置、命中或伤害。

## 目录

- `fps/v1/common.proto`  公共类型（Vec3、EntityId、Team、胜负枚举）
- `fps/v1/envelope.proto` 信封（版本、可靠位、序号、负载 oneof）
- `fps/v1/net.proto`      实时链路消息（Hello/Welcome/InputFrame/Snapshot/Ping/Pong/Kick）
- `fps/v1/game.proto`     对局状态（MatchConfig/RoundState/WeaponConfig/EconomyState 等）
- `fps/v1/backend.proto`  业务接口 DTO（认证/资料/匹配/战绩/封禁）
- `buf.yaml`              生成工具配置（protoc / buf）

> 当前里程碑：`.proto` 为**目标规范**（面向后续 protoc/buf 代码生成）。
> M0 脚手架阶段，客户端与 Rust 服务器使用下面的**手写引导线格式**（是上述规范的
> 最小子集），详见「M0 引导线格式」。

---

## M0 引导线格式（bootstrap wire format）

两端已实现的最小二进制协议，用于打通「客户端 → 服务器 → 快照回传」全链路。
坐标/角度编码与 proto 目标一致，后续用代码生成替换手写编解码时，线格式不变。

### 信封头（Envelope，所有消息，大端序）

```
偏移   长度   字段
0      1      magic        0xF5
1      1      protocolVer  当前 = 0x01
2      1      flags        bit0 = reliable，bit1 = retransmit
3      1      msgType      见下表
4      4      seq          客户端→服务器: 输入帧序号；服务器→客户端: tick
8      2      payloadLen   小端或大端？ → 统一大端
10     n      payload
```

### 消息类型

| msgType | 名称 | 方向 | 可靠 |
|---|---|---|---|
| 0x01 | Hello | C→S | ✅ |
| 0x02 | Welcome | S→C | ✅ |
| 0x03 | InputFrame | C→S | ❌（高频不可靠） |
| 0x04 | Snapshot | S→C | ❌ |
| 0x05 | Ping | C→S | ✅ |
| 0x06 | Pong | S→C | ✅ |
| 0x07 | Kick | S→C | ✅ |

### 负载定义

**Hello (0x01)**
```
u8 clientMajor, u8 clientMinor, u8 clientPatch
u8 nameLen, bytes name[nameLen]
```

**Welcome (0x02)**
```
u32 playerId
u16 tickRate
u32 serverRttMs      # 0 = 未知
```

**InputFrame (0x03)**（客户端每 tick 提交）
```
u32 seq
u16 buttons:  bit0 前移 bit1 后移 bit2 左移 bit3 右移
             bit4 跳跃 bit5 下蹲 bit6 疾跑 bit7 开火
i16 yawDelta       # 厘度，相对增量
i16 pitchDelta     # 厘度，相对增量
i8  forwardAxis    # -127..127
i8  strafeAxis     # -127..127
```

**Snapshot (0x04)**（服务器 20~32Hz 下发，仅实体差异后按需全量）
```
u32 tick
u8  entityCount
per entity:
  u32 id                      # 服务器实体 id（客户端据此跳过本地玩家）
  u8  flags:  bit0 移动中 bit1 下蹲 bit2 持武器
  i16 x, i16 y, i16 z      # 厘米
  i16 yaw, i16 pitch       # 厘度
  i16 health
```

**Ping (0x05)** / **Pong (0x06)**
```
u32 clientSentAtMs
```
Pong 追加 `u32 serverRecvAtMs`。

**Kick (0x07)**
```
u8 reason: 0=版本不匹配 1=服务器已满 2=协议错误 3=封禁
```

### 带宽预估

- InputFrame：10 + 11 = 21 字节 × 客户端输入频率（≤64Hz）≈ 1.3 KB/s/玩家上行。
- Snapshot：10 + 13×n 字节 @20Hz，10 人 ≈ 2.8 KB/s/玩家下行，远低于 250 Kbps 目标。

---

## 版本协商

1. 客户端连接后立即发送 `Hello`（含客户端版本三元组）。
2. 服务器比对 `protocolVer` 与己方支持的版本范围：
   - 兼容 → 回 `Welcome`，进入对局。
   - 不兼容 → 回 `Kick(reason=0)` 并断开。
3. 对局开始后不再热切换协议版本。
