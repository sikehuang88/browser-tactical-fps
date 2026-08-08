# 曳光弹设计方案（4 版 + 共享基座）

基线：`d7ff0e6` · 目标文件：`client/src/render/playerView.ts`

> 代码注释按 `CLAUDE.md` 约定用英文，说明文字用中文。

## 现状

```ts
// playerView.ts:275-299
private spawnTracer(nowMs: number): void {
  const geometry = new THREE.CylinderGeometry(0.012, 0.012, length, 6, 1, true)  // 每发新建
  const material = new THREE.MeshBasicMaterial({ color: 0xffe08a, ... })         // 每发新建
  ...
}
```

三个问题：

1. **整条光束瞬间出现、整体均匀淡出**，没有"飞行"感也没有头尾差异 —— 看起来像一根忽明忽暗的棍子，而不是弹道。
2. **每发子弹新建 geometry + material**，M4 粉色 723 RPM 下每秒 ~12 次创建/销毁（详见 `gameplay-and-viewmodel-suggestions.md` A-10）。
3. **只有本地玩家有曳光**。`entityView.ts` 里没有任何曳光代码，敌人开枪在画面上没有任何弹道痕迹。

还有一处需要先决策的：

```ts
// playerView.ts:115-118
if (this.effectsQuality === 'high') {
  this.spawnShellCasing(nowMs, state.weaponId)
  this.spawnTracer(nowMs)      // ← 低画质完全没有曳光
}
```

目前只影响自己的枪，属于纯观感。但**一旦加了远端曳光，就不能再挂在画质开关下** —— 需求 §8 明确「画质差异不得造成竞技信息优势」，曳光是判断敌人火力方向的关键信息。详见 V4。

---

# 共享基座：`TracerSystem`

四个版本都插在同一套基座上，靠替换 `TracerStyle` 切换。基座顺带解决了每发新建几何体的问题：**几何体是共享的单位圆柱，长度靠 `scale.y` 表达**。

新建 `client/src/render/tracers.ts`：

```ts
import * as THREE from 'three'

/**
 * Unit cylinder along +Y, open-ended, radius 1, height 1.
 * Every tracer instance reuses this geometry and expresses its own
 * radius/length through scale, so no geometry is ever rebuilt at runtime.
 */
const UNIT_BEAM = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
const LOCAL_UP = new THREE.Vector3(0, 1, 0)

export interface TracerSpawn {
  muzzle: THREE.Vector3
  impact: THREE.Vector3
  weaponId: number
  /** True when the shot came from the local player's own weapon. */
  local: boolean
}

export interface ActiveTracer {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>
  muzzle: THREE.Vector3
  direction: THREE.Vector3
  distance: number
  startedAtMs: number
  lifetimeMs: number
  local: boolean
}

/**
 * A tracer style owns its material and decides how the beam evolves.
 * Swap the style to change the visual without touching the system.
 */
export interface TracerStyle {
  /** Beam radius in metres. */
  radius(spawn: TracerSpawn): number
  /** Total lifetime; may depend on distance for travelling styles. */
  lifetimeMs(spawn: TracerSpawn): number
  /** Fresh material per pooled mesh (styles with per-instance uniforms need this). */
  createMaterial(): THREE.Material
  /** Called once at spawn, after the mesh is oriented. */
  onSpawn?(tracer: ActiveTracer, spawn: TracerSpawn): void
  /** Called every frame with normalised lifetime progress t in [0, 1]. */
  onUpdate(tracer: ActiveTracer, t: number): void
}

export class TracerSystem {
  private readonly active: ActiveTracer[] = []
  private readonly pool: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>[] = []

  constructor(
    private readonly scene: THREE.Scene,
    private style: TracerStyle,
  ) {}

  /** Hot-swap the visual style; existing tracers keep their old material. */
  setStyle(style: TracerStyle): void {
    this.style = style
    // Pooled meshes carry the previous style's material, so drop them.
    for (const mesh of this.pool) mesh.material.dispose()
    this.pool.length = 0
  }

  spawn(spawn: TracerSpawn, nowMs: number): void {
    const segment = spawn.impact.clone().sub(spawn.muzzle)
    const distance = segment.length()
    if (distance < 0.05) return

    const direction = segment.clone().divideScalar(distance)
    const mesh = this.pool.pop() ?? this.createMesh()
    mesh.visible = true
    // Align the unit cylinder's +Y axis with the shot direction once;
    // per-frame updates only touch position and scale.
    mesh.quaternion.setFromUnitVectors(LOCAL_UP, direction)

    const tracer: ActiveTracer = {
      mesh,
      muzzle: spawn.muzzle.clone(),
      direction,
      distance,
      startedAtMs: nowMs,
      lifetimeMs: this.style.lifetimeMs(spawn),
      local: spawn.local,
    }

    const radius = this.style.radius(spawn)
    mesh.scale.set(radius, distance, radius)
    this.style.onSpawn?.(tracer, spawn)
    this.style.onUpdate(tracer, 0)

    this.scene.add(mesh)
    this.active.push(tracer)
  }

  update(nowMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const tracer = this.active[i]
      const t = (nowMs - tracer.startedAtMs) / tracer.lifetimeMs
      if (t >= 1) {
        this.recycle(tracer)
        this.active.splice(i, 1)
        continue
      }
      this.style.onUpdate(tracer, t)
    }
  }

  dispose(): void {
    for (const tracer of this.active) {
      this.scene.remove(tracer.mesh)
      tracer.mesh.material.dispose()
    }
    this.active.length = 0
    for (const mesh of this.pool) mesh.material.dispose()
    this.pool.length = 0
  }

  private createMesh(): THREE.Mesh<THREE.CylinderGeometry, THREE.Material> {
    // Geometry is shared and must never be disposed by an instance.
    const mesh = new THREE.Mesh(UNIT_BEAM, this.style.createMaterial())
    mesh.renderOrder = 3
    mesh.frustumCulled = false
    return mesh
  }

  private recycle(tracer: ActiveTracer): void {
    this.scene.remove(tracer.mesh)
    tracer.mesh.visible = false
    this.pool.push(tracer.mesh)
  }
}

/** Place a beam so it spans [start, start + direction * length]. */
export function layoutBeam(
  tracer: ActiveTracer,
  startDistance: number,
  length: number,
  radius: number,
): void {
  const { mesh, muzzle, direction } = tracer
  mesh.scale.set(radius, Math.max(length, 0.001), radius)
  mesh.position.copy(muzzle).addScaledVector(direction, startDistance + length * 0.5)
}
```

