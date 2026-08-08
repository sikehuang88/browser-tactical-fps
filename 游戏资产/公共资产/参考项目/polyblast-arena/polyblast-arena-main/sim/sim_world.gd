extends Node3D
## The authoritative simulation. Fixed 60 Hz tick (physics tick). Owns ALL game
## state: players, movement resolution, jump pads, weapons, damage, pickups,
## teams, rounds, spawns, scoring, bot brains. No input polling, no rendering.
##
## Offline, this runs in-process as the local "server". Phase 2 exposes exactly
## this node over ENet: intents arrive as dictionaries, state/events go out.

const SimPlayer := preload("res://sim/sim_player.gd")
const SimMovement := preload("res://sim/sim_movement.gd")
const SimWeapons := preload("res://sim/sim_weapons.gd")
const NavService := preload("res://sim/nav_service.gd")
const BotBrain := preload("res://bots/bot_brain.gd")

const BOT_NAMES := ["Bolt", "Vector", "Prism", "Nova", "Quartz", "Zenith", "Onyx", "Flux",
	"Ember", "Rift", "Talon", "Hex", "Volt", "Cinder", "Axiom", "Drift"]

const PLAYER_LAYER := 2
const WORLD_LAYER := 1
const KNOCKBACK_PER_DMG := 0.1        # m/s of impulse per point of (pre-halving) damage

const RESPAWN_DELAY := 2.0
const SPAWN_INVULN := 2.0
const SPEED_HARD_CAP := 50.0          # nothing legitimate exceeds ~35 m/s;
                                      # guards against depenetration catapults

## Game modes
const MODE_DM := 0                    # free-for-all, individual frag limit
const MODE_TDM := 1                   # team frags vs frag limit
const MODE_TE := 2                    # team elimination: rounds, one life each

const ARMOR_MAX := 120
const ARMOR_ABSORB := 2.0 / 3.0       # fraction of damage AP soaks while > 0
const TE_INTERMISSION := 3.0          # seconds between elimination rounds
const PICKUP_RESPAWN := 15.0
const PICKUP_RESPAWN_UBER := 35.0
const PICKUP_RADIUS := 1.1            # horizontal grab distance (m)

## Pickup kinds -> effect payload (checked in _apply_pickup)
const PICKUP_KINDS := ["health_s", "health_l", "health_u",
	"armor_s", "armor_l", "armor_u", "ammo_s", "ammo_l"]

var players: Dictionary = {}          # id -> SimPlayer
var running := false
var match_over := false
var frag_limit := 20
var mode := MODE_DM
var time_limit := 0.0                 # seconds; 0 = no time limit
var round_limit := 7                  # TE: rounds needed to win the match
var team_frags: Dictionary = {1: 0, 2: 0}
var round_wins: Dictionary = {1: 0, 2: 0}
var round_number := 1

var _arena: Node3D
var _spawns: Array = []
var _team_spawns: Dictionary = {}     # team -> Array[Vector3]; empty = use _spawns
var _jump_pads: Array = []
var _pickups: Array = []              # {kind, pos, active, t}
var _kill_z := -60.0
var _time_left := 0.0
var _round_intermission := -1.0       # > 0 while waiting to start the next TE round
var _events: Array = []               # drained by the presentation layer / future net layer
var _spawn_cursor := 0
var _projectiles: Dictionary = {}     # id -> {owner, weapon, pos, vel, ttl}
var _next_proj_id := 0
var _rng := RandomNumberGenerator.new()
var _brains: Dictionary = {}          # bot id -> BotBrain
var _nav: RefCounted

# SIM runs its tick after intents are submitted (client priority < 0 < ours).
func _ready() -> void:
	process_physics_priority = 10


func setup(arena: Node3D, config: Dictionary = {}) -> void:
	_arena = arena
	_spawns = arena.get_spawn_points()
	_jump_pads = arena.get_jump_pads()
	frag_limit = config.get("frag_limit", 20)
	mode = config.get("mode", MODE_DM)
	time_limit = config.get("time_limit", 0.0)
	round_limit = config.get("round_limit", 7)
	_time_left = time_limit
	if arena.has_method("get_team_spawns"):
		_team_spawns = arena.get_team_spawns()
	if arena.has_method("get_kill_z"):
		_kill_z = arena.get_kill_z()
	_pickups.clear()
	if arena.has_method("get_pickups"):
		for row in arena.get_pickups():  # [kind: String, pos: Vector3]
			_pickups.append({"kind": row[0], "pos": row[1], "active": true, "t": 0.0})
	_nav = NavService.new()
	_nav.setup(arena)
	running = true


