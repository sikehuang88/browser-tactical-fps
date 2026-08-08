extends RefCounted
## SIM entity state for one player (human or bot). Pure data + its physics body.
## No input polling, no rendering — the CLIENT mirrors this, never writes it.

var id: String
var display_name: String
var is_bot: bool = false

## Physics body owned by the SIM (collision only, no visuals attached).
var body: CharacterBody3D
var velocity := Vector3.ZERO
var yaw: float = 0.0     # authoritative view angles (radians)
var pitch: float = 0.0
var crouching := false

## Combat (used from milestone 4/5 on)
var health: int = 100
var armor: int = 0                  # absorbs 2/3 of incoming damage while > 0
var alive := true
var respawn_t: float = 0.0
var invuln_t: float = 0.0
var weapon: int = 0
var ammo: Dictionary = {}
var cooldown: float = 0.0
var frags: int = 0
var deaths: int = 0
var team: int = 0                   # 0 = FFA / none, 1 = red, 2 = blue
var streak: int = 0                 # kills since last death (killstreak banners)
var carried: Array = []             # weapon ids this player can use (slots 1-5)

## Last intent received this tick. Bots and humans use the identical schema —
## this dictionary is the future ENet packet.
var intent: Dictionary = blank_intent()


static func blank_intent() -> Dictionary:
	return {
		"move": Vector2.ZERO,   # x = strafe right, y = forward
		"yaw": 0.0,
		"pitch": 0.0,
		"jump": false,
		"crouch": false,
		"fire": false,
		"weapon": -1,           # -1 = keep current
	}


func eye_height() -> float:
	return 0.65 if crouching else 1.55  # relative to capsule bottom


func feet_pos() -> Vector3:
	return body.global_position - Vector3(0, capsule_half_height(), 0)


func eye_pos() -> Vector3:
	return feet_pos() + Vector3(0, eye_height(), 0)


func capsule_half_height() -> float:
	return 0.6 if crouching else 0.9