**注意**：`UNIT_BEAM` 是模块级共享几何体，任何实例都不得 `dispose()` 它。`TracerSystem.dispose()` 只释放材质。

---

# V1 · 拉伸淡出（Whip）

**最省的一版，改动最小，直接替换现状。**

思路：光束瞬间拉满，然后**尾端向弹着点收缩**，同时整体淡出。视觉上是一道"抽鞭子"的痕迹，比现状的整体淡出有方向感得多。

零额外开销 —— 每帧只改 `position` 和 `scale.y`。

```ts
import * as THREE from 'three'
import { layoutBeam, type ActiveTracer, type TracerSpawn, type TracerStyle } from './tracers'

/** Tail catches up to the impact point while the whole beam fades out. */
export class WhipTracerStyle implements TracerStyle {
  constructor(
    private readonly options: {
      color?: number
      radius?: number
      lifetimeMs?: number
      /** >1 makes the tail accelerate late; 2 reads as a snap. */
      tailEase?: number
    } = {},
  ) {}

  radius(): number {
    return this.options.radius ?? 0.014
  }

  lifetimeMs(): number {
    return this.options.lifetimeMs ?? 110
  }

  createMaterial(): THREE.Material {
    return new THREE.MeshBasicMaterial({
      color: this.options.color ?? 0xffe08a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,          // both walls accumulate -> brighter core
      blending: THREE.AdditiveBlending,
    })
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const ease = this.options.tailEase ?? 2
    const tail = Math.pow(t, ease)                 // 0 -> 1, accelerating
    const startDistance = tracer.distance * tail
    const length = tracer.distance - startDistance
    layoutBeam(tracer, startDistance, length, this.radius())

    const material = tracer.mesh.material as THREE.MeshBasicMaterial
    // Hold brightness early, then fall off fast; pure linear reads as mushy.
    material.opacity = Math.pow(1 - t, 1.6)
  }
}
```

**调参建议**

| 参数 | 效果 |
|---|---|
| `lifetimeMs` 80→140 | 越长越"拖"，超过 160 会糊成一片 |
| `tailEase` 1→3 | 1 = 匀速收缩；3 = 先滞留再猛缩，更有爆发力 |
| `radius` 0.010→0.020 | 0.012 以下远距离会因像素太细而闪烁 |

