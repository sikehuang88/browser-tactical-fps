extends "res://scenes/arena_base.gd"
## GLACIER POST — bright snow outpost. Four corner buildings around an open
## courtyard, two with accessible roofs; a central bunker holds the uber armor;
## sandbag lines and watchtowers cut the courtyard into lanes.

const BOXES: Array = [
	# snow courtyard (top y=0), 52 x 52
	[Vector3(0, -0.5, 0), Vector3(52, 1, 52), 0],
	# perimeter walls, 6 m
	[Vector3(0, 3, -26.5), Vector3(54, 6, 1), 1],
	[Vector3(0, 3, 26.5), Vector3(54, 6, 1), 1],
	[Vector3(26.5, 3, 0), Vector3(1, 6, 54), 1],
	[Vector3(-26.5, 3, 0), Vector3(1, 6, 54), 1],
	# four corner buildings 10x10, 5 m tall (roofs walkable on NE & SW)
	[Vector3(17, 2.5, 17), Vector3(10, 5, 10), 1],
	[Vector3(-17, 2.5, 17), Vector3(10, 5, 10), 1],
	[Vector3(17, 2.5, -17), Vector3(10, 5, 10), 1],
	[Vector3(-17, 2.5, -17), Vector3(10, 5, 10), 1],
	# central bunker (top y=2.5)
	[Vector3(0, 1.25, 0), Vector3(8, 2.5, 8), 2],
	# courtyard cover blocks
	[Vector3(9, 1, -9), Vector3(3, 2, 2), 2],
	[Vector3(-9, 1, 9), Vector3(3, 2, 2), 2],
	[Vector3(0, 0.75, -14), Vector3(4, 1.5, 2), 2],
	[Vector3(0, 0.75, 14), Vector3(4, 1.5, 2), 2],
]

const RAMPS: Array = [
	# roofs of the NE and SW buildings
	[Vector3(17, 0, 4), Vector3(17, 5, 12), 4.0],
	[Vector3(-17, 0, -4), Vector3(-17, 5, -12), 4.0],
]

const JUMP_PADS: Array = [
	# onto the bunker roof
	[Vector3(0, 0, 6.5), Vector3(0, 9, -3), 1.3],
	[Vector3(0, 0, -6.5), Vector3(0, 9, 3), 1.3],
	# courtyard to roof shortcuts (NE / SW)
	[Vector3(10, 0, 17), Vector3(4, 11, 0), 1.3],
	[Vector3(-10, 0, -17), Vector3(-4, 11, 0), 1.3],
]

const SPAWNS: Array = [
	Vector3(21, 0, 21), Vector3(-21, 0, 21), Vector3(21, 0, -21), Vector3(-21, 0, -21),
	Vector3(17, 5, 17), Vector3(-17, 5, -17), Vector3(0, 0, 21), Vector3(0, 0, -21),
]

## Team split along Z: red (1) south, blue (2) north.
const TEAM_SPAWNS := {
	1: [Vector3(21, 0, 21), Vector3(-21, 0, 21), Vector3(17, 5, 17), Vector3(0, 0, 21)],
	2: [Vector3(21, 0, -21), Vector3(-21, 0, -21), Vector3(-17, 5, -17), Vector3(0, 0, -21)],
}

const PICKUPS: Array = [
	["armor_u", Vector3(0, 2.5, 0)],        # bunker roof — the fight
	["health_l", Vector3(13, 0, -13)], ["health_l", Vector3(-13, 0, 13)],
	["health_s", Vector3(5, 0, 13)], ["health_s", Vector3(-5, 0, -13)],
	["armor_s", Vector3(13, 0, 5)], ["armor_s", Vector3(-13, 0, -5)],
	["ammo_s", Vector3(17, 5, 14)], ["ammo_s", Vector3(-17, 5, -14)],
	["ammo_l", Vector3(6, 0, -14)],
]

const PROPS: Array = [
	["res://assets/models/env/snow/sandbag_wall.glb", Vector3(8, 0, 0), 90.0, 1.0, Vector3(0.5, 0.9, 1.8)],
	["res://assets/models/env/snow/sandbag_wall.glb", Vector3(-8, 0, 0), 90.0, 1.0, Vector3(0.5, 0.9, 1.8)],
	["res://assets/models/env/snow/sandbag_wall.glb", Vector3(0, 0, 8.6), 0.0, 1.0, Vector3(1.8, 0.9, 0.5)],
	["res://assets/models/env/snow/sandbag_wall.glb", Vector3(0, 0, -8.6), 0.0, 1.0, Vector3(1.8, 0.9, 0.5)],
	["res://assets/models/env/snow/watchtower.glb", Vector3(0, 0, 22), 180.0, 1.0, Vector3(1.4, 4.5, 1.4)],
	["res://assets/models/env/snow/watchtower.glb", Vector3(0, 0, -22), 0.0, 1.0, Vector3(1.4, 4.5, 1.4)],
	["res://assets/models/env/snow/floodlight.glb", Vector3(22, 0, 0), -90.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/snow/floodlight.glb", Vector3(-22, 0, 0), 90.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/snow/crate_snow.glb", Vector3(10, 0, 22), 20.0, 1.0, Vector3(1.3, 1.3, 1.3)],
	["res://assets/models/env/snow/crate_snow.glb", Vector3(-10, 0, -22), -35.0, 1.0, Vector3(1.3, 1.3, 1.3)],
	["res://assets/models/env/snow/fence_seg.glb", Vector3(11.5, 0, 11.5), 45.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/snow/fence_seg.glb", Vector3(-11.5, 0, -11.5), 45.0, 1.0, Vector3.ZERO],
]


## Invisible out-of-bounds guard above the 6 m visual walls.
const BARRIERS: Array = [
	[Vector3(0, 23, -26.5), Vector3(54, 34, 1)],
	[Vector3(0, 23, 26.5), Vector3(54, 34, 1)],
	[Vector3(26.5, 23, 0), Vector3(1, 34, 54)],
	[Vector3(-26.5, 23, 0), Vector3(1, 34, 54)],
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
		"name": "glacier",
		"floor": "d9dee6", "floor_line": "aeb6c4",
		"wall": "6d7686", "wall_line": "8b95a8",
		"block": "505a6e", "block_line": "6b7891",
		"accent": "e5484d", "accent_energy": 1.8,
		"sun_rot": Vector3(-48, -30, 0), "sun_energy": 1.4,
		"sky_top": "9fb3cf", "sky_horizon": "dfe8f2", "sky_ground": "8a97ad",
		"ambient_energy": 1.0,
		"fog_color": "dfe8f2", "fog_density": 0.006,
	}
