# 核心玩法 + 第一人称手臂持枪：问题与建议

审查基线：`d7ff0e6`
审查范围：`server/src/sim/`（玩法权威逻辑）、`client/src/render/playerView.ts`（第一人称视图模型）、`client/src/prediction/localPlayer.ts`

> 本文是建议清单，不提交 GitHub。每条给出定位、证据与可落地的改法。

## 先说结论

第一人称这块**最大的缺失是根本没有手臂**——viewmodel 只有一把浮空的枪。除此之外还有一个真 bug（枪口定位）和一个方案性问题（用 `depthTest=false` 做遮挡）。

核心玩法的服务器权威逻辑是扎实的：确定性后坐力有服务器实现、客户端预测表数值与服务器逐条对得上、相机欧拉角顺序 `YXZ` 与服务器 `forward_dir` 一致。主要缺口在**后坐力不回复**和**无移动散布惩罚**这两个战术 FPS 的基本手感项。

## 优先级速查

| # | 问题 | 类型 | 优先级 |
|---|---|---|---|
| A-1 | 无第一人称手臂 | 缺失 | **P0** |
| A-3 | 枪口定位在世界空间比较 Z | **Bug** | **P0** |
| A-2 | `depthTest=false` 导致枪模自遮挡错乱 | 方案 | **P1** |
| B-1 | 后坐力永不回复 | 手感 | **P1** |
| B-3 | 无移动散布惩罚 | 平衡 | **P1** |
| B-4 | 下蹲瞬间完成 | 手感/竞技 | **P1** |
| A-7 | 换弹无第一人称表现 | 缺失 | P2 |
| A-4 | 静止时枪仍上下浮动 | Bug | P2 |
| A-6 | 无武器惯性 sway | 手感 | P2 |
| A-8 | ADS 仅狙击枪且纯客户端 | 设计 | P2 |
| B-5 | 武器数值三处重复无真源 | 维护 | P2 |
| A-5 | 摆动时间驱动而非位移驱动 | 手感 | P3 |
| A-9 | 抛壳从枪口抛出 | 细节 | P3 |
| A-10 | 每发子弹新建 geometry | 性能 | P3 |
| B-2 | 弹道 6 发一循环 | 设计 | P3 |

---

# A. 第一人称手臂持枪

## A-1 [P0] 根本没有手臂/手部模型

`PlayerView` 的整个 viewmodel 只有一把枪：

```ts
// playerView.ts:37-39
private readonly weapon = new THREE.Group()
private readonly modelMount = new THREE.Group()   // ← 只挂枪模
private readonly fallback = buildFallbackModel()  // ← 一个 0.07×0.1×0.55 的黑盒子
```

`buildFallbackModel()` 也只是个长方体。玩家看到的是一把**悬浮在视野右下角的枪**，没有任何持握的手或手臂。这是第一人称射击游戏最基础的观感要素，缺失后会非常"廉价"。

### 好消息：素材已经具备

`characterAssets.ts` 已经有带骨骼的角色和动画：

```ts
const ASSET_URLS: Record<OperatorId, string> = {
  vanguard: '/assets/characters/operator-vanguard.glb',
  sentinel: '/assets/characters/operator-sentinel.glb',
}
// 且有 idleClip / walkClip / runClip / showcaseClip
// 并用 SkeletonUtils.clone 做骨骼克隆
```

### 建议：方案 A（推荐）—— 独立 FP 手臂模型

业界标准做法。单独做一套只到上臂的手臂模型（第一人称永远看不到肩膀以上），骨骼简单、面数低、可复用于所有武器。

- 手臂 rig 只需 `shoulder → upperArm → foreArm → hand → 手指`（手指可简化为 3 根）
- 每把武器配一个 **持握姿势 clip**（idle pose），把手臂 IK 到武器的 grip / foregrip 节点
- 换弹、切枪、检视各做一个 clip

结构上把 `modelMount` 拆成手臂根节点，武器作为手骨的子节点：

```ts
// 手臂挂在 weapon group 下，武器挂在右手骨骼下
this.arms = await loadFirstPersonArms(operatorId)
this.weapon.add(this.arms)
const rightHand = this.arms.getObjectByName('hand_R')
rightHand.add(weaponModel)   // 武器跟随手骨，换弹动画自动带动枪
```

