## Weapon definitions + aim math. Data only — firing is resolved by the SIM.
## All names and stats are original.
##
## Optional def fields the SIM honors:
##   "gravity": float     projectile drop (m/s^2), e.g. the Lobber's grenades
##   "knock_mult": float  knockback multiplier (Nova Cannon rocket-jump king)

const DEFS := [
	{
		"name": "Pulse Rifle", "hitscan": true, "damage": 10, "cooldown": 0.1,
		"spread": 0.015, "pellets": 1, "ammo_max": 100, "range": 100.0,
	},
	{
		"name": "Thumper", "hitscan": false, "damage": 90, "cooldown": 0.8,
		"spread": 0.0, "pellets": 1, "ammo_max": 20, "speed": 25.0,
		"splash_radius": 3.5, "splash_damage": 80, "ttl": 6.0,
	},
	{
		"name": "Scattergun", "hitscan": true, "damage": 9, "cooldown": 0.9,
		"spread": 0.06, "pellets": 8, "ammo_max": 30, "range": 40.0,
	},
	{
		"name": "Longshot", "hitscan": true, "damage": 80, "cooldown": 1.2,
		"spread": 0.0, "pellets": 1, "ammo_max": 15, "range": 200.0,
	},
	{
		"name": "Viper", "hitscan": true, "damage": 22, "cooldown": 0.28,
		"spread": 0.01, "pellets": 1, "ammo_max": 60, "range": 80.0,
	},
	{
		"name": "Ion Splatter", "hitscan": false, "damage": 16, "cooldown": 0.14,
		"spread": 0.012, "pellets": 1, "ammo_max": 90, "speed": 40.0,
		"splash_radius": 1.2, "splash_damage": 10, "ttl": 2.0,
	},
	{
		"name": "Nova Cannon", "hitscan": false, "damage": 70, "cooldown": 1.0,
		"spread": 0.0, "pellets": 1, "ammo_max": 12, "speed": 35.0,
		"splash_radius": 4.0, "splash_damage": 60, "ttl": 6.0, "knock_mult": 1.8,
	},
	{
		"name": "Circuit Blade", "hitscan": true, "damage": 75, "cooldown": 0.6,
		"spread": 0.0, "pellets": 1, "ammo_max": 999, "range": 2.4,
	},
	{
		"name": "Lobber", "hitscan": false, "damage": 65, "cooldown": 0.7,
		"spread": 0.0, "pellets": 1, "ammo_max": 24, "speed": 18.0,
		"gravity": 14.0, "splash_radius": 3.0, "splash_damage": 55, "ttl": 2.5,
	},
]

const COUNT := 9
const MELEE := 7                       # always in every loadout
const SWITCH_LOCK := 0.25              # seconds of cooldown applied on weapon swap
const GUN_POOL := [0, 1, 2, 3, 4, 5, 6, 8]  # loadout-pickable weapons (all but melee)


static func full_ammo() -> Dictionary:
	var out := {}
	for i in DEFS.size():
		out[i] = DEFS[i]["ammo_max"]
	return out


## Slots 1-4 = guns, slot 5 = melee. Keys 1-5 select carried[i].
static func default_loadout() -> Array:
	return [0, 2, 1, 3, MELEE]


static func view_dir(yaw: float, pitch: float) -> Vector3:
	return Basis.from_euler(Vector3(pitch, yaw, 0)) * Vector3.FORWARD


## Uniform jitter inside a cone; `spread` is the cone half-angle in radians.
static func spread_dir(dir: Vector3, spread: float, rng: RandomNumberGenerator) -> Vector3:
	if spread <= 0.0:
		return dir
	var basis := Basis.looking_at(dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT)
	var angle := rng.randf() * TAU
	var radius := sqrt(rng.randf()) * spread
	var offset := (basis.x * cos(angle) + basis.y * sin(angle)) * radius
	return (dir + offset).normalized()