func get_spawn_points() -> Array:
	return _spawns


func is_team_mode() -> bool:
	return mode != MODE_DM


## -1 team = auto-balance (team modes) / 0 (DM). Empty carried = default loadout.
func add_bot(difficulty: int, team: int = -1, carried: Array = []) -> String:
	var idx := _brains.size()
	var id := "bot_%d" % idx
	if carried.is_empty():
		carried = _random_loadout()
	add_player(id, BOT_NAMES[idx % BOT_NAMES.size()], true, team, carried)
	_brains[id] = BotBrain.new(self, _nav, id, difficulty)
	return id


func add_player(id: String, display_name: String, is_bot: bool,
		team: int = -1, carried: Array = []) -> void:
	var p: RefCounted = SimPlayer.new()
	p.id = id
	p.display_name = display_name
	p.is_bot = is_bot
	p.team = _assign_team(team)
	p.carried = carried if not carried.is_empty() else SimWeapons.default_loadout()
	p.weapon = p.carried[0]
	p.body = _make_body(id)
	p.ammo = SimWeapons.full_ammo()
	add_child(p.body)
	players[id] = p
	_spawn(p)


func _assign_team(want: int) -> int:
	if not is_team_mode():
		return 0
	if want == 1 or want == 2:
		return want
	var counts := {1: 0, 2: 0}
	for p: RefCounted in players.values():
		if p.team in counts:
			counts[p.team] += 1
	return 1 if counts[1] <= counts[2] else 2


func _random_loadout() -> Array:
	var pool: Array = SimWeapons.GUN_POOL.duplicate()
	var picks := []
	for i in 4:
		picks.append(pool.pop_at(_rng.randi() % pool.size()))
	picks.append(SimWeapons.MELEE)
	return picks


## The ONLY way anything (human client or bot brain) influences the SIM.
func set_intent(id: String, intent: Dictionary) -> void:
	if players.has(id):
		players[id].intent = intent


func get_player(id: String) -> RefCounted:
	return players.get(id)


func drain_events() -> Array:
	var out := _events
	_events = []
	return out


## Presentation mirror of in-flight projectiles.
func get_projectiles() -> Array:
	var out := []
	for id in _projectiles:
		var pr: Dictionary = _projectiles[id]
		out.append({"id": id, "pos": pr["pos"], "vel": pr["vel"], "weapon": pr["weapon"]})
	return out


## Presentation mirror of pickups (client builds visuals once, toggles them).
func get_pickup_state() -> Array:
	return _pickups


func get_time_left() -> float:
	return _time_left if time_limit > 0.0 else -1.0


func _physics_process(dt: float) -> void:
	if not running:
		return
	if not match_over:
		for brain: RefCounted in _brains.values():
			brain.tick(dt)
	for p: RefCounted in players.values():
		if p.alive:
			p.invuln_t = maxf(p.invuln_t - dt, 0.0)
			_move_player(p, dt)
			_check_jump_pads(p)
			if p.body.global_position.y < _kill_z:
				_kill(p, "")
				continue
			if not match_over:
				_tick_weapon(p, dt)
		elif mode != MODE_TE:  # TE: the dead wait for the next round
			p.respawn_t -= dt
			if p.respawn_t <= 0.0 and not match_over:
				_respawn(p)
	_tick_projectiles(dt)
	_tick_pickups(dt)
	if not match_over:
		if _round_intermission > 0.0:
			_round_intermission -= dt
			if _round_intermission <= 0.0:
				_start_round()
		if time_limit > 0.0:
			_time_left -= dt
			if _time_left <= 0.0:
				_time_left = 0.0
				_end_match()


## Scoreboard rows, best first.
func get_scores() -> Array:
	var rows := []
	for p: RefCounted in players.values():
		rows.append({"id": p.id, "name": p.display_name, "frags": p.frags,
			"deaths": p.deaths, "is_bot": p.is_bot, "team": p.team})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return a["frags"] > b["frags"] if a["frags"] != b["frags"] else a["deaths"] < b["deaths"])
	return rows


## TDM: team frags. TE: round wins. DM: {}.
func get_team_scores() -> Dictionary:
	match mode:
		MODE_TDM:
			return team_frags.duplicate()
		MODE_TE:
			return round_wins.duplicate()
	return {}


