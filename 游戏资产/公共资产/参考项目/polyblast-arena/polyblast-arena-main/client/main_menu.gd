extends Control
## Main menu v2: 3D showcase background (podium + equipped character + weapon)
## with panel-based UI — PLAY (match setup), LOADOUT, ARMORY (shop), SETTINGS.

const ModelTools := preload("res://client/model_tools.gd")
const SimWeapons := preload("res://sim/sim_weapons.gd")

const GUN_NAMES := {0: "Pulse Rifle", 1: "Thumper", 2: "Scattergun", 3: "Longshot",
	4: "Viper", 5: "Ion Splatter", 6: "Nova Cannon", 8: "Lobber"}

var _showcase: Node3D
var _char_slot: Node3D
var _wpn_slot: Node3D
var _points_label: Label
var _panels: Dictionary = {}
var _t := 0.0


func _ready() -> void:
	if GameConfig.is_server_mode():
		get_tree().change_scene_to_file.call_deferred("res://scenes/server_main.tscn")
		return
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_build_showcase()
	_build_ui()
	_refresh_showcase()


func _process(dt: float) -> void:
	_t += dt
	if _showcase != null:
		_showcase.rotation.y = sin(_t * 0.25) * 0.35
	if _wpn_slot != null:
		_wpn_slot.rotation.y = wrapf(_wpn_slot.rotation.y + dt * 0.8, 0.0, TAU)
	if _points_label != null:
		_points_label.text = "%d  POINTS" % Profile.points


## --- 3D background -----------------------------------------------------------

func _build_showcase() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("0a0c14")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("38405e")
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.glow_enabled = true
	env.glow_bloom = 0.2
	env.glow_hdr_threshold = 1.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	_showcase = Node3D.new()
	add_child(_showcase)

	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-38, 25, 0)
	key.light_energy = 1.3
	_showcase.add_child(key)
	var rim := OmniLight3D.new()
	rim.position = Vector3(-1.6, 2.2, -1.4)
	rim.light_color = Color("00e5ff")
	rim.light_energy = 2.4
	rim.omni_range = 7.0
	_showcase.add_child(rim)

	_add_glb(_showcase, "res://assets/models/menu/backdrop_wall.glb", Vector3(0, 0, -2.4), 0.0)
	_add_glb(_showcase, "res://assets/models/menu/podium.glb", Vector3.ZERO, 0.0)

	_char_slot = Node3D.new()
	_char_slot.position = Vector3(0, 0.25, 0)
	_char_slot.rotation.y = PI  # authored forward is -Z; turn to face the camera
	_showcase.add_child(_char_slot)

	_wpn_slot = Node3D.new()
	_wpn_slot.position = Vector3(1.1, 1.35, 0.2)
	_showcase.add_child(_wpn_slot)

	var cam := Camera3D.new()
	cam.position = Vector3(0.55, 1.45, 3.4)
	cam.fov = 50.0
	add_child(cam)
	cam.look_at_from_position(cam.position, Vector3(0.35, 1.05, 0.0), Vector3.UP)
	cam.current = true


func _add_glb(parent: Node3D, path: String, pos: Vector3, yaw: float) -> Node3D:
	var packed: PackedScene = load(path)
	if packed == null:
		return null
	var node: Node3D = packed.instantiate()
	node.position = pos
	node.rotation.y = yaw
	parent.add_child(node)
	return node


func _refresh_showcase() -> void:
	if _char_slot == null:
		return
	for c in _char_slot.get_children():
		c.queue_free()
	for c in _wpn_slot.get_children():
		c.queue_free()
	var packed: PackedScene = load(Profile.character_scene())
	if packed != null:
		var model: Node3D = packed.instantiate()
		_char_slot.add_child(model)
	var wpn := ModelTools.instantiate_weapon(Profile.loadout_weapons[0])
	if wpn != null:
		wpn.scale = Vector3.ONE * 0.9
		if Profile.finish_color() != "":
			ModelTools.retint(wpn, ["accent", "glow"], Color(Profile.finish_color()))
		_wpn_slot.add_child(wpn)


## --- UI ------------------------------------------------------------------------