这样换弹/切枪动画只需驱动手臂骨骼，武器自动跟随，不用为每把枪单独做位移动画。

### 方案 B —— 从 operator rig 裁出上半身

如果不想额外建模，可以从现有 `operator-vanguard.glb` 里取子树：

```ts
const arms = new THREE.Group()
for (const boneName of ['shoulder_R', 'upperArm_R', 'shoulder_L', 'upperArm_L']) {
  const bone = operatorRoot.getObjectByName(boneName)
  if (bone) arms.add(bone.clone(true))
}
```

代价：第三人称角色的比例是为外部视角设计的，直接拿来做第一人称通常会显得手臂过短、透视不对，需要单独调 FOV 和比例。**只建议作为过渡方案**。

### 配套：viewmodel 专用 FOV

手臂加进来后，务必给 viewmodel 单独的 FOV（通常 55~65°，独立于世界 FOV）。否则世界 FOV 拉高时手臂会被拉伸变形。这一点与 A-2 的独立渲染 pass 是同一件事，可以一起做。

---

## A-2 [P1] `depthTest = false` 是错误的遮挡方案

```ts
// playerView.ts:510-519 configureFirstPersonModel
model.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return
  object.renderOrder = 1000
  materials.forEach((material) => {
    material.depthTest = false     // ← 问题在这
    material.depthWrite = false
  })
})
```

注释说明了动机是对的（"materials use depthTest=false so map geometry cannot occlude it"），但手段有副作用：

**关掉深度测试 = 枪模自身的深度排序也一并失效。** `renderOrder` 只能排 draw call 之间的顺序，管不了单个 mesh 内部的三角形。后果是枪身内部结构、背面零件会画在正面之上——模型越精细越明显。`barrett.glb`（5.17MB）这种级别的模型必然有内部机匣结构，一定会穿帮。

加上手臂之后问题会立刻放大：手指会穿过枪身显示出来。

### 建议：独立 viewmodel 渲染 pass

标准做法是给 viewmodel 一个专用相机和独立的深度缓冲：

```ts
// 渲染循环
renderer.autoClear = false
renderer.clear()                          // 清 color + depth

renderer.render(worldScene, worldCamera)  // 1) 世界，正常深度

renderer.clearDepth()                     // 2) 只清深度，保留颜色
viewCamera.fov = VIEWMODEL_FOV            //    viewmodel 专用 FOV
viewCamera.near = 0.01                    //    近裁面拉近，避免枪身被裁
viewCamera.updateProjectionMatrix()
renderer.render(viewmodelScene, viewCamera)
```

这样 viewmodel 永远画在世界之上（满足原始需求），但**内部仍有正确的深度关系**。材质全部恢复 `depthTest = true`。

同时 `viewmodelScene` 需要自己的灯光（复制世界的主光方向即可），不然材质会全黑。

轻量替代方案：用 `THREE.Layers` 分层 + 两次 `render`，改动更小，但仍需两个相机。

---

## A-3 [P0][Bug] 枪口定位在世界空间比较 Z，结果取决于加载瞬间玩家朝向

```ts
// playerView.ts:533-549
function computeMuzzleLocal(model: THREE.Group, weapon: THREE.Group): THREE.Vector3 | null {
  model.updateMatrixWorld(true)
  let best: THREE.Vector3 | null = null
  model.traverse((object) => {
    ...
    vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)  // → 世界空间
    if (!best || vertex.z < best.z) best = vertex.clone()                      // ← 比较世界 Z
  })
  weapon.updateMatrixWorld(true)
  return weapon.worldToLocal(best)
}
```

注释写的是"从模型网格中找出**最靠前**的顶点"，但 `vertex.z` 是**世界坐标 Z**，不是武器的本地前方。

而 `weapon` group 每帧都在 copy 相机四元数：

```ts
// playerView.ts:96-97
this.weapon.position.copy(this.camera.position)
this.weapon.quaternion.copy(this.camera.quaternion)
```

所以"世界 -Z 方向最远的顶点"只在玩家朝向 yaw=0 时才等于枪管顶端：

| 加载瞬间玩家朝向 | 选中的顶点 |
|---|---|
| yaw = 0°（朝世界 -Z） | ✅ 枪口 |
| yaw = 180°（朝世界 +Z） | ❌ **枪托**（枪管指向 +Z，世界 -Z 最远的是尾部） |
| yaw = ±90° | ❌ 枪身侧面某点 |