---

# V2 · 飞行曳光（Traveling）

**最接近真实、也是 CS / Valorant 的做法。**

弹丸以真实弹速飞行（约 900 m/s），一段固定长度的尾迹跟在头部后面。命中判定仍是即时 hitscan（服务器权威不变），只有**视觉**有飞行时间 —— 这是所有主流 FPS 的标准做法。

关键收益：**观察者能看出弹道方向和来源**。这对 V4 的远端曳光是必需的 —— 瞬间出现的整条光束无法让人判断"从哪打来的"，而飞行体可以。

```ts
import * as THREE from 'three'
import { layoutBeam, type ActiveTracer, type TracerSpawn, type TracerStyle } from './tracers'

const DEFAULT_SPEED_MPS = 900
const DEFAULT_TRAIL_M = 14

/**
 * A short streak that travels from muzzle to impact at bullet speed,
 * then drains into the impact point. Hit resolution stays hitscan;
 * only the visual has travel time.
 */
export class TravelingTracerStyle implements TracerStyle {
  private readonly speed: number
  private readonly trail: number

  constructor(
    private readonly options: {
      color?: number
      radius?: number
      speedMps?: number
      trailMetres?: number
      fadeMs?: number
    } = {},
  ) {
    this.speed = options.speedMps ?? DEFAULT_SPEED_MPS
    this.trail = options.trailMetres ?? DEFAULT_TRAIL_M
  }

  radius(): number {
    return this.options.radius ?? 0.016
  }

  lifetimeMs(spawn: TracerSpawn): number {
    const distance = spawn.impact.distanceTo(spawn.muzzle)
    // Head reaches impact, then the tail needs one trail-length more.
    const travelMs = ((distance + this.trail) / this.speed) * 1000
    return travelMs + (this.options.fadeMs ?? 40)
  }

  createMaterial(): THREE.Material {
    return new THREE.MeshBasicMaterial({
      color: this.options.color ?? 0xffd27a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const elapsedSec = (t * tracer.lifetimeMs) / 1000
    const travelled = this.speed * elapsedSec

    // Head stops at the impact point; tail keeps going so the streak drains.
    const head = Math.min(travelled, tracer.distance)
    const tail = Math.max(0, Math.min(travelled - this.trail, tracer.distance))
    const length = head - tail
    if (length <= 0) {
      tracer.mesh.visible = false
      return
    }
    tracer.mesh.visible = true
    layoutBeam(tracer, tail, length, this.radius())

    const material = tracer.mesh.material as THREE.MeshBasicMaterial
    // Full brightness in flight, quick fade only once the head has landed.
    const landed = head >= tracer.distance
    material.opacity = landed ? Math.max(0, length / this.trail) : 1
  }
}
```

**注意事项**

- `lifetimeMs` 依赖距离，所以基座里 `style.lifetimeMs(spawn)` 必须传 `spawn` —— 已经这么设计了。
- 短距离（贴脸）时 `distance < trail`，光束一出生就是完整长度然后立刻排空，看起来是一个短促的闪光，符合预期。
- 弹速可以按武器区分：狙击枪 1200 m/s、手枪 700 m/s，让不同武器的弹道读感不同。

**按武器调速的接法**：

```ts
lifetimeMs(spawn: TracerSpawn): number {
  const speed = SPEED_BY_WEAPON[spawn.weaponId] ?? this.speed
  ...
}
```

不过 `onUpdate` 拿不到 `weaponId` —— 需要在 `ActiveTracer` 上加一个字段，或者在 `onSpawn` 里把武器相关参数存进 `mesh.userData`。后者改动更小：

```ts
onSpawn(tracer: ActiveTracer, spawn: TracerSpawn): void {
  tracer.mesh.userData.speed = SPEED_BY_WEAPON[spawn.weaponId] ?? this.speed
}
```

---

# V3 · 着色器曳光（Shader）

**观感最好、单 draw call、几何体完全静态。**

思路：光束几何体一次性铺满全程且**再也不动**，头部位置和亮度衰减全部交给 fragment shader。每帧只更新 uniform，CPU 侧开销接近零。

profile 是"头部极亮 → 沿尾部指数衰减 → 头部之前完全不可见"，这正是真实曳光的样子。