func _build_ui() -> void:
	var title := Label.new()
	title.text = "POLYBLAST ARENA"
	title.position = Vector2(48, 40)
	title.add_theme_font_size_override("font_size", 52)
	title.add_theme_color_override("font_color", Color("e8ecff"))
	title.add_theme_color_override("font_outline_color", Color("ff7a1a"))
	title.add_theme_constant_override("outline_size", 4)
	add_child(title)

	var sub := Label.new()
	sub.text = "v2  —  THE BIG BOOM UPDATE"
	sub.position = Vector2(52, 100)
	sub.add_theme_font_size_override("font_size", 18)
	sub.add_theme_color_override("font_color", Color("8a93c4"))
	add_child(sub)

	_points_label = Label.new()
	_points_label.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_points_label.position = Vector2(-260, 44)
	_points_label.custom_minimum_size = Vector2(220, 0)
	_points_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_points_label.add_theme_font_size_override("font_size", 26)
	_points_label.add_theme_color_override("font_color", Color("ffc53d"))
	add_child(_points_label)

	# left button column
	var col := VBoxContainer.new()
	col.position = Vector2(48, 180)
	col.add_theme_constant_override("separation", 14)
	add_child(col)
	col.add_child(_menu_button("PLAY", func() -> void: _show_panel("play")))
	col.add_child(_menu_button("LOADOUT", func() -> void: _show_panel("loadout")))
	col.add_child(_menu_button("ARMORY", func() -> void: _show_panel("armory")))
	col.add_child(_menu_button("SETTINGS", func() -> void: _show_panel("settings")))
	var quit := _menu_button("QUIT", func() -> void: get_tree().quit())
	quit.name = "QuitButton"
	col.add_child(quit)

	# right-side panels
	_panels["play"] = _build_play_panel()
	_panels["loadout"] = _build_loadout_panel()
	_panels["armory"] = _build_armory_panel()
	_panels["settings"] = _build_settings_panel()
	for p: Control in _panels.values():
		add_child(p)
	_show_panel("play")


func _show_panel(which: String) -> void:
	for key: String in _panels:
		_panels[key].visible = key == which
	if which == "armory":
		_rebuild_armory()


func _panel_shell(title_text: String) -> Array:
	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	panel.position = Vector2(-560, 150)
	panel.custom_minimum_size = Vector2(520, 540)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.05, 0.06, 0.11, 0.85)
	style.set_corner_radius_all(10)
	style.set_border_width_all(1)
	style.border_color = Color("2c3252")
	style.content_margin_left = 26
	style.content_margin_right = 26
	style.content_margin_top = 20
	style.content_margin_bottom = 20
	panel.add_theme_stylebox_override("panel", style)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	var head := Label.new()
	head.text = title_text
	head.add_theme_font_size_override("font_size", 30)
	head.add_theme_color_override("font_color", Color("ff7a1a"))
	box.add_child(head)
	return [panel, box]


func _build_play_panel() -> Control:
	var shell := _panel_shell("MATCH SETUP")
	var box: VBoxContainer = shell[1]

	var mode_opt := OptionButton.new()
	for m: String in GameConfig.MODES:
		mode_opt.add_item(m)
	mode_opt.selected = GameConfig.mode
	mode_opt.item_selected.connect(func(i: int) -> void: GameConfig.mode = i)
	box.add_child(_row("Mode", mode_opt))

	var map_opt := OptionButton.new()
	for m: Dictionary in GameConfig.MAPS:
		map_opt.add_item(m["name"])
	map_opt.selected = GameConfig.map_index
	map_opt.item_selected.connect(func(i: int) -> void: GameConfig.map_index = i)
	box.add_child(_row("Map", map_opt))

	var bots_label := Label.new()
	bots_label.add_theme_color_override("font_color", Color("e8ecff"))
	var bots := HSlider.new()
	bots.min_value = 1
	bots.max_value = 8
	bots.step = 1
	bots.value = GameConfig.bot_count
	bots.custom_minimum_size = Vector2(220, 24)
	bots_label.text = str(GameConfig.bot_count)
	bots.value_changed.connect(func(v: float) -> void:
		GameConfig.bot_count = int(v)
		bots_label.text = str(int(v)))
	var bots_row := _row("Bots", bots)
	bots_row.add_child(bots_label)
	box.add_child(bots_row)

	var diff := OptionButton.new()
	for d: String in ["Easy", "Normal", "Hard"]:
		diff.add_item(d)
	diff.selected = GameConfig.difficulty
	diff.item_selected.connect(func(i: int) -> void: GameConfig.difficulty = i)
	box.add_child(_row("Difficulty", diff))

	var frag_label := Label.new()
	frag_label.add_theme_color_override("font_color", Color("e8ecff"))
	var frags := HSlider.new()
	frags.min_value = 5
	frags.max_value = 50
	frags.step = 5
	frags.value = GameConfig.frag_limit
	frags.custom_minimum_size = Vector2(220, 24)
	frag_label.text = str(GameConfig.frag_limit)
	frags.value_changed.connect(func(v: float) -> void:
		GameConfig.frag_limit = int(v)
		frag_label.text = str(int(v)))
	var frag_row := _row("Score limit", frags)
	frag_row.add_child(frag_label)
	box.add_child(frag_row)

	var time_opt := OptionButton.new()
	for label: String in ["5 min", "10 min", "15 min", "20 min", "No limit"]:
		time_opt.add_item(label)
	var times := [5, 10, 15, 20, 0]
	time_opt.selected = times.find(GameConfig.time_limit_min) if GameConfig.time_limit_min in times else 1
	time_opt.item_selected.connect(func(i: int) -> void: GameConfig.time_limit_min = times[i])
	box.add_child(_row("Time limit", time_opt))

	var hint := Label.new()
	hint.text = "Team Elimination: one life per round,\nfirst team to 7 rounds wins."
	hint.add_theme_font_size_override("font_size", 14)
	hint.add_theme_color_override("font_color", Color("8a93c4"))
	box.add_child(hint)

	var start := Button.new()
	start.name = "PlayButton"
	start.text = "  START MATCH  "
	start.add_theme_font_size_override("font_size", 28)
	start.pressed.connect(func() -> void:
		get_tree().change_scene_to_file("res://scenes/match.tscn"))
	box.add_child(start)
	return shell[0]