`setWeaponModel` 在每次换武器时触发加载，玩家换枪时朝向是任意的。

### 影响范围

`muzzleLocal` 被这些地方使用，全部会锚错位置：

- `spawnMuzzleFlash` — 枪口火焰
- `spawnTracer` / `spawnLaserBeam` — 曳光起点
- `spawnShellCasing` — 抛壳起点
- `updateLaserCharge` — 激光蓄力光球

表现为"背对出生点换枪后，枪口火焰出现在枪托上"。

### 修法：在 weapon 本地空间比较

```ts
function computeMuzzleLocal(model: THREE.Group, weapon: THREE.Group): THREE.Vector3 | null {
  weapon.updateMatrixWorld(true)
  model.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(weapon.matrixWorld).invert()

  let best: THREE.Vector3 | null = null
  const vertex = new THREE.Vector3()
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const positions = object.geometry.attributes.position
    if (!positions) return
    // 顶点 → 世界 → weapon 本地，再比较本地 z（本地 -Z 才是枪管方向）
    const toWeaponLocal = new THREE.Matrix4().multiplyMatrices(toLocal, object.matrixWorld)
    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(toWeaponLocal)
      if (!best || vertex.z < best.z) best = vertex.clone()
    }
  })
  return best
}
```

### 更好的做法：在模型里放 muzzle 节点

逐顶点扫描除了容易搞错空间，还有性能问题：`barrett.glb` 这类模型顶点数可能到 10 万级，换枪时会在主线程做一次全量扫描，造成可感知的卡顿。

正确做法是在 glTF 里放一个名为 `muzzle` 的空节点（Blender 里加个 Empty 导出即可），运行时直接取：

```ts
const muzzleNode = model.getObjectByName('muzzle')
if (muzzleNode) {
  this.muzzleLocal = weapon.worldToLocal(muzzleNode.getWorldPosition(new THREE.Vector3()))
} else {
  this.muzzleLocal = computeMuzzleLocal(model, weapon)  // 回退
}
```

顺带可以加 `grip` / `foregrip` 节点，正好给 A-1 的手臂 IK 用。

---

## A-4 [P2][Bug] 静止时枪仍在上下浮动

```ts
// playerView.ts:95-99
const bob = state.moveSpeed > 0.1 ? Math.sin(nowMs * 0.008) * 0.012 : 0
this.weapon.position.copy(this.camera.position)
this.weapon.quaternion.copy(this.camera.quaternion)
this.weapon.translateX(0.26 + bob)                                        // X 有速度门控
this.weapon.translateY(-0.32 + Math.abs(Math.cos(nowMs * 0.008)) * 0.012) // Y 没有 ←
```

X 方向的摆动正确地被 `moveSpeed > 0.1` 门控了，但 Y 方向的 `Math.abs(Math.cos(...)) * 0.012` 是无条件的。玩家完全静止时，枪仍以固定频率上下浮动 1.2cm。幅度不大但持续存在，静止瞄准时能看出来。

修法：把 Y 的摆动项也乘上同一个门控因子，并且做平滑过渡而不是硬切：

```ts
// 用平滑的 bob 强度代替布尔门控，避免起停时跳变
this.bobStrength += ((state.moveSpeed > 0.1 ? 1 : 0) - this.bobStrength) * (1 - Math.exp(-dt * 8))
const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobStrength
const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobStrength
```

---

## A-5 [P3] 摆动由时间驱动，不是位移驱动

`Math.sin(nowMs * 0.008)` 的频率是常量，导致：

- 走路和疾跑的摆动频率一样（疾跑 5.4 m/s vs 走路 3.8 m/s，脚步频率应该不同）
- 停下时相位不归零，下次起步会从任意相位跳入
- 摆动与脚步音效不同步

建议改为累积移动距离驱动相位，这样摆动天然与移速挂钩，且与脚步声可以共用同一个相位源：

```ts
this.bobPhase += state.moveSpeed * dt * BOB_CYCLES_PER_METER * Math.PI * 2
// 脚步音效在 bobPhase 跨过 π 的整数倍时触发，自动同步
```

---

## A-6 [P2] 没有武器惯性 / sway

```ts
this.weapon.quaternion.copy(this.camera.quaternion)   // 刚性跟随
```

