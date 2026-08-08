extends Node3D
## Presentation for SIM pickups: builds one GLB per pickup spot, spins/bobs it,
## and toggles visibility from SIM state. Reads SIM state only.

const KIND_MODELS := {
	"health_s": "res://assets/models/pickups/pickup_health_small.glb",
	"health_l": "res://assets/models/pickups/pickup_health_large.glb",
	"health_u": "res://assets/models/pickups/pickup_health_uber.glb",
	"armor_s": "res://assets/models/pickups/pickup_armor_small.glb",
	"armor_l": "res://assets/models/pickups/pickup_armor_large.glb",
	"armor_u": "res://assets/models/pickups/pickup_armor_uber.glb",
	"ammo_s": "res://assets/models/pickups/pickup_ammo_small.glb",
	"ammo_l": "res://assets/models/pickups/pickup_ammo_large.glb",
}

var sim: Node3D

var _nodes: Array = []
var _t := 0.0


func _ready() -> void:
	for pk: Dictionary in sim.get_pickup_state():
		var node := Node3D.new()
		node.position = pk["pos"] + Vector3(0, 0.55, 0)
		var path: String = KIND_MODELS.get(pk["kind"], "")
		var packed: PackedScene = load(path) if path != "" else null
		if packed != null:
			node.add_child(packed.instantiate())
		add_child(node)
		_nodes.append(node)


func _process(dt: float) -> void:
	if sim == null:
		return
	_t += dt
	var state: Array = sim.get_pickup_state()
	for i in mini(state.size(), _nodes.size()):
		var node: Node3D = _nodes[i]
		node.visible = state[i]["active"]
		if node.visible:
			node.rotation.y = wrapf(node.rotation.y + dt * 1.6, 0.0, TAU)
			node.position.y = state[i]["pos"].y + 0.55 + sin(_t * 2.0 + i) * 0.08