func _build_loadout_panel() -> Control:
	var shell := _panel_shell("LOADOUT")
	var box: VBoxContainer = shell[1]
	var gun_ids: Array = SimWeapons.GUN_POOL

	for slot in 4:
		var opt := OptionButton.new()
		for gid: int in gun_ids:
			opt.add_item(GUN_NAMES[gid], gid)
		opt.selected = gun_ids.find(Profile.loadout_weapons[slot])
		var slot_i := slot
		opt.item_selected.connect(func(i: int) -> void:
			var picked: int = gun_ids[i]
			var lw: Array = Profile.loadout_weapons.duplicate()
			var other: int = lw.find(picked)
			if other != -1 and other != slot_i:
				lw[other] = lw[slot_i]  # swap to keep slots unique
			lw[slot_i] = picked
			Profile.set_loadout(lw)
			_refresh_loadout_options(box, gun_ids)
			_refresh_showcase())
		box.add_child(_row("Slot %d" % (slot + 1), opt))

	var melee_note := Label.new()
	melee_note.text = "Slot 5: Circuit Blade (always equipped)"
	melee_note.add_theme_font_size_override("font_size", 14)
	melee_note.add_theme_color_override("font_color", Color("8a93c4"))
	box.add_child(melee_note)

	var char_opt := OptionButton.new()
	var char_ids := ["char_vanguard", "char_ashfang", "char_circuit"]
	for id: String in char_ids:
		var suffix: String = "" if Profile.owns(id) else "  (locked)"
		char_opt.add_item(Profile.CATALOG[id]["name"] + suffix)
	char_opt.selected = char_ids.find(Profile.character)
	char_opt.item_selected.connect(func(i: int) -> void:
		var id: String = char_ids[i]
		if Profile.owns(id):
			Profile.set_character(id)
		else:
			char_opt.selected = char_ids.find(Profile.character)
		_refresh_showcase())
	box.add_child(_row("Character", char_opt))

	var fin_opt := OptionButton.new()
	var fin_ids := ["finish_none", "finish_frost", "finish_venom", "finish_royal", "finish_blush", "finish_gold"]
	for id: String in fin_ids:
		var suffix: String = "" if Profile.owns(id) else "  (locked)"
		fin_opt.add_item(Profile.CATALOG[id]["name"] + suffix)
	fin_opt.selected = fin_ids.find(Profile.finish)
	fin_opt.item_selected.connect(func(i: int) -> void:
		var id: String = fin_ids[i]
		if Profile.owns(id):
			Profile.set_finish(id)
		else:
			fin_opt.selected = fin_ids.find(Profile.finish)
		_refresh_showcase())
	box.add_child(_row("Weapon finish", fin_opt))

	var note := Label.new()
	note.text = "Locked items must be bought in the ARMORY."
	note.add_theme_font_size_override("font_size", 14)
	note.add_theme_color_override("font_color", Color("8a93c4"))
	box.add_child(note)
	return shell[0]


