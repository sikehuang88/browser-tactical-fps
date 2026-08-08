extends NavigationRegion3D
## Shared arena machinery. Concrete arenas extend this and override the data
## functions (boxes/ramps/pads/spawns/pickups/props/theme). Geometry is built
## from data tables at load; navmesh bakes from the static colliders. The SIM
## consumes only the public contract below — maps never touch SIM code.

signal ready_for_match

const ArenaMaterials := preload("res://client/materials.gd")
const WORLD_LAYER := 1

## True once the navmesh bake completed (check before awaiting ready_for_match —
## the bake can finish before listeners connect).
var baked := false


## ---- data tables: override these in each map -------------------------------

## [center: Vector3, size: Vector3, material_id: int, rotation_degrees?: Vector3]
## material_id: 0 floor, 1 wall, 2 block, 3 accent
func boxes() -> Array:
	return []


## [bottom_edge_center, top_edge_center, width]
func ramps() -> Array:
	return []


## [pos(ground), launch_velocity: Vector3, radius: float]
func jump_pads() -> Array:
	return []


## Feet positions. SIM faces spawns toward arena center.
func spawns() -> Array:
	return []


## {1: Array[Vector3], 2: Array[Vector3]} — empty = shared spawns for all teams.
func team_spawns() -> Dictionary:
	return {}


## [kind: String, pos: Vector3] — kinds per SimWorld.PICKUP_KINDS.
func pickups() -> Array:
	return []


## Visual GLB dressing: [glb_res_path, pos, yaw_deg, scale, collider_size].
## collider_size Vector3.ZERO = decoration only (no collision, no navmesh).
func props() -> Array:
	return []


## Invisible collision-only boxes: [center, size]. Used to extend perimeter
## walls far above their visual height so knockback + jump-pad stacks can't
## throw players out of bounded maps.
func barriers() -> Array:
	return []


## Below this Y a player dies (void maps). Override for floating arenas.
func kill_z() -> float:
	return -60.0


## Visual theme. Keys: name, floor/floor_line/wall/wall_line/block/block_line,
## accent, accent_energy, sun_rot (Vector3 deg), sun_energy, sky_top,
## sky_horizon, sky_ground, ambient_energy, fog_color (optional), fog_density.
func theme() -> Dictionary:
	return {"name": "default"}


## ---- public contract (SIM + client) ----------------------------------------

func get_spawn_points() -> Array:
	return spawns()


func get_jump_pads() -> Array:
	return jump_pads()


func get_team_spawns() -> Dictionary:
	return team_spawns()


func get_pickups() -> Array:
	return pickups()


func get_kill_z() -> float:
	return kill_z()


## ---- construction -----------------------------------------------------------

func _ready() -> void:
	_build_geometry()
	_build_props()
	_build_environment()
	_bake_navmesh()


func _build_geometry() -> void:
	var mats: Array = ArenaMaterials.themed_set(theme())
	for b in boxes():
		var rot: Vector3 = b[3] if b.size() > 3 else Vector3.ZERO
		_add_box(b[0], b[1], mats[b[2]], rot)
	for r in ramps():
		_add_ramp(r[0], r[1], r[2], mats[2])
	for b in barriers():
		_add_barrier(b[0], b[1])
	for p in jump_pads():
		_add_pad_visual(p[0])


func _add_barrier(center: Vector3, size: Vector3) -> void:
	var body := StaticBody3D.new()
	body.position = center
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	body.add_child(col)
	add_child(body)


