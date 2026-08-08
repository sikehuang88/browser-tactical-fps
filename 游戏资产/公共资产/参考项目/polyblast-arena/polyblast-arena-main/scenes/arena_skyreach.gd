extends "res://scenes/arena_base.gd"
## SKYREACH — floating platforms in the void. Two spawn islands joined to a
## raised center by twin bridges; jump pads reach two high side perches.
## Falling off is death (kill_z).

const BOXES: Array = [
	# spawn islands (tops at y=0), 16 x 16
	[Vector3(26, -0.5, 0), Vector3(16, 1, 16), 0],
	[Vector3(-26, -0.5, 0), Vector3(16, 1, 16), 0],
	# center platform (top y=2), 14 x 14
	[Vector3(0, 1.5, 0), Vector3(14, 1, 14), 2],
	[Vector3(0, 0.5, 0), Vector3(10, 1, 10), 2],  # underpinning (looks built, not floating slab)
	# twin bridges at ground level (tops y=0), islands -> center ramps
	[Vector3(12.5, -0.25, 6), Vector3(11, 0.5, 3), 2],
	[Vector3(12.5, -0.25, -6), Vector3(11, 0.5, 3), 2],
	[Vector3(-12.5, -0.25, 6), Vector3(11, 0.5, 3), 2],
	[Vector3(-12.5, -0.25, -6), Vector3(11, 0.5, 3), 2],
	# high side perches (tops y=4)
	[Vector3(13, 3.75, 14), Vector3(10, 0.5, 8), 2],
	[Vector3(-13, 3.75, -14), Vector3(10, 0.5, 8), 2],
	# island back walls (cover + spawn protection), 2.5 m
	[Vector3(33.5, 1.25, 0), Vector3(1, 2.5, 12), 1],
	[Vector3(-33.5, 1.25, 0), Vector3(1, 2.5, 12), 1],
	# center dais cover blocks
	[Vector3(0, 2.75, -5), Vector3(4, 1.5, 1.5), 3],
	[Vector3(0, 2.75, 5), Vector3(4, 1.5, 1.5), 3],
	# island cover crates (built-in)
	[Vector3(22, 1, 6), Vector3(2.5, 2, 2.5), 2],
	[Vector3(-22, 1, -6), Vector3(2.5, 2, 2.5), 2],
]

const RAMPS: Array = [
	# bridge ends up onto the center platform
	[Vector3(11, 0, 6), Vector3(7, 2, 6), 3.0],
	[Vector3(11, 0, -6), Vector3(7, 2, -6), 3.0],
	[Vector3(-11, 0, 6), Vector3(-7, 2, 6), 3.0],
	[Vector3(-11, 0, -6), Vector3(-7, 2, -6), 3.0],
]

const JUMP_PADS: Array = [
	# island pads up to the side perches
	[Vector3(20, 0, 7), Vector3(-3.5, 12, 3.5), 1.4],
	[Vector3(-20, 0, -7), Vector3(3.5, 12, -3.5), 1.4],
	# perch pads back toward center (escape route)
	[Vector3(10, 4, 14), Vector3(-4, 9, -6), 1.2],
	[Vector3(-10, 4, -14), Vector3(4, 9, 6), 1.2],
]

const SPAWNS: Array = [
	Vector3(26, 0, 5), Vector3(26, 0, -5), Vector3(30, 0, 0), Vector3(22, 0, 0),
	Vector3(-26, 0, 5), Vector3(-26, 0, -5), Vector3(-30, 0, 0), Vector3(-22, 0, 0),
]

const TEAM_SPAWNS := {
	1: [Vector3(26, 0, 5), Vector3(26, 0, -5), Vector3(30, 0, 0), Vector3(22, 0, 0)],
	2: [Vector3(-26, 0, 5), Vector3(-26, 0, -5), Vector3(-30, 0, 0), Vector3(-22, 0, 0)],
}

const PICKUPS: Array = [
	["health_u", Vector3(13, 4, 14)],       # side perch
	["armor_u", Vector3(-13, 4, -14)],      # opposite perch
	["armor_l", Vector3(0, 2, 0)],          # center — contested
	["ammo_l", Vector3(0, 2, 5)],
	["health_s", Vector3(12, 0, 6)], ["health_s", Vector3(-12, 0, -6)],
	["armor_s", Vector3(22, 0, -6)], ["armor_s", Vector3(-22, 0, 6)],
	["ammo_s", Vector3(26, 0, -7)], ["ammo_s", Vector3(-26, 0, 7)],
]

const PROPS: Array = [
	["res://assets/models/env/space/pylon_glow.glb", Vector3(32.5, 0, 7), 0.0, 1.0, Vector3(0.7, 2.2, 0.7)],
	["res://assets/models/env/space/pylon_glow.glb", Vector3(32.5, 0, -7), 0.0, 1.0, Vector3(0.7, 2.2, 0.7)],
	["res://assets/models/env/space/pylon_glow.glb", Vector3(-32.5, 0, 7), 0.0, 1.0, Vector3(0.7, 2.2, 0.7)],
	["res://assets/models/env/space/pylon_glow.glb", Vector3(-32.5, 0, -7), 0.0, 1.0, Vector3(0.7, 2.2, 0.7)],
	["res://assets/models/env/space/antenna.glb", Vector3(30, 0, 6), 30.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/antenna.glb", Vector3(-30, 0, -6), -150.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/solar_fin.glb", Vector3(5, 2, -6.4), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/solar_fin.glb", Vector3(-5, 2, 6.4), 180.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/ring_arch.glb", Vector3(12.5, 0, 6), 90.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/ring_arch.glb", Vector3(-12.5, 0, -6), 90.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/edge_trim.glb", Vector3(0, 2, -7), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/edge_trim.glb", Vector3(0, 2, 7), 180.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/edge_trim.glb", Vector3(26, 0, 8), 180.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/space/edge_trim.glb", Vector3(-26, 0, -8), 0.0, 1.0, Vector3.ZERO],
]


func boxes() -> Array: return BOXES
func ramps() -> Array: return RAMPS
func jump_pads() -> Array: return JUMP_PADS
func spawns() -> Array: return SPAWNS
func team_spawns() -> Dictionary: return TEAM_SPAWNS
func pickups() -> Array: return PICKUPS
func props() -> Array: return PROPS


func kill_z() -> float:
	return -12.0


func theme() -> Dictionary:
	return {
		"name": "skyreach",
		"floor": "1b1e2e", "floor_line": "34395a",
		"wall": "20233a", "wall_line": "3a4066",
		"block": "232741", "block_line": "3d4468",
		"accent": "00e5ff", "accent_energy": 2.2,
		"sun_rot": Vector3(-35, 60, 0), "sun_energy": 0.9,
		"sky_top": "05060d", "sky_horizon": "141a33", "sky_ground": "05060d",
		"ambient_energy": 0.5,
	}