func _move_player(p: RefCounted, dt: float) -> void:
	var intent: Dictionary = p.intent
	p.yaw = intent["yaw"]
	p.pitch = clampf(intent["pitch"], -PI / 2 + 0.01, PI / 2 - 0.01)
	_set_crouch(p, intent["crouch"])

	var wishdir: Vector3 = SimMovement.wish_dir(p.yaw, intent["move"])
	var on_floor: bool = p.body.is_on_floor()
	var vel: Vector3 = p.velocity

	if on_floor:
		if intent["jump"]:
			# no friction on the jump tick — preserves bunny-hop speed
			vel = SimMovement.ground_move(vel, wishdir, p.crouching, dt)
			vel.y = SimMovement.JUMP_VEL
			_events.append({"type": "jump", "id": p.id})
		else:
			vel = SimMovement.apply_friction(vel, dt)
			vel = SimMovement.ground_move(vel, wishdir, p.crouching, dt)
			vel.y = minf(vel.y, 0.0)
	else:
		vel = SimMovement.air_move(vel, wishdir, dt)

	p.body.velocity = vel
	p.body.move_and_slide()
	p.velocity = p.body.velocity
	if p.velocity.length() > SPEED_HARD_CAP:
		p.velocity = p.velocity.normalized() * SPEED_HARD_CAP
		p.body.velocity = p.velocity


func _check_jump_pads(p: RefCounted) -> void:
	var feet: Vector3 = p.feet_pos()
	for pad in _jump_pads:
		var pos: Vector3 = pad[0]
		var launch: Vector3 = pad[1]
		var radius: float = pad[2]
		var horiz := Vector2(feet.x - pos.x, feet.z - pos.z)
		if horiz.length() <= radius and absf(feet.y - pos.y) < 0.8:
			if p.velocity.y <= launch.y * 0.9:  # don't re-trigger mid-launch
				p.velocity = launch
				p.body.velocity = launch
				_events.append({"type": "jump_pad", "id": p.id, "pos": pos})


## --- pickups ------------------------------------------------------------------


func _tick_pickups(dt: float) -> void:
	for pk: Dictionary in _pickups:
		if not pk["active"]:
			pk["t"] -= dt
			if pk["t"] <= 0.0:
				pk["active"] = true
			continue
		if match_over:
			continue
		var pos: Vector3 = pk["pos"]
		for p: RefCounted in players.values():
			if not p.alive:
				continue
			var feet: Vector3 = p.feet_pos()
			var horiz := Vector2(feet.x - pos.x, feet.z - pos.z)
			if horiz.length() > PICKUP_RADIUS or absf(feet.y - pos.y) > 1.6:
				continue
			if _apply_pickup(p, pk["kind"]):
				pk["active"] = false
				pk["t"] = PICKUP_RESPAWN_UBER if pk["kind"].ends_with("_u") else PICKUP_RESPAWN
				_events.append({"type": "pickup", "id": p.id, "kind": pk["kind"], "pos": pos})
				break


## Returns false if the pickup would be wasted (full health etc.) — stays live.
func _apply_pickup(p: RefCounted, kind: String) -> bool:
	match kind:
		"health_s", "health_l", "health_u":
			if p.health >= 100:
				return false
			var amount := 25 if kind == "health_s" else (50 if kind == "health_l" else 100)
			p.health = mini(p.health + amount, 100)
			return true
		"armor_s", "armor_l", "armor_u":
			if p.armor >= ARMOR_MAX:
				return false
			var amount := 25 if kind == "armor_s" else (50 if kind == "armor_l" else 100)
			p.armor = mini(p.armor + amount, ARMOR_MAX)
			return true
		"ammo_s", "ammo_l":
			var took := false
			for w: int in p.carried:
				var maxa: int = SimWeapons.DEFS[w]["ammo_max"]
				if p.ammo[w] >= maxa:
					continue
				var add: int = maxa if kind == "ammo_l" else maxi(1, int(maxa / 4.0))
				p.ammo[w] = mini(p.ammo[w] + add, maxa)
				took = true
			return took
	return false


## --- combat -----------------------------------------------------------------


func _tick_weapon(p: RefCounted, dt: float) -> void:
	p.cooldown = maxf(p.cooldown - dt, 0.0)
	var want: int = p.intent["weapon"]
	if want >= 0 and want < SimWeapons.COUNT and want != p.weapon and want in p.carried:
		p.weapon = want
		p.cooldown = maxf(p.cooldown, SimWeapons.SWITCH_LOCK)
		_events.append({"type": "weapon_switch", "id": p.id, "weapon": want})
	if p.intent["fire"] and p.cooldown <= 0.0 and p.ammo[p.weapon] > 0:
		_fire(p)


