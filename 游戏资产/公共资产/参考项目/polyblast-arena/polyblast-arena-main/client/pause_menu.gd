extends CanvasLayer
## Pause menu. Offline game, so pausing truly pauses the SIM (engine pause).
## Runs in ALWAYS process mode so it can unpause itself.

signal resumed

var _panel: Control


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	layer = 10
	visible = false

	_panel = ColorRect.new()
	var rect := _panel as ColorRect
	rect.color = Color(0.05, 0.06, 0.12, 0.82)
	_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_panel)

	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.add_theme_constant_override("separation", 14)
	_panel.add_child(box)

	var title := Label.new()
	title.text = "PAUSED"
	title.add_theme_font_size_override("font_size", 44)
	title.add_theme_color_override("font_color", Color("ff7a1a"))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)

	box.add_child(_button("Resume", _resume))
	box.add_child(_button("Restart match", func() -> void:
		get_tree().paused = false
		get_tree().change_scene_to_file("res://scenes/match.tscn")))
	box.add_child(_button("Main menu", func() -> void:
		get_tree().paused = false
		get_tree().change_scene_to_file("res://scenes/main_menu.tscn")))
	box.add_child(_button("Quit", func() -> void: get_tree().quit()))


func open() -> void:
	visible = true
	get_tree().paused = true
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)


func _resume() -> void:
	visible = false
	get_tree().paused = false
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	resumed.emit()


func _unhandled_input(event: InputEvent) -> void:
	if visible and event.is_action_pressed("pause"):
		_resume()


func _button(text: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", 22)
	b.pressed.connect(action)
	return b
