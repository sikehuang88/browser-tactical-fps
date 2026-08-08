extends "res://scenes/arena_base.gd"
## FOUNDRY — the original arena blockout, now themed + dressed for v2.
## Geometry tables are unchanged from v1 (the smoke test asserts exact heights).

## Static boxes: [center, size, material_id, rotation_degrees]
const BOXES: Array = [
	# floor slab (top at y=0)
	[Vector3(0, -0.5, 0), Vector3(48, 1, 48), 0],
	# perimeter walls, 8 m tall
	[Vector3(0, 4, -24.5), Vector3(50, 8, 1), 1],
	[Vector3(0, 4, 24.5), Vector3(50, 8, 1), 1],
	[Vector3(24.5, 4, 0), Vector3(1, 8, 48), 1],
	[Vector3(-24.5, 4, 0), Vector3(1, 8, 48), 1],
	# central crown — solid raised platform, top at y=3
	[Vector3(0, 1.5, 0), Vector3(12, 3, 12), 2],
	# side decks, tops at y=4
	[Vector3(19, 3.75, 5), Vector3(10, 0.5, 30), 2],    # E deck, z -10..20
	[Vector3(-19, 3.75, -5), Vector3(10, 0.5, 30), 2],  # W deck, z -20..10
	# cover blocks
	[Vector3(7, 1, -14), Vector3(3, 2, 3), 2],
	[Vector3(-7, 1, 14), Vector3(3, 2, 3), 2],
	[Vector3(12, 0.75, -3), Vector3(2, 1.5, 4), 2],
	[Vector3(-12, 0.75, 3), Vector3(2, 1.5, 4), 2],
	[Vector3(3, 1.25, 16), Vector3(4, 2.5, 2), 2],
	[Vector3(-3, 1.25, -16), Vector3(4, 2.5, 2), 2],
	[Vector3(20, 2, -20), Vector3(2, 4, 2), 2],
	[Vector3(-20, 2, 20), Vector3(2, 4, 2), 2],
]

const RAMPS: Array = [
	[Vector3(0, 0, -12), Vector3(0, 3, -6), 4.0],     # crown N
	[Vector3(0, 0, 12), Vector3(0, 3, 6), 4.0],       # crown S
	[Vector3(19, 0, -20), Vector3(19, 4, -10), 8.0],  # E deck, north end
	[Vector3(-19, 0, 20), Vector3(-19, 4, 10), 8.0],  # W deck, south end
]

const JUMP_PADS: Array = [
	[Vector3(11, 0, 8), Vector3(6, 14, 0), 1.5],    # to E deck
	[Vector3(-11, 0, -8), Vector3(-6, 14, 0), 1.5], # to W deck
	[Vector3(0, 3, 0), Vector3(0, 16, 0), 1.5],     # crown vertical boost
]

const SPAWNS: Array = [
	Vector3(20, 0, 20), Vector3(-20, 0, 20), Vector3(14, 0, -18), Vector3(-20, 0, -18),
	Vector3(19, 4, 14), Vector3(-19, 4, -14), Vector3(0, 3, 3), Vector3(0, 0, -18),
]

## Team split along Z: red (1) south side, blue (2) north side.
const TEAM_SPAWNS := {
	1: [Vector3(20, 0, 20), Vector3(-20, 0, 20), Vector3(19, 4, 14), Vector3(0, 0, 18)],
	2: [Vector3(14, 0, -18), Vector3(-20, 0, -18), Vector3(-19, 4, -14), Vector3(0, 0, -18)],
}

const PICKUPS: Array = [
	["health_s", Vector3(10, 0, 10)], ["health_s", Vector3(-10, 0, -10)],
	["health_u", Vector3(-19, 4, 0)],
	["armor_s", Vector3(14, 0, 18)], ["armor_s", Vector3(-14, 0, -18)],
	["armor_l", Vector3(19, 4, 8)],
	["armor_u", Vector3(-3, 3, 0)],
	["ammo_s", Vector3(20, 0, -8)], ["ammo_s", Vector3(-20, 0, 8)],
	["ammo_l", Vector3(0, 0, 18)],
]

const PROPS: Array = [
	["res://assets/models/env/industrial/crate_l.glb", Vector3(22.5, 0, -12), 15.0, 1.0, Vector3(1.7, 1.7, 1.7)],
	["res://assets/models/env/industrial/crate_s.glb", Vector3(22.5, 1.7, -12), 40.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/barrel.glb", Vector3(22.7, 0, 6), 0.0, 1.0, Vector3(0.8, 1.0, 0.8)],
	["res://assets/models/env/industrial/cable_drum.glb", Vector3(-22.5, 0, 8), 75.0, 1.0, Vector3(1.2, 1.2, 1.2)],
	["res://assets/models/env/industrial/crate_s.glb", Vector3(-22.6, 0, -8), -20.0, 1.0, Vector3(0.9, 0.9, 0.9)],
	["res://assets/models/env/industrial/pillar.glb", Vector3(23.2, 0, 23.2), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/pillar.glb", Vector3(-23.2, 0, 23.2), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/pillar.glb", Vector3(23.2, 0, -23.2), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/pillar.glb", Vector3(-23.2, 0, -23.2), 0.0, 1.0, Vector3.ZERO],
]


## Invisible out-of-bounds guard above the 8 m visual walls.
const BARRIERS: Array = [
	[Vector3(0, 24, -24.5), Vector3(50, 32, 1)],
	[Vector3(0, 24, 24.5), Vector3(50, 32, 1)],
	[Vector3(24.5, 24, 0), Vector3(1, 32, 48)],
	[Vector3(-24.5, 24, 0), Vector3(1, 32, 48)],
]


func boxes() -> Array: return BOXES
func ramps() -> Array: return RAMPS
func jump_pads() -> Array: return JUMP_PADS
func spawns() -> Array: return SPAWNS
func team_spawns() -> Dictionary: return TEAM_SPAWNS
func pickups() -> Array: return PICKUPS
func props() -> Array: return PROPS
func barriers() -> Array: return BARRIERS


func theme() -> Dictionary:
	return {
		"name": "foundry",
		"floor": "23283d", "floor_line": "3a4160",
		"wall": "2b3048", "wall_line": "424a6e",
		"block": "343b58", "block_line": "4d5680",
		"accent": "ff7a1a",
		"sun_rot": Vector3(-50, 35, 0), "sun_energy": 1.2,
		"sky_top": "1a2038", "sky_horizon": "46507a", "sky_ground": "14172a",
		"ambient_energy": 0.7,
	}
