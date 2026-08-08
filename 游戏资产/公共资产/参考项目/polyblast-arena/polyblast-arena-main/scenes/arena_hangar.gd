extends "res://scenes/arena_base.gd"
## HANGAR NINE — enclosed industrial hangar. Two ramps feed a central bridge
## with a tunnel beneath it (three-way contested center); sniper balconies on
## the east/west ends; wing walls break the long sightlines.

const BOXES: Array = [
	# floor slab (top at y=0), 56 x 36
	[Vector3(0, -0.5, 0), Vector3(56, 1, 36), 0],
	# perimeter walls, 10 m tall
	[Vector3(0, 5, -18.5), Vector3(58, 10, 1), 1],
	[Vector3(0, 5, 18.5), Vector3(58, 10, 1), 1],
	[Vector3(28.5, 5, 0), Vector3(1, 10, 38), 1],
	[Vector3(-28.5, 5, 0), Vector3(1, 10, 38), 1],
	# central bridge deck (top y=3.5), tunnel clearance 3.0 beneath
	[Vector3(0, 3.25, 0), Vector3(16, 0.5, 6), 2],
	# bridge support columns (frame the tunnel)
	[Vector3(-7.5, 1.5, -2.5), Vector3(1, 3, 1), 2],
	[Vector3(-7.5, 1.5, 2.5), Vector3(1, 3, 1), 2],
	[Vector3(7.5, 1.5, -2.5), Vector3(1, 3, 1), 2],
	[Vector3(7.5, 1.5, 2.5), Vector3(1, 3, 1), 2],
	# east / west sniper balconies (top y=4.5)
	[Vector3(26, 4.25, 0), Vector3(4, 0.5, 20), 2],
	[Vector3(-26, 4.25, 0), Vector3(4, 0.5, 20), 2],
	# wing walls breaking mid-court sightlines
	[Vector3(14, 2.5, -12), Vector3(2, 5, 12), 1],
	[Vector3(-14, 2.5, 12), Vector3(2, 5, 12), 1],
	# ground cover blocks
	[Vector3(6, 1, -13), Vector3(3, 2, 3), 2],
	[Vector3(-6, 1, 13), Vector3(3, 2, 3), 2],
	[Vector3(20, 1, 10), Vector3(4, 2, 2), 2],
	[Vector3(-20, 1, -10), Vector3(4, 2, 2), 2],
	# bridge-end parapets (cover on the deck)
	[Vector3(0, 4.0, -3.2), Vector3(6, 1, 0.4), 3],
	[Vector3(0, 4.0, 3.2), Vector3(6, 1, 0.4), 3],
]

const RAMPS: Array = [
	# onto the bridge from east / west
	[Vector3(14, 0, 0), Vector3(8, 3.5, 0), 6.0],
	[Vector3(-14, 0, 0), Vector3(-8, 3.5, 0), 6.0],
	# onto the balconies (hug the end walls)
	[Vector3(26, 0, 14), Vector3(26, 4.5, 10), 4.0],
	[Vector3(-26, 0, -14), Vector3(-26, 4.5, -10), 4.0],
]

const JUMP_PADS: Array = [
	# courtyard pads that pop you onto the bridge deck
	[Vector3(0, 0, 10), Vector3(0, 11, -4.5), 1.4],
	[Vector3(0, 0, -10), Vector3(0, 11, 4.5), 1.4],
	# corner pads up to the balconies
	[Vector3(21, 0, -13), Vector3(3, 12, 4), 1.4],
	[Vector3(-21, 0, 13), Vector3(-3, 12, -4), 1.4],
]

const SPAWNS: Array = [
	Vector3(24, 0, 15), Vector3(-24, 0, 15), Vector3(24, 0, -15), Vector3(-24, 0, -15),
	Vector3(26, 4.5, 6), Vector3(-26, 4.5, -6), Vector3(0, 0, 14), Vector3(0, 0, -14),
]

