extends Node3D
## Presentation mirrors for every non-local player: 3D character model + held
## weapon + name label, team tint, invuln flicker, corpse tip-over on death.
## Reads SIM state only.

const ModelTools := preload("res://client/model_tools.gd")

const CHAR_SCENES := [
	"res://assets/models/characters/char_vanguard.glb",
	"res://assets/models/characters/char_ashfang.glb",
	"res://assets/models/characters/char_circuit.glb",
]

const TEAM_COLORS := {1: Color("d93a3a"), 2: Color("3e63dd")}

const BODY_COLORS := [
	Color("e05656"), Color("56aee0"), Color("62d47a"), Color("d4b542"),
	Color("b062d4"), Color("d47f42"), Color("42d4c3"), Color("d4629e"),
]

var sim: Node3D
var local_id := ""

var _rigs: Dictionary = {}       # player id -> Node3D
var _rig_weapon: Dictionary = {} # player id -> currently shown weapon id


func _ready() -> void:
	process_physics_priority = 30


func _physics_process(_dt: float) -> void:
	if sim == null:
		return
	for p: RefCounted in sim.players.values():
		if p.id == local_id:
			continue
		var rig: Node3D = _rigs.get(p.id)
		if rig == null:
			rig = _make_rig(p)
			_rigs[p.id] = rig
		rig.visible = p.alive
		if not p.alive:
			continue
		rig.global_position = p.body.global_position - Vector3(0, p.capsule_half_height(), 0)
		rig.rotation = Vector3(0, p.yaw, 0)
		_update_weapon(p, rig)
		var model: Node3D = rig.get_node_or_null("Model")
		if model != null:
			var t := 0.0
			if p.invuln_t > 0.0:
				t = 0.65 if int(p.invuln_t * 12.0) % 2 == 0 else 0.15
			ModelTools.set_transparency(model, t)


func handle(ev: Dictionary) -> void:
	if ev["type"] == "death" and ev["id"] != local_id:
		_corpse(ev["pos"], ev["id"])
	elif ev["type"] == "spawn" and _rigs.has(ev["id"]):
		_rigs[ev["id"]].reset_physics_interpolation()


func _tint_for(p: RefCounted) -> Color:
	if p.team in TEAM_COLORS:
		return TEAM_COLORS[p.team]
	return BODY_COLORS[absi(p.id.hash()) % BODY_COLORS.size()]


func _make_rig(p: RefCounted) -> Node3D:
	var rig := Node3D.new()
	add_child(rig)

	var packed: PackedScene = load(CHAR_SCENES[absi(p.id.hash()) % CHAR_SCENES.size()])
	if packed != null:
		var model: Node3D = packed.instantiate()
		model.name = "Model"
		ModelTools.retint(model, ["pb_team"], _tint_for(p))
		rig.add_child(model)
	else:
		var body := MeshInstance3D.new()
		body.name = "Model"
		var capsule := CapsuleMesh.new()
		capsule.radius = 0.4
		capsule.height = 1.8
		body.mesh = capsule
		body.position.y = 0.9
		body.material_override = _color_mat(_tint_for(p))
		rig.add_child(body)

	var gun := Node3D.new()
	gun.name = "Gun"
	gun.position = Vector3(0.34, 1.08, -0.28)
	rig.add_child(gun)

	var label := Label3D.new()
	label.name = "Tag"
	label.text = p.display_name
	label.position = Vector3(0, 2.15, 0)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 40
	label.outline_size = 8
	label.pixel_size = 0.004
	label.modulate = _tint_for(p).lightened(0.35)
	rig.add_child(label)
	_update_label(p, label)

	rig.global_position = p.body.global_position - Vector3(0, p.capsule_half_height(), 0)
	rig.reset_physics_interpolation()
	return rig


## Team modes: only teammates keep a name tag (enemies stay anonymous).
func _update_label(p: RefCounted, label: Label3D) -> void:
	var local: RefCounted = sim.get_player(local_id)
	if local != null and local.team != 0:
		label.visible = p.team == local.team
	else:
		label.visible = true


func _update_weapon(p: RefCounted, rig: Node3D) -> void:
	if _rig_weapon.get(p.id, -1) == p.weapon:
		return
	_rig_weapon[p.id] = p.weapon
	var gun: Node3D = rig.get_node_or_null("Gun")
	if gun == null:
		return
	for c in gun.get_children():
		c.queue_free()
	var model := ModelTools.instantiate_weapon(p.weapon)
	if model != null:
		model.scale = Vector3.ONE * 0.7
		gun.add_child(model)


func _corpse(pos: Vector3, id: String) -> void:
	var rig: Node3D = _rigs.get(id)
	var corpse: Node3D = null
	if rig != null:
		var model: Node3D = rig.get_node_or_null("Model")
		if model != null:
			corpse = model.duplicate()
	if corpse == null:
		var mesh := MeshInstance3D.new()
		var capsule := CapsuleMesh.new()
		capsule.radius = 0.4
		capsule.height = 1.8
		mesh.mesh = capsule
		mesh.material_override = _color_mat(BODY_COLORS[absi(id.hash()) % BODY_COLORS.size()].darkened(0.3))
		corpse = mesh
	add_child(corpse)
	corpse.global_position = pos - Vector3(0, 0.8, 0)
	var tw := corpse.create_tween()
	tw.set_parallel(true)
	tw.tween_property(corpse, "rotation:z", PI / 2, 0.4).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
	tw.chain().tween_interval(1.2)
	tw.chain().tween_method(func(v: float) -> void:
		ModelTools.set_transparency(corpse, v), 0.0, 1.0, 0.6)
	tw.chain().tween_callback(corpse.queue_free)


func _color_mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.6
	return m
