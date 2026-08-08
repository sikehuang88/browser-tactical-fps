extends Node
## CLIENT orchestration: loads the chosen arena, captures input, sends intents
## to the SIM, owns the first-person camera. Reads SIM state; never writes it.

const CameraRig := preload("res://client/camera_rig.gd")
const Fx := preload("res://client/fx.gd")
const PlayerVisuals := preload("res://client/player_visuals.gd")
const PickupVisuals := preload("res://client/pickup_visuals.gd")
const Hud := preload("res://client/hud.gd")
const PauseMenu := preload("res://client/pause_menu.gd")
const Summary := preload("res://client/summary.gd")
const SimWeapons := preload("res://sim/sim_weapons.gd")

const LOCAL_ID := "p1"

@onready var sim: Node3D = get_node("../SimWorld")

var arena: Node3D
var rig: Node3D
var camera: Camera3D
var fx: Node3D
var visuals: Node3D
var pickups: Node3D
var hud: CanvasLayer
var pause_menu: CanvasLayer
var summary: CanvasLayer
var match_ended := false
var yaw := 0.0
var pitch := 0.0


func _ready() -> void:
	process_physics_priority = -10  # intents land before the SIM tick
	arena = load(GameConfig.map_scene()).instantiate()
	arena.name = "Arena"
	get_parent().add_child.call_deferred(arena)
	if not arena.baked:
		await arena.ready_for_match
	sim.setup(arena, {
		"frag_limit": GameConfig.frag_limit,
		"mode": GameConfig.mode,
		"time_limit": GameConfig.time_limit_min * 60.0,
	})
	var carried: Array = Profile.loadout_weapons.duplicate()
	carried.append(SimWeapons.MELEE)
	sim.add_player(LOCAL_ID, "You", false, -1, carried)
	for i in GameConfig.bot_count:
		sim.add_bot(GameConfig.difficulty)
	var p: RefCounted = sim.get_player(LOCAL_ID)
	yaw = p.yaw
	pitch = p.pitch
	_build_camera()
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)


func _build_camera() -> void:
	rig = CameraRig.new()
	rig.sim = sim
	rig.player_id = LOCAL_ID
	camera = Camera3D.new()
	camera.fov = 90.0
	camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	rig.add_child(camera)
	get_parent().add_child.call_deferred(rig)
	fx = Fx.new()
	fx.sim = sim
	fx.camera = camera
	fx.local_id = LOCAL_ID
	fx.initial_weapon = Profile.loadout_weapons[0]
	fx.finish_color = Profile.finish_color()
	get_parent().add_child.call_deferred(fx)
	visuals = PlayerVisuals.new()
	visuals.sim = sim
	visuals.local_id = LOCAL_ID
	get_parent().add_child.call_deferred(visuals)
	pickups = PickupVisuals.new()
	pickups.sim = sim
	get_parent().add_child.call_deferred(pickups)
	hud = Hud.new()
	hud.sim = sim
	hud.local_id = LOCAL_ID
	get_parent().add_child.call_deferred(hud)
	pause_menu = PauseMenu.new()
	get_parent().add_child.call_deferred(pause_menu)
	summary = Summary.new()
	summary.local_id = LOCAL_ID
	get_parent().add_child.call_deferred(summary)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw = wrapf(yaw - event.relative.x * GameConfig.mouse_sensitivity, -PI, PI)
		pitch = clampf(pitch - event.relative.y * GameConfig.mouse_sensitivity, -PI / 2 + 0.01, PI / 2 - 0.01)
	elif event.is_action_pressed("pause") and not match_ended and pause_menu != null:
		pause_menu.open()


func _process(_dt: float) -> void:
	if camera != null:
		camera.rotation = Vector3(pitch, 0, 0)
		rig.rotation = Vector3(0, yaw, 0)
	for ev: Dictionary in sim.drain_events():
		_on_sim_event(ev)


func _physics_process(_dt: float) -> void:
	if not sim.running or match_ended:
		return
	var move := Vector2(
		Input.get_axis("move_left", "move_right"),
		Input.get_axis("move_back", "move_forward"),
	)
	sim.set_intent(LOCAL_ID, {
		"move": move,
		"yaw": yaw,
		"pitch": pitch,
		"jump": Input.is_action_pressed("jump"),  # held = auto bunny-hop
		"crouch": Input.is_action_pressed("crouch"),
		"fire": Input.is_action_pressed("fire"),
		"weapon": _weapon_choice(),
	})


## Keys 1-5 select loadout slots (slot 5 = melee).
func _weapon_choice() -> int:
	var p: RefCounted = sim.get_player(LOCAL_ID)
	if p == null:
		return -1
	for i in 5:
		if Input.is_action_just_pressed("weapon_%d" % (i + 1)) and i < p.carried.size():
			return p.carried[i]
	return -1


func _on_sim_event(ev: Dictionary) -> void:
	if fx != null:
		fx.handle(ev)
	if visuals != null:
		visuals.handle(ev)
	if hud != null:
		hud.handle(ev)
	match ev["type"]:
		"match_end":
			match_ended = true
			GameConfig.last_match_result = ev
			sim.set_intent(LOCAL_ID, {"move": Vector2.ZERO, "yaw": yaw, "pitch": pitch,
				"jump": false, "crouch": false, "fire": false, "weapon": -1})
			var earned := _award_points(ev)
			if summary != null:
				summary.show_results(ev, earned)
		"spawn":
			if ev["id"] == LOCAL_ID and rig != null:
				rig.reset_physics_interpolation()
				# snap the view to the SIM's spawn-facing direction
				var p: RefCounted = sim.get_player(LOCAL_ID)
				yaw = p.yaw
				pitch = p.pitch


## Points: 10 per frag + 25 for winning the match.
func _award_points(ev: Dictionary) -> int:
	var frags := 0
	for row: Dictionary in ev["scores"]:
		if row["id"] == LOCAL_ID:
			frags = maxi(row["frags"], 0)
	var won := false
	var team_scores: Dictionary = ev.get("team_scores", {})
	if team_scores.is_empty():
		won = not ev["scores"].is_empty() and ev["scores"][0]["id"] == LOCAL_ID
	else:
		var p: RefCounted = sim.get_player(LOCAL_ID)
		var mine: int = team_scores.get(p.team, 0)
		var theirs: int = team_scores.get(3 - p.team, 0)
		won = mine > theirs
	var earned: int = frags * Profile.POINTS_PER_KILL + (Profile.POINTS_WIN_BONUS if won else 0)
	Profile.add_points(earned)
	return earned