func _build_props() -> void:
	for row in props():
		var path: String = row[0]
		var pos: Vector3 = row[1]
		var yaw_deg: float = row[2] if row.size() > 2 else 0.0
		var scale_f: float = row[3] if row.size() > 3 else 1.0
		var collider: Vector3 = row[4] if row.size() > 4 else Vector3.ZERO
		var packed: PackedScene = load(path)
		if packed == null:
			push_warning("arena prop missing: " + path)
			continue
		var model: Node3D = packed.instantiate()
		model.rotation_degrees = Vector3(0, yaw_deg, 0)
		model.scale = Vector3.ONE * scale_f
		if collider == Vector3.ZERO:
			model.position = pos
			add_child(model)
		else:
			var body := StaticBody3D.new()
			body.position = pos
			body.rotation_degrees = Vector3(0, yaw_deg, 0)
			body.collision_layer = WORLD_LAYER
			body.collision_mask = 0
			var col := CollisionShape3D.new()
			var shape := BoxShape3D.new()
			shape.size = collider
			col.shape = shape
			col.position.y = collider.y * 0.5  # props sit on their origin (base)
			body.add_child(col)
			model.rotation_degrees = Vector3.ZERO  # body already carries the yaw
			body.add_child(model)
			add_child(body)


func _add_box(center: Vector3, size: Vector3, mat: Material, rot_deg := Vector3.ZERO) -> void:
	var body := StaticBody3D.new()
	body.position = center
	body.rotation_degrees = rot_deg
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mi.mesh = mesh
	mi.material_override = mat
	body.add_child(mi)
	add_child(body)


## Ramp surface runs exactly through the two edge centers; slightly overlong to seal seams.
func _add_ramp(bottom: Vector3, top: Vector3, width: float, mat: Material) -> void:
	var d := top - bottom
	var horiz := Vector3(d.x, 0, d.z)
	var yaw := atan2(horiz.x, horiz.z)
	var pitch := atan2(d.y, horiz.length())
	var basis := Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, -pitch)
	var thickness := 0.5
	var length := d.length() + 0.6
	var center := (bottom + top) * 0.5 - basis.y * (thickness * 0.5)

	var body := StaticBody3D.new()
	body.transform = Transform3D(basis, center)
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(width, thickness, length)
	col.shape = shape
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(width, thickness, length)
	mi.mesh = mesh
	mi.material_override = mat
	body.add_child(mi)
	add_child(body)


func _add_pad_visual(pos: Vector3) -> void:
	var packed: PackedScene = load("res://assets/models/pickups/jump_pad.glb")
	if packed != null:
		var model: Node3D = packed.instantiate()
		model.position = pos
		add_child(model)
		return
	var mi := MeshInstance3D.new()  # fallback: flat disc
	var mesh := CylinderMesh.new()
	mesh.top_radius = 1.5
	mesh.bottom_radius = 1.5
	mesh.height = 0.15
	mi.mesh = mesh
	mi.material_override = ArenaMaterials.accent_mat()
	mi.position = pos + Vector3(0, 0.075, 0)
	add_child(mi)


func _build_environment() -> void:
	var t := theme()
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = t.get("sun_rot", Vector3(-50, 35, 0))
	sun.shadow_enabled = true
	sun.light_energy = t.get("sun_energy", 1.2)
	add_child(sun)

	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(t.get("sky_top", "1a2038"))
	sky_mat.sky_horizon_color = Color(t.get("sky_horizon", "46507a"))
	sky_mat.ground_bottom_color = Color(t.get("sky_ground", "14172a"))
	sky_mat.ground_horizon_color = Color(t.get("sky_horizon", "46507a"))
	var sky := Sky.new()
	sky.sky_material = sky_mat

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = t.get("ambient_energy", 0.7)
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.ssao_enabled = true
	env.ssao_intensity = 1.5
	env.glow_enabled = true
	env.glow_bloom = 0.15
	env.glow_hdr_threshold = 1.1
	if t.has("fog_color"):
		env.fog_enabled = true
		env.fog_light_color = Color(t["fog_color"])
		env.fog_density = t.get("fog_density", 0.01)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)


func _bake_navmesh() -> void:
	var nm := NavigationMesh.new()
	nm.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nm.agent_radius = 0.5
	nm.agent_height = 1.8
	nm.agent_max_slope = 40.0
	navigation_mesh = nm
	bake_finished.connect(func() -> void:
		baked = true
		ready_for_match.emit(), CONNECT_ONE_SHOT)
	bake_navigation_mesh(true)