武器姿态直接等于相机姿态，转视角时枪像焊在屏幕上。真实感和"重量感"都缺失，也是本作观感偏"轻"的主要原因之一。

业界标准是加一阶滞后（枪的旋转追赶相机旋转，有延迟）：

```ts
// 目标是相机姿态，但用 slerp 追赶而非直接 copy
const swayFactor = 1 - Math.exp(-dt * SWAY_STIFFNESS)   // SWAY_STIFFNESS ≈ 12~18
this.weaponRotation.slerp(this.camera.quaternion, swayFactor)
this.weapon.quaternion.copy(this.weaponRotation)
```

再叠加一个"反向偏移"会更有份量：视角快速右转时，枪先向左偏一点再跟上。用相机角速度驱动：

```ts
const angularDelta = /* 本帧 yaw/pitch 变化量 */
this.modelMount.position.x += -angularDelta.yaw * SWAY_OFFSET
this.modelMount.position.y += angularDelta.pitch * SWAY_OFFSET
```

不同武器可以用不同的 `SWAY_STIFFNESS`——狙击枪更"沉"（低刚度），手枪更"跟手"（高刚度）。

---

## A-7 [P2] 换弹没有任何第一人称表现

`state.reloading` 在 `playerView.ts` 里**一次都没有被使用**（已确认全文无该标识符）。服务器有完整的换弹状态机（`tick_reload` / `start_reload` / `reload_remaining_ticks`），快照 flags 也带了 `reloading` 位，但第一人称只有 HUD 文字和音效，枪模纹丝不动。

这是玩家感知最强的缺失之一——换弹是高频动作，2.2 秒里画面完全没反馈。

建议（配合 A-1 的手臂）：

```ts
// 有手臂后，换弹是骨骼动画
if (state.reloading && !this.wasReloading) {
  this.playArmClip('reload', spec.reloadMs)   // clip 时长按武器 reload_ms 缩放
}
```

在手臂做完之前，可以先用纯武器变换做一个过渡版本——下沉 + 侧倾 + 回位，虽然简陋但远好过完全静止：

```ts
private applyReloadMotion(state: LocalPlayerState, nowMs: number): void {
  if (!state.reloading) return
  const t = /* 0..1 的换弹进度 */
  const dip = Math.sin(t * Math.PI)            // 中段最低
  this.modelMount.position.y -= dip * 0.14
  this.modelMount.rotation.z += dip * 0.5
  this.modelMount.rotation.x += dip * 0.25
}
```

注意换弹进度需要客户端自己推算（服务器只下发 `reloading` 标志位），或者在快照里补一个剩余 tick 字段。

---

## A-8 [P2] ADS 只对狙击枪生效，且服务器完全不知情

```ts
// localPlayer.ts:121
s.aiming = raw.aiming && getWeapon(s.weaponId)?.id === 4    // 硬编码只有狙击枪
// input.ts:94
const aiming = mouseRight && currentWeaponId === 4
// playerView.ts:77
const targetFov = state.aiming && state.weaponId === 4 ? this.defaultFov * 0.5 : this.defaultFov
```

且 `core/types.ts:43` 明确写着：

```ts
/** Network input frame: local-only aiming state is intentionally not serialized. */
```

两个后果：

1. **其他武器右键无任何反馈。** 步枪/手枪/冲锋枪按右键什么都不发生，玩家会以为是 bug。
2. **服务器没有 ADS 概念**，因此无法施加任何取舍——没有移速惩罚、没有精度差异、没有开镜延迟。目前 ADS 是**纯收益**：狙击枪按右键获得 2 倍变焦 + 灵敏度减半（`input.ts:96`），零代价。

建议：先决定 ADS 在本作里是什么定位。

- 若定位为"仅狙击枪的变焦"，那就把其他武器的右键改绑别的功能（如检视武器），并明确写进设计文档；
- 若定位为通用机制，则必须把 `aiming` 纳入输入帧，服务器侧施加移速惩罚（如 `max_speed * 0.5`）和开镜过渡时间，否则违反"服务端校验状态转换"（需求 §9）。

---

## A-9 [P3] 抛壳从枪口位置抛出

