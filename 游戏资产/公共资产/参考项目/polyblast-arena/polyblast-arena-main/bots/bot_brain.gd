extends RefCounted
## Bot AI: an FSM that produces the SAME intent dictionaries a human client
## sends — bots have no special powers, the SIM applies identical rules.
## Runs inside the SIM tick (it is SIM-side logic, not presentation).

const SimPlayerScript := preload("res://sim/sim_player.gd")

enum State { IDLE, PATROL, SEEK, ATTACK, RETREAT }

## Difficulty rows: 0 Easy, 1 Normal, 2 Hard.
const PARAMS := [
	{"aim_noise": 6.0, "react": 0.5, "range": 30.0, "retreat_hp": 20, "turn": 4.0, "hop": 0.0, "fov": 100.0},
	{"aim_noise": 3.2, "react": 0.3, "range": 40.0, "retreat_hp": 30, "turn": 7.0, "hop": 0.15, "fov": 120.0},
	{"aim_noise": 1.5, "react": 0.15, "range": 60.0, "retreat_hp": 35, "turn": 12.0, "hop": 0.35, "fov": 150.0},
]

var sim: Node3D
var nav: RefCounted
var id: String
var prm: Dictionary
var rng := RandomNumberGenerator.new()

var state: State = State.IDLE
var cur_yaw := 0.0
var cur_pitch := 0.0
var path := PackedVector3Array()
var path_i := 0
var repath_t := 0.0
var seen_t := 0.0
var lost_t := 0.0
var last_known := Vector3.ZERO
var strafe := 1.0
var strafe_t := 0.5
var idle_t := 0.3
var seek_t := 0.0
var was_alive := true
var last_hp := 100


func _init(sim_: Node3D, nav_: RefCounted, id_: String, difficulty: int) -> void:
	sim = sim_
	nav = nav_
	id = id_
	prm = PARAMS[clampi(difficulty, 0, PARAMS.size() - 1)]
	rng.seed = hash(id_) ^ 0x5bd1e995  # deterministic per bot


func tick(dt: float) -> void:
	var me: RefCounted = sim.get_player(id)
	if me == null:
		return
	if not me.alive:
		was_alive = false
		return
	if not was_alive:  # just respawned: adopt the SIM's spawn facing, reset plans
		was_alive = true
		cur_yaw = me.yaw
		cur_pitch = 0.0
		path = PackedVector3Array()
		state = State.PATROL
		last_hp = me.health

	var intent: Dictionary = SimPlayerScript.blank_intent()
	var enemy: RefCounted = _perceive(me, dt)

	# getting hurt with no visible attacker: turn and investigate behind us
	if me.health < last_hp and enemy == null and state != State.RETREAT:
		last_known = me.feet_pos() - Basis(Vector3.UP, cur_yaw) * Vector3(0, 0, -1) * 6.0
		seek_t = 3.0
		state = State.SEEK
		_repath(me, last_known)
	last_hp = me.health

	match state:
		State.IDLE:
			idle_t -= dt
			if idle_t <= 0.0:
				state = State.PATROL
		State.PATROL:
			_follow_path(me, intent, dt)
			if path_i >= path.size() or repath_t <= 0.0:
				_repath(me, _random_destination())
			if enemy != null and seen_t >= prm["react"]:
				state = State.ATTACK
		State.SEEK:
			_follow_path(me, intent, dt)
			seek_t -= dt
			if enemy != null and seen_t >= prm["react"]:
				state = State.ATTACK
			elif seek_t <= 0.0 or path_i >= path.size():
				state = State.PATROL
				_repath(me, _random_destination())
		State.ATTACK:
			if enemy == null:
				lost_t += dt
				if lost_t > 0.8:
					seek_t = 4.0
					state = State.SEEK
					_repath(me, last_known)
			else:
				_combat(me, enemy, intent, dt)
				if me.health < int(prm["retreat_hp"]):
					state = State.RETREAT
					_repath(me, _safest_spot(me, enemy))
		State.RETREAT:
			_follow_path(me, intent, dt)
			if path_i >= path.size() or repath_t <= 0.0:
				state = State.PATROL
				_repath(me, _random_destination())

	intent["yaw"] = cur_yaw
	intent["pitch"] = cur_pitch
	repath_t -= dt
	sim.set_intent(id, intent)


## Nearest live enemy that is in range, inside our field of view, with clear
## line of sight. Accumulates seen_t so reaction delay is respected.
func _perceive(me: RefCounted, dt: float) -> RefCounted:
	var best: RefCounted = null
	var best_d := INF
	var my_eye: Vector3 = me.eye_pos()
	for p: RefCounted in sim.players.values():
		if p.id == id or not p.alive:
			continue
		if me.team != 0 and p.team == me.team:  # teammates aren't targets
			continue
		var d: float = my_eye.distance_to(p.eye_pos())
		if d > prm["range"] or d >= best_d:
			continue
		var dir: Vector3 = (p.eye_pos() - my_eye).normalized()
		var facing := Basis(Vector3.UP, cur_yaw) * Vector3(0, 0, -1)
		if rad_to_deg(facing.angle_to(dir)) > prm["fov"] * 0.5:
			continue
		if _los_blocked(me, my_eye, p.eye_pos()):
			continue
		best = p
		best_d = d
	if best != null:
		seen_t += dt
		lost_t = 0.0
		last_known = best.feet_pos()
	else:
		seen_t = 0.0
	return best