func _fire(p: RefCounted) -> void:
	var def: Dictionary = SimWeapons.DEFS[p.weapon]
	p.cooldown = def["cooldown"]
	p.ammo[p.weapon] -= 1
	var origin: Vector3 = p.eye_pos()
	var aim: Vector3 = SimWeapons.view_dir(p.yaw, p.pitch)
	var knock_mult: float = def.get("knock_mult", 1.0)

	if def["hitscan"]:
		var impacts := []
		for i: int in def["pellets"]:
			var dir: Vector3 = SimWeapons.spread_dir(aim, def["spread"], _rng)
			var hit := _raycast(origin, origin + dir * def["range"], p.body)
			if hit.is_empty():
				impacts.append({"pos": origin + dir * def["range"], "normal": Vector3.UP, "hit_id": ""})
			else:
				var hit_id := ""
				if hit["collider"].has_meta("player_id"):
					hit_id = hit["collider"].get_meta("player_id")
					_damage(players[hit_id], p.id, def["damage"], dir,
						def["damage"] * KNOCKBACK_PER_DMG * 0.3 * knock_mult)
				impacts.append({"pos": hit["position"], "normal": hit["normal"], "hit_id": hit_id})
		_events.append({"type": "fire", "id": p.id, "weapon": p.weapon,
			"origin": origin, "impacts": impacts})
	else:
		var dir: Vector3 = SimWeapons.spread_dir(aim, def["spread"], _rng)
		var pid := _next_proj_id
		_next_proj_id += 1
		_projectiles[pid] = {"owner": p.id, "weapon": p.weapon,
			"pos": origin + dir * 0.8, "vel": dir * def["speed"], "ttl": def["ttl"]}
		_events.append({"type": "fire", "id": p.id, "weapon": p.weapon,
			"origin": origin, "impacts": []})


func _tick_projectiles(dt: float) -> void:
	for pid in _projectiles.keys():
		var pr: Dictionary = _projectiles[pid]
		var def: Dictionary = SimWeapons.DEFS[pr["weapon"]]
		pr["ttl"] -= dt
		if pr["ttl"] <= 0.0:
			_explode(pr["pos"], pr["owner"], def, "")
			_projectiles.erase(pid)
			continue
		var gravity: float = def.get("gravity", 0.0)
		if gravity > 0.0:
			pr["vel"] = pr["vel"] + Vector3(0, -gravity * dt, 0)
		var to: Vector3 = pr["pos"] + pr["vel"] * dt
		var owner_body: CharacterBody3D = players[pr["owner"]].body if players.has(pr["owner"]) else null
		var hit := _raycast(pr["pos"], to, owner_body)
		if hit.is_empty():
			pr["pos"] = to
			continue
		var direct_id := ""
		if hit["collider"].has_meta("player_id"):
			direct_id = hit["collider"].get_meta("player_id")
			var dir: Vector3 = pr["vel"].normalized()
			_damage(players[direct_id], pr["owner"], def["damage"], dir,
				def["damage"] * KNOCKBACK_PER_DMG * def.get("knock_mult", 1.0))
		# nudge off the surface so the splash LOS ray doesn't start inside the wall
		_explode(hit["position"] + hit["normal"] * 0.05, pr["owner"], def, direct_id)
		_projectiles.erase(pid)


func _explode(pos: Vector3, owner_id: String, def: Dictionary, skip_id: String) -> void:
	_events.append({"type": "explosion", "pos": pos})
	var knock_mult: float = def.get("knock_mult", 1.0)
	for p: RefCounted in players.values():
		if not p.alive or p.id == skip_id:
			continue
		var center: Vector3 = p.body.global_position
		var dist: float = maxf(center.distance_to(pos) - 0.4, 0.0)  # capsule allowance
		if dist >= def["splash_radius"]:
			continue
		# explosions don't reach through walls
		var block := _raycast_world(pos, center)
		if not block.is_empty():
			continue
		var falloff: float = 1.0 - dist / def["splash_radius"]
		var raw: int = int(round(def["splash_damage"] * falloff))
		var dmg := raw
		if p.id == owner_id:
			dmg = int(raw / 2.0)  # half self-damage, full knockback: rocket jumps stay strong
		var dir: Vector3 = (center - pos)
		dir = dir.normalized() if dir.length() > 0.01 else Vector3.UP
		_damage(p, owner_id, dmg, dir, raw * KNOCKBACK_PER_DMG * knock_mult)


