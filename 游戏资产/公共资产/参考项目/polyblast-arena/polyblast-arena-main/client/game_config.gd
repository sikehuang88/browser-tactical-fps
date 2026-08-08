extends Node
## Autoload: match configuration + input action registration.
## CLIENT-owned convenience; SIM never reads Input, only the intents it is fed.

const FRAG_LIMIT_DEFAULT := 20

const MODES := ["Deathmatch", "Team Deathmatch", "Team Elimination"]

const MAPS := [
	{"name": "Foundry", "scene": "res://scenes/arena.tscn"},
	{"name": "Hangar Nine", "scene": "res://scenes/arena_hangar.tscn"},
	{"name": "Skyreach", "scene": "res://scenes/arena_skyreach.tscn"},
	{"name": "Glacier Post", "scene": "res://scenes/arena_glacier.tscn"},
]

var bot_count: int = 5
var difficulty: int = 1  # 0 = Easy, 1 = Normal, 2 = Hard
var frag_limit: int = FRAG_LIMIT_DEFAULT
var mode: int = 0        # index into MODES (SimWorld MODE_* ids match)
var map_index: int = 0   # index into MAPS
var time_limit_min: int = 10  # 0 = no time limit
var mouse_sensitivity: float = 0.0025

## Result of the last finished match, read by the summary screen.
var last_match_result: Dictionary = {}


func _init() -> void:
	_register_actions()


func map_scene() -> String:
	return MAPS[clampi(map_index, 0, MAPS.size() - 1)]["scene"]


func is_server_mode() -> bool:
	return "--server" in OS.get_cmdline_user_args()


func _register_actions() -> void:
	_key_action("move_forward", KEY_W)
	_key_action("move_back", KEY_S)
	_key_action("move_left", KEY_A)
	_key_action("move_right", KEY_D)
	_key_action("jump", KEY_SPACE)
	_key_action("crouch", KEY_CTRL)
	_key_action("weapon_1", KEY_1)
	_key_action("weapon_2", KEY_2)
	_key_action("weapon_3", KEY_3)
	_key_action("weapon_4", KEY_4)
	_key_action("weapon_5", KEY_5)
	_key_action("pause", KEY_ESCAPE)
	_mouse_action("fire", MOUSE_BUTTON_LEFT)


func _key_action(action: String, keycode: Key) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	var ev := InputEventKey.new()
	ev.physical_keycode = keycode
	InputMap.action_add_event(action, ev)


func _mouse_action(action: String, button: MouseButton) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	var ev := InputEventMouseButton.new()
	ev.button_index = button
	InputMap.action_add_event(action, ev)