func _los_blocked(me: RefCounted, from: Vector3, to: Vector3) -> bool:
	var space: PhysicsDirectSpaceState3D = me.body.get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, to, 1)  # world layer only
	return not space.intersect_ray(q).is_empty()


func _combat(me: RefCounted, enemy: RefCounted, intent: Dictionary, dt: float) -> void:
	var my_eye: Vector3 = me.eye_pos()
	var to_enemy: Vector3 = enemy.eye_pos() - my_eye
	var dist := to_enemy.length()

	# aim: slew toward the target with difficulty-scaled noise
	var noise := deg_to_rad(prm["aim_noise"])
	var want_yaw := atan2(-to_enemy.x, -to_enemy.z) + rng.randfn(0.0, noise)
	var want_pitch := atan2(to_enemy.y, Vector2(to_enemy.x, to_enemy.z).length()) + rng.randfn(0.0, noise)
	var turn: float = prm["turn"] * dt
	cur_yaw = _slew_angle(cur_yaw, want_yaw, turn)
	cur_pitch = clampf(_slew_angle(cur_pitch, want_pitch, turn), -1.4, 1.4)

	# fire when roughly on target
	var aim_err := absf(wrapf(want_yaw - cur_yaw, -PI, PI)) + absf(want_pitch - cur_pitch)
	intent["fire"] = aim_err < deg_to_rad(5.0)
	intent["weapon"] = _pick_weapon(me, dist)

	# footwork: strafe, keep preferred distance, occasional hop
	strafe_t -= dt
	if strafe_t <= 0.0:
		strafe = -strafe
		strafe_t = rng.randf_range(0.4, 1.2)
	var fwd := 0.0
	if dist > 18.0:
		fwd = 1.0
	elif dist < 6.0:
		fwd = -1.0
	if me.weapon == 7 and dist > 2.0:
		fwd = 1.0  # blade out: close the gap
	intent["move"] = Vector2(strafe, fwd)
	intent["jump"] = rng.randf() < prm["hop"] * dt  # per-second hop chance


## Distance-band priority over the bot's carried loadout (first with ammo wins).
const _BAND_CLOSE := [7, 2, 5, 4, 0]        # < 3 m
const _BAND_SHORT := [2, 5, 4, 0, 7]        # 3-9 m
const _BAND_MID := [1, 6, 8, 5, 0, 4]       # 9-30 m
const _BAND_LONG := [3, 0, 4, 1, 6]         # > 30 m


func _pick_weapon(me: RefCounted, dist: float) -> int:
	var band: Array = _BAND_MID
	if dist < 3.0:
		band = _BAND_CLOSE
	elif dist < 9.0:
		band = _BAND_SHORT
	elif dist > 30.0:
		band = _BAND_LONG
	var choice := -1
	for w: int in band:
		if w in me.carried and me.ammo[w] > 0:
			choice = w
			break
	if choice == -1:  # fall back to anything carried with ammo
		for w: int in me.carried:
			if me.ammo[w] > 0:
				choice = w
				break
	return choice if choice != me.weapon else -1


func _follow_path(me: RefCounted, intent: Dictionary, dt: float) -> void:
	if path_i >= path.size():
		return
	var feet: Vector3 = me.feet_pos()
	var next: Vector3 = path[path_i]
	var horiz := Vector2(next.x - feet.x, next.z - feet.z)
	if horiz.length() < 0.8:
		path_i += 1
		return
	var world_dir := Vector3(horiz.x, 0, horiz.y).normalized()
	var want_yaw := atan2(-world_dir.x, -world_dir.z)
	cur_yaw = _slew_angle(cur_yaw, want_yaw, prm["turn"] * dt)
	cur_pitch = _slew_angle(cur_pitch, 0.0, prm["turn"] * dt)
	# move in the bot's local frame (same convention as the human client)
	var local: Vector3 = Basis(Vector3.UP, -cur_yaw) * world_dir
	intent["move"] = Vector2(local.x, -local.z)
	# hop up onto ledges the path climbs
	intent["jump"] = next.y > feet.y + 0.5 and horiz.length() < 1.4


func _repath(me: RefCounted, dest: Vector3) -> void:
	path = nav.get_nav_path(me.feet_pos(), dest)
	path_i = 0
	repath_t = 1.5


func _random_destination() -> Vector3:
	var spawns: Array = sim.get_spawn_points()
	return spawns[rng.randi() % spawns.size()]


func _safest_spot(me: RefCounted, enemy: RefCounted) -> Vector3:
	var spawns: Array = sim.get_spawn_points()
	var best: Vector3 = spawns[0]
	var best_d := -1.0
	var threat: Vector3 = enemy.feet_pos()
	for s: Vector3 in spawns:
		var d := s.distance_to(threat)
		if d > best_d:
			best_d = d
			best = s
	return best


static func _slew_angle(from: float, to: float, max_step: float) -> float:
	var diff := wrapf(to - from, -PI, PI)
	return from + clampf(diff, -max_step, max_step)