func _same_team(a_id: String, b_id: String) -> bool:
	if not is_team_mode() or a_id == b_id or not players.has(a_id) or not players.has(b_id):
		return false
	var a: RefCounted = players[a_id]
	var b: RefCounted = players[b_id]
	return a.team != 0 and a.team == b.team


func _damage(target: RefCounted, attacker_id: String, amount: int, knock_dir: Vector3, knock: float) -> void:
	if not target.alive or target.invuln_t > 0.0 or match_over:
		return
	if knock > 0.0:
		target.velocity += knock_dir * knock
		target.body.velocity = target.velocity
	# teammates can knock (rocket-boost an ally!) but never hurt
	if _same_team(attacker_id, target.id):
		return
	var absorbed := 0
	if target.armor > 0:
		absorbed = mini(target.armor, int(round(amount * ARMOR_ABSORB)))
		target.armor -= absorbed
	var dealt := amount - absorbed
	target.health -= dealt
	_events.append({"type": "damage", "id": target.id, "attacker": attacker_id,
		"amount": dealt, "absorbed": absorbed})
	if target.health <= 0:
		_kill(target, attacker_id)


func _kill(target: RefCounted, attacker_id: String) -> void:
	target.alive = false
	target.health = 0
	target.streak = 0
	target.deaths += 1
	target.respawn_t = RESPAWN_DELAY
	target.body.collision_layer = 0  # corpses don't block shots
	var suicide: bool = attacker_id == target.id or attacker_id.is_empty()
	var attacker_name := "the arena"
	if suicide:
		target.frags -= 1
		attacker_name = target.display_name if attacker_id == target.id else attacker_name
	elif players.has(attacker_id):
		var attacker: RefCounted = players[attacker_id]
		attacker.frags += 1
		attacker.streak += 1
		attacker_name = attacker.display_name
		if attacker.streak >= 2:
			_events.append({"type": "streak", "id": attacker_id,
				"name": attacker.display_name, "count": attacker.streak})
		if mode == MODE_TDM and attacker.team in team_frags:
			team_frags[attacker.team] += 1
	_events.append({"type": "death", "id": target.id, "attacker": attacker_id,
		"pos": target.body.global_position})
	_events.append({"type": "kill", "attacker": attacker_id, "victim": target.id,
		"attacker_name": attacker_name, "victim_name": target.display_name,
		"suicide": suicide})
	match mode:
		MODE_DM:
			if not suicide and players.has(attacker_id) and players[attacker_id].frags >= frag_limit:
				_end_match()
		MODE_TDM:
			for t in team_frags:
				if team_frags[t] >= frag_limit:
					_end_match()
					break
		MODE_TE:
			_check_round_end()


## --- rounds (Team Elimination) ------------------------------------------------


func _check_round_end() -> void:
	if match_over or _round_intermission > 0.0:
		return
	var alive_count := {1: 0, 2: 0}
	for p: RefCounted in players.values():
		if p.alive and p.team in alive_count:
			alive_count[p.team] += 1
	var winner := 0
	if alive_count[1] == 0 and alive_count[2] > 0:
		winner = 2
	elif alive_count[2] == 0 and alive_count[1] > 0:
		winner = 1
	elif alive_count[1] == 0 and alive_count[2] == 0:
		winner = 1 if _rng.randf() < 0.5 else 2  # mutual destruction: coin flip
	if winner == 0:
		return
	round_wins[winner] += 1
	_events.append({"type": "round_end", "winner": winner,
		"round_wins": round_wins.duplicate(), "round": round_number})
	if round_wins[winner] >= round_limit:
		_end_match()
	else:
		_round_intermission = TE_INTERMISSION


func _start_round() -> void:
	_round_intermission = -1.0
	round_number += 1
	_projectiles.clear()
	for pk: Dictionary in _pickups:
		pk["active"] = true
		pk["t"] = 0.0
	for p: RefCounted in players.values():
		p.health = 100
		p.armor = 0
		p.alive = true
		p.ammo = SimWeapons.full_ammo()
		p.weapon = p.carried[0]
		p.cooldown = 0.0
		p.invuln_t = SPAWN_INVULN
		p.body.collision_layer = PLAYER_LAYER
		_spawn(p)
	_events.append({"type": "round_start", "round": round_number})