```ts
import * as THREE from 'three'
import type { ActiveTracer, TracerSpawn, TracerStyle } from './tracers'

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// vUv.y runs 0 -> 1 from the muzzle end to the impact end of the cylinder.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3  uCoreColor;
  uniform vec3  uGlowColor;
  uniform float uHead;      // head position along the beam, 0..1
  uniform float uFalloff;   // higher -> shorter visible trail
  uniform float uFade;      // global fade-out multiplier
  varying vec2  vUv;

  void main() {
    float behind = uHead - vUv.y;             // >0 means behind the head
    float visible = step(0.0, behind);        // nothing ahead of the head
    float trail = exp(-behind * uFalloff) * visible;
    float core  = exp(-behind * uFalloff * 7.0) * visible;

    vec3 color = mix(uGlowColor, uCoreColor, core);
    float alpha = clamp(trail, 0.0, 1.0) * uFade;
    gl_FragColor = vec4(color, alpha);
  }
`

/**
 * Static full-length geometry; the head and the falloff live in the shader.
 * Per-frame cost is three uniform writes, no transform or scale changes.
 */
export class ShaderTracerStyle implements TracerStyle {
  constructor(
    private readonly options: {
      coreColor?: number
      glowColor?: number
      radius?: number
      speedMps?: number
      /** Visible trail length in metres at 1/e brightness. */
      trailMetres?: number
      fadeMs?: number
    } = {},
  ) {}

  radius(): number {
    return this.options.radius ?? 0.02
  }

  lifetimeMs(spawn: TracerSpawn): number {
    const distance = spawn.impact.distanceTo(spawn.muzzle)
    const speed = this.options.speedMps ?? 900
    return (distance / speed) * 1000 + (this.options.fadeMs ?? 90)
  }