```ts
// playerView.ts:362-365
// 从真实枪模的枪口附近抛壳，保证与可见武器一致。
const ejectLocal = (this.muzzleLocal ?? new THREE.Vector3(0, -0.03, -0.62))
  .clone()
  .add(new THREE.Vector3(0.06, 0.04, 0.22))
```

抛壳口在弹膛（机匣右侧），不在枪口。`+0.22` 的 z 偏移是往相机方向拉回了一些，算是部分补偿，但基准点选错了——一旦 A-3 修好、`muzzleLocal` 变准，这里反而会更明显地偏到枪管前端。

建议同样用模型节点：在 glTF 里加 `eject` 空节点，取不到时回退到 `grip` 附近而非枪口。

---

## A-10 [P3] 每发子弹都新建 geometry + material

`spawnTracer` / `spawnMuzzleFlash` / `spawnShellCasing` 每次调用都 `new THREE.CylinderGeometry(...)` + `new THREE.MeshBasicMaterial(...)`，过期再 `dispose()`。

M4 粉色 90ms 一发 ≈ 每秒 11 发，每发产生：1 个 tracer（Cylinder）+ 1 个 flash（Cone）+ 3 个 smoke（Sphere）+ 1 个 casing（Cylinder）= **6 组 geometry/material 每发**，约 66 组/秒的创建与销毁。

需求 §7 要求"主线程单帧 <16.7ms"，这种分配模式在长时间交火中会累积 GC 压力。

建议对象池：几何体和材质各预建一份共享，只池化 `Mesh` 实例：

```ts
// 几何体和材质全局共享，不随特效创建
const TRACER_GEOMETRY = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true)
const TRACER_MATERIAL = new THREE.MeshBasicMaterial({ /* ... */ })

// 长度用 scale.y 表达，避免为每条曳光重建几何体
mesh.scale.y = length
```

注意透明度是逐实例的，如果共享材质就不能逐条淡出——可以改用固定生命周期 + 整批淡出，或者材质池按透明度分档。

---

# B. 核心玩法

## 先说对的部分

这几点我逐条核对过，实现是正确的，不用改：

- **相机欧拉角顺序**：`renderer.ts:46` 设了 `this.camera.rotation.order = 'YXZ'`，与服务器 `forward_dir()` 的 `[-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)]` 完全一致。这是 FPS 里极易踩的坑（默认 XYZ 会导致侧向时俯仰失效），这里是对的。
- **客户端后坐力预测表与服务器一致**：`localPlayer.ts:351` 的 `1.15 + n*0.1` 展开为 `[1.15,1.25,1.35,1.45,1.55,1.65]`，与 `player.rs:414` 的数组逐项相同；S4 的 `0.72+n*0.07`、M4 的 `1.25+n*0.11` 同样对得上。
- **武器数值当前一致**：R1 100ms↔600RPM、P9 143ms↔420RPM、S4 75ms↔800RPM、M1 1500ms↔40RPM，客户端 `config.ts` 与服务器 `weapon.rs` 换算全部吻合，7 把武器两侧数量也一致。
- **对角线移动不超速**：有 `diagonal_input_never_exceeds_walk_speed` 测试守着。

## B-1 [P1] 后坐力永不回复

```rust
// player.rs:363-366
let (pitch, yaw) = recoil_for_weapon(self.weapon_id, self.recoil_shot_index);
self.pitch = clamp(self.pitch + pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG);
self.yaw = normalize_deg(self.yaw + yaw);
self.recoil_shot_index = self.recoil_shot_index.wrapping_add(1);
```

后坐力**永久累加到玩家视角**，停火后没有任何回复。`recoil_shot_index` 只在换弹（`tick_reload`）、换枪、重生时归零，但**视角本身不回落**。

R1 打完一个 30 发弹匣，累计上抬约 `(1.15+1.25+1.35+1.45+1.55+1.65) × 5 = 42°`。玩家必须全程手动下压，且**停火后视角就停在天上**，需要再手动拉回来。

主流战术 FPS（CS 系、Valorant）都有 recovery：开火时视角上抬，停火后在 ~0.3~0.5s 内平滑回到开火前的准星位置。这是"压枪"手感成立的前提——没有 recovery，喷完一梭子后的视角复位完全靠玩家手动，体验会非常挫。

### 建议

服务器记录开火前的基准视角，停火后插值回去：

