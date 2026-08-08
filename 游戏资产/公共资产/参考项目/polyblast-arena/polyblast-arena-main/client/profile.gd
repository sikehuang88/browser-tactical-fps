extends Node
## Autoload: persistent player profile — Points wallet, shop ownership,
## loadout, and settings. Saved to user://. CLIENT-only; the SIM never reads it.

const SAVE_PATH := "user://polyblast_profile.cfg"

## Shop catalog. kind: "character" (swaps the player model) or "finish"
## (retints weapon accent/glow materials). Costs are in Points.
const CATALOG := {
	"char_vanguard": {"name": "Vanguard", "kind": "character", "cost": 0,
		"scene": "res://assets/models/characters/char_vanguard.glb"},
	"char_ashfang": {"name": "Ashfang", "kind": "character", "cost": 4000,
		"scene": "res://assets/models/characters/char_ashfang.glb"},
	"char_circuit": {"name": "Circuit Warden", "kind": "character", "cost": 6000,
		"scene": "res://assets/models/characters/char_circuit.glb"},
	"finish_none": {"name": "Factory Finish", "kind": "finish", "cost": 0, "color": ""},
	"finish_frost": {"name": "Frost Finish", "kind": "finish", "cost": 1200, "color": "00e5ff"},
	"finish_venom": {"name": "Venom Finish", "kind": "finish", "cost": 1200, "color": "9be800"},
	"finish_royal": {"name": "Royal Finish", "kind": "finish", "cost": 1500, "color": "8b5cf6"},
	"finish_blush": {"name": "Blush Finish", "kind": "finish", "cost": 1500, "color": "ff3d81"},
	"finish_gold": {"name": "Gold Finish", "kind": "finish", "cost": 2500, "color": "e8b341"},
}

const POINTS_PER_KILL := 10
const POINTS_WIN_BONUS := 25

var points: int = 0
var owned: Array = ["char_vanguard", "finish_none"]
var loadout_weapons: Array = [0, 2, 1, 3]   # 4 gun slots; melee is always slot 5
var character: String = "char_vanguard"
var finish: String = "finish_none"


func _ready() -> void:
	load_profile()


func owns(id: String) -> bool:
	return id in owned


func can_buy(id: String) -> bool:
	return CATALOG.has(id) and not owns(id) and points >= CATALOG[id]["cost"]


func buy(id: String) -> bool:
	if not can_buy(id):
		return false
	points -= CATALOG[id]["cost"]
	owned.append(id)
	save_profile()
	return true


func add_points(amount: int) -> void:
	points += maxi(amount, 0)
	save_profile()


func set_loadout(weapons: Array) -> void:
	if weapons.size() == 4:
		loadout_weapons = weapons.duplicate()
		save_profile()


func set_character(id: String) -> void:
	if owns(id) and CATALOG.get(id, {}).get("kind", "") == "character":
		character = id
		save_profile()


func set_finish(id: String) -> void:
	if owns(id) and CATALOG.get(id, {}).get("kind", "") == "finish":
		finish = id
		save_profile()


func character_scene() -> String:
	return CATALOG[character]["scene"] if CATALOG.has(character) else CATALOG["char_vanguard"]["scene"]


## "" = keep authored weapon colors.
func finish_color() -> String:
	return CATALOG.get(finish, {}).get("color", "")


func save_profile() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("profile", "points", points)
	cfg.set_value("profile", "owned", owned)
	cfg.set_value("profile", "loadout_weapons", loadout_weapons)
	cfg.set_value("profile", "character", character)
	cfg.set_value("profile", "finish", finish)
	cfg.set_value("settings", "mouse_sensitivity", GameConfig.mouse_sensitivity)
	cfg.save(SAVE_PATH)


func load_profile() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) != OK:
		return
	points = cfg.get_value("profile", "points", 0)
	owned = cfg.get_value("profile", "owned", ["char_vanguard", "finish_none"])
	loadout_weapons = cfg.get_value("profile", "loadout_weapons", [0, 2, 1, 3])
	character = cfg.get_value("profile", "character", "char_vanguard")
	finish = cfg.get_value("profile", "finish", "finish_none")
	GameConfig.mouse_sensitivity = cfg.get_value("settings", "mouse_sensitivity", 0.0025)
	if not owns(character):
		character = "char_vanguard"
	if not owns(finish):
		finish = "finish_none"