  createMaterial(): THREE.Material {
    return new THREE.ShaderMaterial({
      uniforms: {
        uCoreColor: { value: new THREE.Color(this.options.coreColor ?? 0xfff6d8) },
        uGlowColor: { value: new THREE.Color(this.options.glowColor ?? 0xff9c3c) },
        uHead: { value: 0 },
        uFalloff: { value: 8 },
        uFade: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  }

  onSpawn(tracer: ActiveTracer, spawn: TracerSpawn): void {
    // Geometry spans the whole shot once and never moves again.
    const radius = this.radius()
    tracer.mesh.scale.set(radius, tracer.distance, radius)
    tracer.mesh.position
      .copy(tracer.muzzle)
      .addScaledVector(tracer.direction, tracer.distance * 0.5)

    // uFalloff is expressed in metres, converted to the 0..1 uv space.
    const trail = this.options.trailMetres ?? 12
    const material = tracer.mesh.material as THREE.ShaderMaterial
    material.uniforms.uFalloff.value = tracer.distance / Math.max(trail, 0.5)
    void spawn
  }

  onUpdate(tracer: ActiveTracer, t: number): void {
    const material = tracer.mesh.material as THREE.ShaderMaterial
    const speed = this.options.speedMps ?? 900
    const elapsedSec = (t * tracer.lifetimeMs) / 1000
    const head = Math.min((speed * elapsedSec) / tracer.distance, 1)

    material.uniforms.uHead.value = head
    // Only start fading once the head has landed.
    material.uniforms.uFade.value = head >= 1 ? Math.pow(1 - t, 2) : 1
  }
}
```

**为什么用 `DoubleSide` + `AdditiveBlending`**：开口圆柱的正面和背面都会被绘制，加法混合下两层叠加，中心自然比边缘亮，不用额外做径向渐变就有"发光管"的效果。

**`uFalloff` 的含义**：数值是"整条光束长度 / 期望尾迹长度"。100m 的射击配 12m 尾迹 → `uFalloff ≈ 8.3`；5m 的贴脸射击 → `uFalloff ≈ 0.42`，尾迹相对整体更长，看起来是一整条闪光。这个自动缩放正是我们想要的。

---

# V4 · 分频 + 敌我区分（玩法层）

前三版是"怎么画"，这一版是"什么时候画、画给谁看"。**这一版的收益比前三版加起来都大**，因为它把曳光从装饰变成了信息。

## 4.1 不是每发都带曳光

真实弹链是每 4~5 发装一颗曳光弹。全弹曳光会让画面糊成光带，也会让射手位置过度暴露。

```ts
// In PlayerView, gate the spawn on a per-weapon cadence.
const TRACER_EVERY_N_SHOTS: Record<number, number> = {
  1: 3,   // R1 rifle
  2: 1,   // P9 pistol  - low rate of fire, every shot reads fine
  3: 4,   // S4 SMG     - fastest weapon, thin it out the most
  4: 1,   // M1 sniper  - every shot, it is the whole point
  6: 3,   // M4 pink
  7: 1,   // laser cannon has its own beam effect
}

private shouldSpawnTracer(weaponId: number): boolean {
  const every = TRACER_EVERY_N_SHOTS[weaponId] ?? 1
  this.tracerCounter += 1
  return this.tracerCounter % every === 0
}
```

注意 `tracerCounter` 要在换弹时归零，否则弹匣之间的节奏会漂移。

## 4.2 远端玩家的曳光（最重要的一项）

目前 `entityView.ts` 完全没有曳光代码 —— **敌人开枪在画面上没有任何痕迹**。玩家无法通过弹道判断火力来源，这在 5v5 爆破里是很大的信息缺失。

### 方案 A：从快照推断（无需改协议）

`SnapshotEntity` 已经带了 `weapon_id`、`ammo`、`yaw`、`pitch`（`protocol.rs` 本次已扩展），客户端可以靠**弹药数下降**推断开火：

```ts
// In EntityView, track per-entity ammo to detect shots without a new message.
private readonly lastAmmo = new Map<number, number>()

private detectRemoteShots(entity: EntitySnapshot, nowMs: number): void {
  const previous = this.lastAmmo.get(entity.id)
  this.lastAmmo.set(entity.id, entity.ammo)
  if (previous === undefined) return

  // Reload refills the magazine; only a decrease means shots were fired.
  const fired = previous - entity.ammo
  if (fired <= 0 || fired > 4) return   // >4 in one snapshot is a reload artefact

  const origin = new THREE.Vector3(entity.x, entity.y + EYE_STAND, entity.z)
  const direction = forwardFromAngles(entity.yaw, entity.pitch)
  const impact = origin.clone().addScaledVector(direction, traceDistance(origin, direction, 120))
  for (let i = 0; i < fired; i += 1) {
    this.tracers.spawn({ muzzle: origin, impact, weaponId: entity.weaponId, local: false }, nowMs)
  }
}
```

`forwardFromAngles` 必须与服务器 `combat.rs::forward_dir` 完全一致：

```ts
/** Must mirror server combat.rs forward_dir exactly. */
function forwardFromAngles(yawDeg: number, pitchDeg: number): THREE.Vector3 {
  const y = THREE.MathUtils.degToRad(yawDeg)
  const p = THREE.MathUtils.degToRad(pitchDeg)
  const cp = Math.cos(p)
  return new THREE.Vector3(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp)
}
```

**局限**：快照 20~32Hz，而 S4 冲锋枪 800 RPM = 13.3 发/秒。20Hz 下单帧最多丢 1 发，靠 `fired` 计数补发可以还原数量，但**时序会被量化到快照间隔**，快速连射的曳光会成簇出现而不是均匀。可以用快照间隔把补发的几发在时间上摊开：

```ts
const spacingMs = snapshotIntervalMs / fired
for (let i = 0; i < fired; i += 1) {
  this.pendingTracers.push({ spawn, atMs: nowMs + i * spacingMs })
}
```

### 方案 B：新增开火消息（更准，需改协议）

加一个 `MSG_SHOT_FIRED`，服务器在 `fire_hitscan` 成功后广播射手 id + 方向 + 命中距离。精确、无量化误差，也能带上"是否命中"用于区分弹着特效。

代价是每发一条可靠消息 —— 5v5 全员扫射时消息量不小，建议走**不可靠通道**（曳光丢一发无所谓），并做兴趣管理（视锥外/远距离不下发）。

推荐路线：**先用方案 A 验证手感，确认要保留再上方案 B。**

## 4.3 敌我区分与竞技公平

```ts
const TRACER_COLORS = {
  local: 0xffe08a,      // warm yellow - your own fire
  teammate: 0x7ec8ff,   // cool blue
  enemy: 0xff7a5c,      // warm red
} as const
```

配色要照顾色弱（需求 §13「色弱模式」）—— 蓝/橙的明度差比红/绿大得多，是安全选择。另外建议让敌我的**亮度和粗细**也有差异，不要只靠色相区分。

**关键合规点**：远端曳光**必须脱离画质开关**。

```ts
// Wrong - low-quality players lose tactical information (violates requirements 8).
if (this.effectsQuality === 'high') this.spawnTracer(nowMs)

// Right - cosmetic density scales with quality, but the tracer itself always exists.
this.tracers.spawn(spawn, nowMs)
if (this.effectsQuality === 'high') this.spawnMuzzleSmoke(nowMs)
```

需求 §8 原文：「画质差异不得造成竞技信息优势（如完全移除烟雾）」。曳光和烟雾是同一性质的信息载体。低画质可以减少**粒子、抛壳、枪口烟**，但不能删掉曳光本身 —— 低画质下可以用更省的 V1 样式代替 V3 着色器样式，信息保留、开销下降：

```ts
const style = effectsQuality === 'high'
  ? new ShaderTracerStyle()
  : new WhipTracerStyle({ lifetimeMs: 90 })
this.tracers = new TracerSystem(scene, style)
```

---

# 四版对比

| | V1 拉伸淡出 | V2 飞行曳光 | V3 着色器 | V4 玩法层 |
|---|---|---|---|---|
| 观感 | 中 | 好 | 最好 | — |
| CPU/帧 | 极低（改 2 个属性） | 极低 | 最低（改 3 个 uniform） | — |
| 实现成本 | 最小 | 小 | 中（要写 GLSL） | 中 |
| 能否判断来源 | 否 | **能** | **能** | — |
| 适用 | 低画质档 | 通用 | 高画质档 | 全部 |

**推荐组合**：基座 + **V3（高画质）/ V1（低画质）** + **V4 全档启用**。

V2 的价值在于它是 V3 的"无 shader 版本" —— 如果 WebGL2 回退路径上着色器有兼容问题，V2 能提供同样的飞行读感。

---

# 接入 `playerView.ts`

替换现有的 `tracers` 数组和 `spawnTracer`：

```ts
// 1. Replace the raw array with the system.
- private readonly tracers: { mesh: THREE.Mesh; expiresAtMs: number; lifetimeMs: number }[] = []
+ private readonly tracers: TracerSystem

  constructor(camera, scene, options) {
+   this.tracers = new TracerSystem(
+     scene,
+     options.effectsQuality === 'low'
+       ? new WhipTracerStyle({ lifetimeMs: 90 })
+       : new ShaderTracerStyle(),
+   )
  }

// 2. Spawn from the shot loop; note it is no longer gated on quality.
  if (shots > this.lastShots) {
    for (let i = 0; i < shots - this.lastShots; i += 1) {
      ...
      this.spawnMuzzleFlash(nowMs, state.weaponId)
+     if (this.shouldSpawnTracer(state.weaponId)) this.spawnTracer(nowMs)
      if (this.effectsQuality === 'high') {
        this.spawnShellCasing(nowMs, state.weaponId)
-       this.spawnTracer(nowMs)
      }
    }
  }

// 3. The whole per-tracer update block collapses to one call.
- for (let i = this.tracers.length - 1; i >= 0; i -= 1) { ...30 lines... }
+ this.tracers.update(nowMs)

// 4. dispose()
- for (const tracer of this.tracers) { ... }
+ this.tracers.dispose()
```

新的 `spawnTracer` 只负责算起点终点：

```ts
private spawnTracer(nowMs: number): void {
  const direction = MUZZLE_FORWARD.clone().applyQuaternion(this.camera.quaternion).normalize()
  const origin = this.camera.position.clone()
  const distance = traceDistance(origin, direction, TRACER_MAX_DISTANCE)
  this.tracers.spawn(
    {
      muzzle: this.muzzleWorldPosition(),
      impact: origin.addScaledVector(direction, distance),
      weaponId: this.currentWeaponId,
      local: true,
    },
    nowMs,
  )
}
```

## 前置依赖

曳光的起点是 `muzzleWorldPosition()`，而它依赖 `muzzleLocal` —— **`computeMuzzleLocal` 目前有 bug**（在世界空间比较 Z，导致枪口位置取决于换枪瞬间玩家朝向，详见 `gameplay-and-viewmodel-suggestions.md` A-3）。

不先修这个，再好的曳光也会从枪托射出来。**建议先修 A-3，再接曳光。**

## 顺带可复用的地方

`spawnLaserBeam`（`playerView.ts:443`）现在是手搓两层圆柱，可以直接换成 `TracerSystem` + 一个 `LaserBeamStyle`（粗细两层用两次 `spawn`，或在 shader 里做双层 profile），少一份重复逻辑。