```rust
// Player 新增字段
recoil_accumulated_pitch: f32,   // 本次连发累计的后坐力
recoil_accumulated_yaw: f32,
ticks_since_fire: u32,

// record_fire 里累加
self.recoil_accumulated_pitch += pitch;
self.recoil_accumulated_yaw += yaw;
self.ticks_since_fire = 0;

// 每 tick 调用：停火超过阈值后按比例回落
pub fn tick_recoil_recovery(&mut self, dt: f32) {
    self.ticks_since_fire = self.ticks_since_fire.saturating_add(1);
    if self.ticks_since_fire < RECOVERY_DELAY_TICKS { return; }
    let decay = 1.0 - (-dt * RECOVERY_RATE).exp();
    let dp = self.recoil_accumulated_pitch * decay;
    let dy = self.recoil_accumulated_yaw * decay;
    self.pitch = clamp(self.pitch - dp, -MAX_PITCH_DEG, MAX_PITCH_DEG);
    self.yaw = normalize_deg(self.yaw - dy);
    self.recoil_accumulated_pitch -= dp;
    self.recoil_accumulated_yaw -= dy;
}
```

**关键**：客户端 `localPlayer.ts` 必须实现完全相同的回复逻辑，否则预测与服务器视角发散。这正好凸显了 B-5 的问题——这套逻辑现在要在两处手写两遍。

另外要注意"玩家手动下压 + 自动回复"的叠加：常见做法是只回复"玩家未手动补偿掉的部分"，即记录累计后坐力，玩家的鼠标下移先抵消它，剩余部分才自动回复。否则玩家压枪压准了，松手后视角还会往下沉。

## B-2 [P3] 弹道图案 6 发一循环

```rust
let n = (shot_index % 6) as usize;
```

30 发弹匣把同一个 6 发图案重复 5 次。确定性图案本身是好设计（可学习、公平），但 6 发循环意味着图案没有"记忆价值"——玩家学会前 6 发就等于学会了全部。

建议改为逐发唯一的完整弹道表（长度 = 弹匣容量），前段密集上抬、中段横向摆动、后段发散，这是可学习性与难度的常见平衡点。数据可以直接放进 B-5 提到的共享配置表。

## B-3 [P1] 完全没有移动散布惩罚

服务器射击路径 `fire_hitscan()` 直接用 `forward_dir(shooter.yaw, shooter.pitch)`，没有任何随机扩散或移动惩罚（全文搜索 `spread` / `inaccuracy` / `rand` 在 `server/src/sim/` 下无结果）。

也就是说**边跑边打与站定射击的精度完全相同**。在 5v5 爆破这种强调架点、停顿、精准交火的模式里，这会直接让"跑动中扫射"成为最优解，架点和拉枪线的战术价值归零。

### 建议

加一个基于速度的散布，只影响首发精度（后续由后坐力接管）：

```rust
// 移动散布：速度越高、越不稳
fn movement_inaccuracy(move_speed: f32, on_ground: bool, crouching: bool) -> f32 {
    let base = (move_speed / WALK_SPEED).min(1.5) * MOVE_SPREAD_DEG;
    let air = if on_ground { 1.0 } else { AIR_SPREAD_MULT };   // 空中大幅惩罚
    let crouch = if crouching { CROUCH_SPREAD_MULT } else { 1.0 };  // 下蹲奖励
    base * air * crouch
}
```

**重要**：散布必须是**服务器权威且可复现**的，否则客户端无法预测弹着点。推荐用确定性伪随机——以 `(player_id, tick, shot_index)` 为种子，客户端用同样的种子算出同样的偏移，这样预测的弹着点与服务器一致，且客户端无法"选择"有利的随机数。

```rust
let seed = hash3(shooter.id, tick, shot_index);
let (offset_yaw, offset_pitch) = deterministic_cone(seed, inaccuracy_deg);
```

## B-4 [P1] 下蹲瞬间完成，无过渡

```rust
// player.rs:274
self.crouching = input.buttons & BTN_CROUCH != 0;
```

按下即生效，碰撞高度在 `1.8 ↔ 1.35` 之间瞬变，客户端眼高在 `1.6 ↔ 1.2` 之间瞬变（`playerView.ts:83`）。两个问题：

