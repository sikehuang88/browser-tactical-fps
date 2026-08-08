extends Node3D
## Presentation-only combat effects: tracers, muzzle flash, explosions,
## projectile mirrors, first-person viewmodel. Reads SIM events/state only.

const ArenaMaterials := preload("res://client/materials.gd")
const ModelTools := preload("res://client/model_tools.gd")

var sim: Node3D
var camera: Camera3D
var local_id := ""
var initial_weapon := 0
var finish_color := ""  # "" = authored colors; else hex from Profile

var _proj_nodes: Dictionary = {}
var _viewmodel: Node3D
var _vm_kick := 0.0
var _tracer_mat: StandardMaterial3D
var _flash_mat: StandardMaterial3D


func _ready() -> void:
	process_physics_priority = 30  # after the SIM tick
	_tracer_mat = _emissive(Color("aef4ff"), 2.2)
	_flash_mat = _emissive(Color("ffb066"), 3.0)
	_build_viewmodel()


func _build_viewmodel() -> void:
	if camera == null:
		return
	_viewmodel = Node3D.new()
	_viewmodel.position = Vector3(0.3, -0.26, -0.35)
	camera.add_child(_viewmodel)
	_refresh_viewmodel(initial_weapon)


func _refresh_viewmodel(weapon: int) -> void:
	if _viewmodel == null:
		return
	for c in _viewmodel.get_children():
		c.queue_free()
	var model := ModelTools.instantiate_weapon(weapon)
	if model != null:
		model.scale = Vector3.ONE * 0.75
		if finish_color != "":
			ModelTools.retint(model, ["accent", "glow"], Color(finish_color))
		_viewmodel.add_child(model)
		return
	# fallback: simple procedural stand-in
	var body := MeshInstance3D.new()
	var body_mesh := BoxMesh.new()
	body_mesh.size = Vector3(0.09, 0.11, 0.34)
	body.mesh = body_mesh
	body.material_override = ArenaMaterials.block_mat()
	_viewmodel.add_child(body)


func handle(ev: Dictionary) -> void:
	match ev["type"]:
		"fire":
			for impact: Dictionary in ev["impacts"]:
				_tracer(ev["origin"], impact["pos"])
				_impact_flash(impact["pos"])
			if ev["id"] == local_id:
				_vm_kick = 0.09
		"explosion":
			_explosion(ev["pos"])
		"weapon_switch":
			if ev["id"] == local_id:
				_refresh_viewmodel(ev["weapon"])


func _process(dt: float) -> void:
	if _viewmodel != null:
		_vm_kick = lerpf(_vm_kick, 0.0, minf(dt * 12.0, 1.0))
		_viewmodel.position.z = -0.35 + _vm_kick


func _physics_process(_dt: float) -> void:
	if sim == null:
		return
	var live := {}
	for pr: Dictionary in sim.get_projectiles():
		live[pr["id"]] = true
		var node: MeshInstance3D = _proj_nodes.get(pr["id"])
		if node == null:
			node = MeshInstance3D.new()
			var mesh := SphereMesh.new()
			mesh.radius = 0.12
			mesh.height = 0.24
			node.mesh = mesh
			node.material_override = _flash_mat
			var light := OmniLight3D.new()
			light.light_color = Color("ffa040")
			light.omni_range = 4.0
			light.light_energy = 1.4
			node.add_child(light)
			add_child(node)
			node.global_position = pr["pos"]
			node.reset_physics_interpolation()
			_proj_nodes[pr["id"]] = node
		node.global_position = pr["pos"]
	for id in _proj_nodes.keys():
		if not live.has(id):
			_proj_nodes[id].queue_free()
			_proj_nodes.erase(id)


func _tracer(from: Vector3, to: Vector3) -> void:
	var seg := to - from
	if seg.length() < 0.5:
		return
	var node := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.015
	mesh.bottom_radius = 0.015
	mesh.height = seg.length()
	node.mesh = mesh
	node.material_override = _tracer_mat
	add_child(node)
	# cylinder axis is Y; align it with the segment
	node.global_position = from + seg * 0.5
	if absf(seg.normalized().dot(Vector3.UP)) < 0.99:
		node.look_at(to, Vector3.UP)
	node.rotate_object_local(Vector3.RIGHT, PI / 2)
	_fade_out(node, 0.07)


func _impact_flash(pos: Vector3) -> void:
	var node := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.09
	mesh.height = 0.18
	node.mesh = mesh
	node.material_override = _flash_mat
	add_child(node)
	node.global_position = pos
	_fade_out(node, 0.12)


func _explosion(pos: Vector3) -> void:
	var node := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.4
	mesh.height = 0.8
	node.mesh = mesh
	node.material_override = _emissive(Color("ff8c3a"), 2.6)
	var light := OmniLight3D.new()
	light.light_color = Color("ff9550")
	light.omni_range = 9.0
	light.light_energy = 4.0
	node.add_child(light)
	add_child(node)
	node.global_position = pos
	var tw := node.create_tween()
	tw.set_parallel(true)
	tw.tween_property(node, "scale", Vector3.ONE * 7.0, 0.28).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(node, "transparency", 1.0, 0.28)
	tw.tween_property(light, "light_energy", 0.0, 0.28)
	tw.chain().tween_callback(node.queue_free)


func _fade_out(node: Node3D, secs: float) -> void:
	var tw := node.create_tween()
	tw.tween_property(node, "transparency", 1.0, secs)
	tw.tween_callback(node.queue_free)


func _emissive(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return m