## Team split along X: red (1) east, blue (2) west.
const TEAM_SPAWNS := {
	1: [Vector3(24, 0, 15), Vector3(24, 0, -15), Vector3(26, 4.5, 6), Vector3(18, 0, 0)],
	2: [Vector3(-24, 0, 15), Vector3(-24, 0, -15), Vector3(-26, 4.5, -6), Vector3(-18, 0, 0)],
}

const PICKUPS: Array = [
	["health_u", Vector3(0, 3.5, 0)],      # bridge deck — contested
	["armor_u", Vector3(0, 0, 0)],         # tunnel below — vertical stack fight
	["health_l", Vector3(26, 4.5, 0)], ["health_l", Vector3(-26, 4.5, 0)],
	["health_s", Vector3(18, 0, 12)], ["health_s", Vector3(-18, 0, -12)],
	["armor_s", Vector3(10, 0, -12)], ["armor_s", Vector3(-10, 0, 12)],
	["ammo_s", Vector3(26, 4.5, -6)], ["ammo_s", Vector3(-26, 4.5, 6)],
	["ammo_l", Vector3(6, 0, 12)],
]

const PROPS: Array = [
	["res://assets/models/env/industrial/crate_l.glb", Vector3(16, 0, 10), 10.0, 1.0, Vector3(1.7, 1.7, 1.7)],
	["res://assets/models/env/industrial/crate_s.glb", Vector3(16, 1.7, 10), 55.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/crate_l.glb", Vector3(-16, 0, -10), -30.0, 1.0, Vector3(1.7, 1.7, 1.7)],
	["res://assets/models/env/industrial/barrel.glb", Vector3(18, 0, -8), 0.0, 1.0, Vector3(0.8, 1.0, 0.8)],
	["res://assets/models/env/industrial/barrel.glb", Vector3(-18, 0, 8), 0.0, 1.0, Vector3(0.8, 1.0, 0.8)],
	["res://assets/models/env/industrial/cable_drum.glb", Vector3(-22, 0, -14), 40.0, 1.0, Vector3(1.2, 1.2, 1.2)],
	["res://assets/models/env/industrial/pillar.glb", Vector3(27.4, 0, 17.4), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/pillar.glb", Vector3(-27.4, 0, 17.4), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/pillar.glb", Vector3(27.4, 0, -17.4), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/pillar.glb", Vector3(-27.4, 0, -17.4), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/rail_seg.glb", Vector3(-4, 3.5, -3.1), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/rail_seg.glb", Vector3(4, 3.5, 3.1), 0.0, 1.0, Vector3.ZERO],
	["res://assets/models/env/industrial/vent_fan.glb", Vector3(0, 6, -17.9), 0.0, 1.5, Vector3.ZERO],
	["res://assets/models/env/industrial/light_strip.glb", Vector3(12, 7, 17.9), 180.0, 1.5, Vector3.ZERO],
	["res://assets/models/env/industrial/light_strip.glb", Vector3(-12, 7, 17.9), 180.0, 1.5, Vector3.ZERO],
]


## Invisible out-of-bounds guard above the 10 m visual walls.
const BARRIERS: Array = [
	[Vector3(0, 25, -18.5), Vector3(58, 30, 1)],
	[Vector3(0, 25, 18.5), Vector3(58, 30, 1)],
	[Vector3(28.5, 25, 0), Vector3(1, 30, 38)],
	[Vector3(-28.5, 25, 0), Vector3(1, 30, 38)],
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
		"name": "hangar",
		"floor": "2a2d33", "floor_line": "44484f",
		"wall": "33373f", "wall_line": "4a505c",
		"block": "3c414b", "block_line": "565d6b",
		"accent": "ff7a1a",
		"sun_rot": Vector3(-62, 20, 0), "sun_energy": 1.0,
		"sky_top": "12151c", "sky_horizon": "3a414f", "sky_ground": "0d0f14",
		"ambient_energy": 0.62,
		"fog_color": "23262e", "fog_density": 0.004,
	}
