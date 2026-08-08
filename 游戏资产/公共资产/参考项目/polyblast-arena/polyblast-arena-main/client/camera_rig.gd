extends Node3D
## First-person camera rig. Position follows the SIM player's eye each physics
## tick (smoothed by built-in physics interpolation); rotation is applied
## per-render-frame by ClientMain for zero-latency mouse look.

var sim: Node3D
var player_id: String


func _ready() -> void:
	process_physics_priority = 20  # after the SIM tick (priority 10)


func _physics_process(_dt: float) -> void:
	if sim == null:
		return
	var p: RefCounted = sim.get_player(player_id)
	if p != null:
		global_position = p.eye_pos()