1. **观感**：镜头 40cm 的瞬移非常突兀，没有任何过渡曲线。
2. **竞技**：可以通过高频蹲起让 hitbox 高度在两帧之间来回跳。配合 ≤200ms 的延迟补偿回溯，会显著增加被命中判定的不确定性——这是老牌 FPS 里被反复修补的"蹲跳 spam"问题。

### 建议

给下蹲加过渡时间（业界典型 0.2~0.3s），高度与眼高都走插值：

```rust
// 目标高度与当前高度分离
let target = if wants_crouch { CROUCH_HEIGHT } else { STAND_HEIGHT };
let rate = (STAND_HEIGHT - CROUCH_HEIGHT) / CROUCH_TRANSITION_SECS;
self.height = move_toward(self.height, target, rate * dt);
self.crouching = self.height < (STAND_HEIGHT + CROUCH_HEIGHT) * 0.5;
```

同时**起身要检查头顶空间**——当前实现里如果玩家蹲在矮空间下按松蹲键，会直接把碰撞体撑到 1.8 卡进天花板。加一个起身前的 AABB 检测，被挡住时保持下蹲。

客户端眼高同步做插值：

```ts
// playerView.ts:83 目前是硬切
const eye = state.crouching ? EYE_CROUCH : EYE_STAND
// 改为跟随服务器下发的连续高度，或本地做同参数插值
```

注意眼高插值必须与服务器的高度插值同参数，否则预测期间的视线原点与服务器命中射线原点不一致，会造成"看得见打不中"。

## B-5 [P2] 武器数值三处重复，无单一真源

同一份数值目前手写在三个地方：

| 位置 | 内容 |
|---|---|
| `server/src/sim/weapon.rs` | 权威数值：damage / fire_interval_ms / mag_size / headshot_mult / leg_mult / falloff / max_range |
| `client/src/game/weapons/config.ts` | damage / fireRatePerMin / ammo / reloadMs / penetrationPower / armorDamageRatio |
| `proto/fps/v1/game.proto` | 按注释是"服务端权威版本" |

外加**后坐力表也是两份手写**（`player.rs:412` 与 `localPlayer.ts:351`）。

我逐条核对过，**当前数值是一致的**。但这完全依赖人工同步：没有代码生成，没有 parity 测试，也没有版本号校验。后坐力表尤其危险——它直接参与客户端预测，一旦某次只改了一边，表现是"打远处目标时预测准星与实际弹道错位"，很难定位。

这也与 `docs/requirements.md` §4「配置/武器/地图/协议全部版本化，**进对局前协商**」和 §19「武器/经济/地图参数版本化」不符——目前没有任何版本协商机制。

### 建议

1. 把武器与后坐力数值统一放进 `proto/` 下的单一数据文件（TOML/JSON 均可），构建时分别生成 Rust 常量和 TypeScript 常量。
2. 给配置表加 `config_version`，握手时客户端上报、服务器校验，不匹配直接拒绝入场（这正是 §4 要求的"进对局前协商"）。
3. 过渡期至少加一个 parity 测试：把两边的表导出成 JSON 对比，CI 里跑。

### 附带问题：客户端配置有服务器未实现的字段

```ts
penetrationPower: 70,      // 穿透 —— 服务器无实现（WEAPON-006 仍是 TODO）
armorDamageRatio: 770,     // 护甲比 —— 服务器硬编码 0.77，未读配置
```

而客户端配置**缺少**服务器实际在用的 `headshot_mult` / `leg_mult` / `falloff_*`。两边字段集合是错位的，不只是数值重复的问题——统一时需要先对齐字段模型。

---

# 建议的推进顺序

1. **A-3 枪口定位 bug** —— 独立的小改动，先修掉，收益立竿见影
2. **A-1 手臂 + A-2 独立渲染 pass** —— 一起做，因为 viewmodel 专用相机/FOV 是手臂的前提；这是观感提升最大的一步
3. **B-4 下蹲过渡 + B-1 后坐力回复** —— 两项核心手感，都需要客户端预测同步改，建议同批
4. **B-5 配置真源** —— 在 B-1 之前做更好，否则后坐力回复的参数又要手写两遍
5. **B-3 移动散布** —— 设计决策成分较大，需要先定"这游戏要不要惩罚跑打"
6. A-7 换弹表现、A-6 sway、A-4/A-5 摆动修正 —— 手臂做完后一并打磨
7. A-9 / A-10 / B-2 —— 细节与优化，可放到最后