func _end_match() -> void:
	match_over = true
	_projectiles.clear()
	_events.append({"type": "match_end", "scores": get_scores(),
		"mode": mode, "team_scores": get_team_scores()})


func _respawn(p: RefCounted) -> void:
	p.health = 100
	p.armor = 0
	p.alive = true
	p.ammo = SimWeapons.full_ammo()
	p.weapon = p.carried[0]
	p.cooldown = 0.0
	p.invuln_t = SPAWN_INVULN
	p.body.collision_layer = PLAYER_LAYER
	_spawn(p)


func _raycast(from: Vector3, to: Vector3, exclude_body: CharacterBody3D) -> Dictionary:
	var space: PhysicsDirectSpaceState3D = get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, to, WORLD_LAYER | PLAYER_LAYER)
	if exclude_body != null:
		q.exclude = [exclude_body.get_rid()]
	return space.intersect_ray(q)


func _raycast_world(from: Vector3, to: Vector3) -> Dictionary:
	var space: PhysicsDirectSpaceState3D = get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, to, WORLD_LAYER)
	return space.intersect_ray(q)


## Prefer the spawn farthest from living enemies; fall back to rotation.
## Team modes with team spawn zones: pick only among the player's team spawns.
## Spots with ANY living player standing on them are excluded — spawning two
## teammates inside each other lets physics depenetration catapult them.
func _pick_spawn(p: RefCounted) -> Vector3:
	var pool: Array = _spawns
	if p.team != 0 and _team_spawns.has(p.team) and not _team_spawns[p.team].is_empty():
		pool = _team_spawns[p.team]
	var free := []
	for spot: Vector3 in pool:
		var occupied := false
		for q: RefCounted in players.values():
			if q.alive and q.id != p.id and q.body.global_position.distance_to(spot) < 1.5:
				occupied = true
				break
		if not occupied:
			free.append(spot)
	if free.is_empty():
		free = pool
	var enemies := []
	for q: RefCounted in players.values():
		if q.alive and q.id != p.id and not _same_team(p.id, q.id):
			enemies.append(q.body.global_position)
	if enemies.is_empty():
		var spot: Vector3 = free[_spawn_cursor % free.size()]
		_spawn_cursor += 1
		return spot
	var best: Vector3 = free[0]
	var best_d := -1.0
	for spot: Vector3 in free:
		var d := INF
		for e: Vector3 in enemies:
			d = minf(d, spot.distance_to(e))
		if d > best_d:
			best_d = d
			best = spot
	return best


func _spawn(p: RefCounted) -> void:
	var spot: Vector3 = _pick_spawn(p)
	p.velocity = Vector3.ZERO
	p.body.velocity = Vector3.ZERO
	p.body.global_position = spot + Vector3(0, p.capsule_half_height() + 0.1, 0)
	# face arena center: forward (-Z rotated by yaw) must point at the origin
	p.yaw = atan2(spot.x, spot.z)
	p.pitch = 0.0
	p.body.reset_physics_interpolation()
	_events.append({"type": "spawn", "id": p.id, "pos": p.body.global_position})


func _set_crouch(p: RefCounted, want: bool) -> void:
	if p.crouching == want:
		return
	# standing up needs headroom
	if not want and _head_blocked(p):
		return
	p.crouching = want
	var capsule: CapsuleShape3D = p.body.get_child(0).shape
	capsule.height = 1.2 if want else 1.8
	var col: CollisionShape3D = p.body.get_child(0)
	col.position.y = 0.0


func _head_blocked(p: RefCounted) -> bool:
	var space: PhysicsDirectSpaceState3D = p.body.get_world_3d().direct_space_state
	var from: Vector3 = p.body.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from + Vector3(0, 1.0, 0), WORLD_LAYER)
	q.exclude = [p.body.get_rid()]
	return not space.intersect_ray(q).is_empty()


func _make_body(id: String) -> CharacterBody3D:
	var body := CharacterBody3D.new()
	body.name = "body_" + id
	body.set_meta("player_id", id)
	body.collision_layer = PLAYER_LAYER
	body.collision_mask = WORLD_LAYER | PLAYER_LAYER
	body.floor_snap_length = 0.3
	var col := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.4
	capsule.height = 1.8
	col.shape = capsule
	body.add_child(col)
	return body