func _refresh_loadout_options(box: VBoxContainer, gun_ids: Array) -> void:
	var slot := 0
	for child in box.get_children():
		if child is HBoxContainer and slot < 4:
			for sub in child.get_children():
				if sub is OptionButton:
					sub.selected = gun_ids.find(Profile.loadout_weapons[slot])
					slot += 1
					break


func _build_armory_panel() -> Control:
	var shell := _panel_shell("ARMORY")
	var box: VBoxContainer = shell[1]
	var list := VBoxContainer.new()
	list.name = "ItemList"
	list.add_theme_constant_override("separation", 8)
	box.add_child(list)
	return shell[0]


func _rebuild_armory() -> void:
	var list: VBoxContainer = _panels["armory"].find_child("ItemList", true, false)
	for c in list.get_children():
		c.queue_free()
	for id: String in Profile.CATALOG:
		var item: Dictionary = Profile.CATALOG[id]
		if item["cost"] == 0:
			continue
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var name_l := Label.new()
		name_l.text = item["name"]
		name_l.custom_minimum_size = Vector2(190, 0)
		name_l.add_theme_font_size_override("font_size", 20)
		name_l.add_theme_color_override("font_color", Color("e8ecff"))
		row.add_child(name_l)
		var kind_l := Label.new()
		kind_l.text = String(item["kind"]).capitalize()
		kind_l.custom_minimum_size = Vector2(90, 0)
		kind_l.add_theme_font_size_override("font_size", 16)
		kind_l.add_theme_color_override("font_color", Color("8a93c4"))
		row.add_child(kind_l)
		var btn := Button.new()
		if Profile.owns(id):
			var equipped: bool = id == Profile.character or id == Profile.finish
			btn.text = "EQUIPPED" if equipped else "EQUIP"
			btn.disabled = equipped
			btn.pressed.connect(func() -> void:
				if item["kind"] == "character":
					Profile.set_character(id)
				else:
					Profile.set_finish(id)
				_refresh_showcase()
				_rebuild_armory())
		else:
			btn.text = "%d pts" % item["cost"]
			btn.disabled = not Profile.can_buy(id)
			btn.pressed.connect(func() -> void:
				if Profile.buy(id):
					if item["kind"] == "character":
						Profile.set_character(id)
					else:
						Profile.set_finish(id)
					_refresh_showcase()
					_rebuild_armory())
		row.add_child(btn)
		list.add_child(row)
	var tip := Label.new()
	tip.text = "Earn Points in matches: 10 per frag, +25 per win."
	tip.add_theme_font_size_override("font_size", 14)
	tip.add_theme_color_override("font_color", Color("8a93c4"))
	list.add_child(tip)


func _build_settings_panel() -> Control:
	var shell := _panel_shell("SETTINGS")
	var box: VBoxContainer = shell[1]
	var sens_label := Label.new()
	sens_label.add_theme_color_override("font_color", Color("e8ecff"))
	var sens := HSlider.new()
	sens.min_value = 0.0008
	sens.max_value = 0.006
	sens.step = 0.0001
	sens.value = GameConfig.mouse_sensitivity
	sens.custom_minimum_size = Vector2(220, 24)
	sens_label.text = "%.4f" % GameConfig.mouse_sensitivity
	sens.value_changed.connect(func(v: float) -> void:
		GameConfig.mouse_sensitivity = v
		sens_label.text = "%.4f" % v
		Profile.save_profile())
	var row := _row("Mouse sens.", sens)
	row.add_child(sens_label)
	box.add_child(row)

	var controls := Label.new()
	controls.text = "WASD move   |   Space jump (hold = bunny-hop)
Ctrl crouch   |   Mouse1 fire   |   1-5 weapons
Esc pause"
	controls.add_theme_font_size_override("font_size", 16)
	controls.add_theme_color_override("font_color", Color("8a93c4"))
	box.add_child(controls)
	return shell[0]


func _row(title: String, control: Control) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var l := Label.new()
	l.text = title
	l.custom_minimum_size = Vector2(120, 0)
	l.add_theme_font_size_override("font_size", 18)
	l.add_theme_color_override("font_color", Color("c7cdf2"))
	row.add_child(l)
	row.add_child(control)
	return row


func _menu_button(text: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = "  %s  " % text
	b.custom_minimum_size = Vector2(220, 52)
	b.add_theme_font_size_override("font_size", 26)
	b.pressed.connect(action)
	return b
