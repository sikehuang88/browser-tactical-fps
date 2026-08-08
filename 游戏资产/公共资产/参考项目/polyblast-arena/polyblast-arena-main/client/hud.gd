extends CanvasLayer
## In-match HUD v2: crosshair, HP/AP bars, ammo + loadout slots, timer/score,
## kill feed, streak & round banners, hit markers, damage flash, respawn
## overlay, pickup toasts. Reads SIM state; never writes it.

const SimWeapons := preload("res://sim/sim_weapons.gd")

const COL_TEXT := Color("e8ecff")
const COL_DIM := Color("8a93c4")
const COL_ACCENT := Color("ff7a1a")
const COL_HP := Color("62d47a")
const COL_HP_LOW := Color("e05656")
const COL_AP := Color("00cfe8")
const COL_RED := Color("ff6b6b")
const COL_BLUE := Color("7ea2ff")
const COL_BG := Color(0.06, 0.07, 0.12, 0.55)

const STREAK_NAMES := {2: "DOUBLE KILL!", 3: "TRIPLE KILL!", 4: "QUAD KILL!",
	5: "MEGA KILL!", 6: "UBER KILL!"}

var sim: Node3D
var local_id := ""

var _hp_fill: ColorRect
var _hp_label: Label
var _ap_fill: ColorRect
var _ap_label: Label
var _ammo: Label
var _wname: Label
var _slots: HBoxContainer
var _score: Label
var _timer: Label
var _feed: VBoxContainer
var _flash: ColorRect
var _hitmark: HitMarker
var _respawn: Label
var _banner: Label
var _toast: Label
var _poll_t := 0.0


func _ready() -> void:
	var cross := CrosshairControl.new()
	cross.set_anchors_preset(Control.PRESET_FULL_RECT)
	cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(cross)

	_hitmark = HitMarker.new()
	_hitmark.set_anchors_preset(Control.PRESET_FULL_RECT)
	_hitmark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_hitmark)

	_flash = ColorRect.new()
	_flash.color = Color(0.9, 0.1, 0.1, 0.0)
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_flash)

	# --- bottom-left: HP + AP bars ------------------------------------------
	var bars := VBoxContainer.new()
	bars.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	bars.position = Vector2(24, -108)
	bars.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bars.add_theme_constant_override("separation", 8)
	add_child(bars)
	var ap_row := _bar_row("AP", COL_AP)
	_ap_fill = ap_row[1]
	_ap_label = ap_row[2]
	bars.add_child(ap_row[0])
	var hp_row := _bar_row("HP", COL_HP)
	_hp_fill = hp_row[1]
	_hp_label = hp_row[2]
	bars.add_child(hp_row[0])

	# --- bottom-right: weapon + ammo + slots --------------------------------
	var wbox := VBoxContainer.new()
	wbox.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	wbox.position = Vector2(-360, -132)
	wbox.grow_vertical = Control.GROW_DIRECTION_BEGIN
	wbox.custom_minimum_size = Vector2(336, 0)
	wbox.add_theme_constant_override("separation", 4)
	add_child(wbox)
	_wname = _label(20, HORIZONTAL_ALIGNMENT_RIGHT)
	_wname.add_theme_color_override("font_color", COL_ACCENT)
	wbox.add_child(_wname)
	_ammo = _label(34, HORIZONTAL_ALIGNMENT_RIGHT)
	wbox.add_child(_ammo)
	_slots = HBoxContainer.new()
	_slots.alignment = BoxContainer.ALIGNMENT_END
	_slots.add_theme_constant_override("separation", 6)
	wbox.add_child(_slots)

	# --- top-center: timer + score ------------------------------------------
	var top := VBoxContainer.new()
	top.set_anchors_preset(Control.PRESET_CENTER_TOP)
	top.position = Vector2(-220, 12)
	top.custom_minimum_size = Vector2(440, 0)
	add_child(top)
	_timer = _label(26, HORIZONTAL_ALIGNMENT_CENTER)
	top.add_child(_timer)
	_score = _label(18, HORIZONTAL_ALIGNMENT_CENTER)
	_score.add_theme_color_override("font_color", COL_DIM)
	top.add_child(_score)

	_feed = VBoxContainer.new()
	_feed.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_feed.position = Vector2(-340, 18)
	_feed.custom_minimum_size = Vector2(316, 0)
	add_child(_feed)

	_respawn = _label(40, HORIZONTAL_ALIGNMENT_CENTER)
	_respawn.text = "RESPAWNING..."
	_respawn.set_anchors_preset(Control.PRESET_CENTER)
	_respawn.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_respawn.visible = false
	add_child(_respawn)

	_banner = _label(44, HORIZONTAL_ALIGNMENT_CENTER)
	_banner.set_anchors_preset(Control.PRESET_CENTER)
	_banner.position.y = -140
	_banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_banner.add_theme_color_override("font_color", COL_ACCENT)
	_banner.visible = false
	add_child(_banner)

	_toast = _label(20, HORIZONTAL_ALIGNMENT_CENTER)
	_toast.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast.position = Vector2(-160, -170)
	_toast.custom_minimum_size = Vector2(320, 0)
	_toast.visible = false
	add_child(_toast)


func handle(ev: Dictionary) -> void:
	match ev["type"]:
		"damage":
			if ev["id"] == local_id:
				_flash.color.a = minf(0.05 + ev["amount"] * 0.006, 0.45)
			elif ev["attacker"] == local_id:
				_hitmark.ping()
		"kill":
			var line := _label(18, HORIZONTAL_ALIGNMENT_RIGHT)
			if ev["suicide"]:
				line.text = "%s self-destructed" % ev["victim_name"]
			else:
				line.text = "%s  >  %s" % [ev["attacker_name"], ev["victim_name"]]
			line.add_theme_color_override("font_color",
				COL_ACCENT if ev["attacker"] == local_id else Color("c7cdf2"))
			_feed.add_child(line)
			if _feed.get_child_count() > 5:
				_feed.get_child(0).queue_free()
			var tw := line.create_tween()
			tw.tween_interval(4.0)
			tw.tween_property(line, "modulate:a", 0.0, 0.8)
			tw.tween_callback(line.queue_free)
		"streak":
			if ev["id"] == local_id and STREAK_NAMES.has(mini(ev["count"], 6)):
				_show_banner(STREAK_NAMES[mini(ev["count"], 6)], COL_ACCENT)
		"round_end":
			var col: Color = COL_RED if ev["winner"] == 1 else COL_BLUE
			_show_banner("%s TEAM WINS THE ROUND" % ("RED" if ev["winner"] == 1 else "BLUE"), col)
		"round_start":
			_show_banner("ROUND %d — FIGHT!" % ev["round"], COL_TEXT)
		"pickup":
			if ev["id"] == local_id:
				_show_toast(ev["kind"])
		"death":
			if ev["id"] == local_id:
				_respawn.text = "ELIMINATED — next round soon" if sim.mode == 2 else "RESPAWNING..."
				_respawn.visible = true
		"spawn":
			if ev["id"] == local_id:
				_respawn.visible = false


func _show_banner(text: String, color: Color) -> void:
	_banner.text = text
	_banner.add_theme_color_override("font_color", color)
	_banner.visible = true
	_banner.scale = Vector2.ONE * 0.6
	_banner.modulate.a = 1.0
	_banner.pivot_offset = _banner.size * 0.5
	var tw := _banner.create_tween()
	tw.tween_property(_banner, "scale", Vector2.ONE, 0.12).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_interval(1.4)
	tw.tween_property(_banner, "modulate:a", 0.0, 0.4)
	tw.tween_callback(func() -> void: _banner.visible = false)


const TOAST_NAMES := {
	"health_s": "+25 HEALTH", "health_l": "+50 HEALTH", "health_u": "+100 HEALTH",
	"armor_s": "+25 ARMOR", "armor_l": "+50 ARMOR", "armor_u": "+100 ARMOR",
	"ammo_s": "AMMO", "ammo_l": "FULL AMMO",
}


func _show_toast(kind: String) -> void:
	_toast.text = TOAST_NAMES.get(kind, kind.to_upper())
	_toast.add_theme_color_override("font_color",
		COL_HP if kind.begins_with("health") else (COL_AP if kind.begins_with("armor") else COL_ACCENT))
	_toast.visible = true
	_toast.modulate.a = 1.0
	var tw := _toast.create_tween()
	tw.tween_interval(0.8)
	tw.tween_property(_toast, "modulate:a", 0.0, 0.5)
	tw.tween_callback(func() -> void: _toast.visible = false)


func _process(dt: float) -> void:
	_flash.color.a = maxf(_flash.color.a - dt * 1.2, 0.0)
	_hitmark.tick(dt)
	if sim == null:
		return
	_poll_t -= dt
	if _poll_t > 0.0:
		return
	_poll_t = 0.2
	var p: RefCounted = sim.get_player(local_id)
	if p == null:
		return
	# bars
	_hp_fill.custom_minimum_size.x = 220.0 * clampf(p.health / 100.0, 0.0, 1.0)
	_hp_fill.color = COL_HP_LOW if p.health <= 30 else COL_HP
	_hp_label.text = str(p.health)
	_ap_fill.custom_minimum_size.x = 220.0 * clampf(p.armor / 120.0, 0.0, 1.0)
	_ap_label.text = str(p.armor)
	# weapon + slots
	var wdef: Dictionary = SimWeapons.DEFS[p.weapon]
	_wname.text = wdef["name"]
	_ammo.text = "%d" % p.ammo[p.weapon]
	_refresh_slots(p)
	# timer
	var tl: float = sim.get_time_left()
	if tl >= 0.0:
		_timer.text = "%d:%02d" % [int(tl) / 60, int(tl) % 60]
	else:
		_timer.text = ""
	# score line per mode
	var ts: Dictionary = sim.get_team_scores()
	if ts.is_empty():
		var rows: Array = sim.get_scores()
		if rows.is_empty():
			return
		var me_frags := 0
		for row: Dictionary in rows:
			if row["id"] == local_id:
				me_frags = row["frags"]
		_score.text = "You %d   |   %s %d   |   first to %d" % [
			me_frags, rows[0]["name"], rows[0]["frags"], sim.frag_limit]
	else:
		var target: int = sim.round_limit if sim.mode == 2 else sim.frag_limit
		_score.text = "RED %d  —  %d BLUE   (first to %d)" % [ts.get(1, 0), ts.get(2, 0), target]


func _refresh_slots(p: RefCounted) -> void:
	while _slots.get_child_count() < p.carried.size():
		var l := _label(14, HORIZONTAL_ALIGNMENT_CENTER)
		_slots.add_child(l)
	for i in _slots.get_child_count():
		var l: Label = _slots.get_child(i)
		if i >= p.carried.size():
			l.text = ""
			continue
		var w: int = p.carried[i]
		l.text = "%d %s" % [i + 1, SimWeapons.DEFS[w]["name"]]
		var active: bool = w == p.weapon
		l.add_theme_color_override("font_color", COL_ACCENT if active else COL_DIM)


## Returns [row_control, fill_rect, value_label].
func _bar_row(title: String, color: Color) -> Array:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var tag := _label(16, HORIZONTAL_ALIGNMENT_LEFT)
	tag.text = title
	tag.custom_minimum_size = Vector2(30, 0)
	tag.add_theme_color_override("font_color", color)
	row.add_child(tag)
	var frame := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = COL_BG
	style.set_corner_radius_all(3)
	style.content_margin_left = 2
	style.content_margin_right = 2
	style.content_margin_top = 2
	style.content_margin_bottom = 2
	frame.add_theme_stylebox_override("panel", style)
	frame.custom_minimum_size = Vector2(224, 18)
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(220, 14)
	frame.add_child(holder)
	var fill := ColorRect.new()
	fill.color = color
	fill.custom_minimum_size = Vector2(220, 14)
	fill.size = Vector2(220, 14)
	holder.add_child(fill)
	row.add_child(frame)
	var value := _label(18, HORIZONTAL_ALIGNMENT_LEFT)
	value.custom_minimum_size = Vector2(44, 0)
	row.add_child(value)
	return [row, fill, value]


func _label(size: int, align: HorizontalAlignment) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", COL_TEXT)
	l.add_theme_color_override("font_outline_color", Color("14172a"))
	l.add_theme_constant_override("outline_size", 6)
	l.horizontal_alignment = align
	return l


class CrosshairControl:
	extends Control

	func _draw() -> void:
		var c := size * 0.5
		var col := Color("e8ecff", 0.9)
		var gap := 5.0
		var len := 9.0
		draw_line(c + Vector2(gap, 0), c + Vector2(gap + len, 0), col, 2.0)
		draw_line(c - Vector2(gap, 0), c - Vector2(gap + len, 0), col, 2.0)
		draw_line(c + Vector2(0, gap), c + Vector2(0, gap + len), col, 2.0)
		draw_line(c - Vector2(0, gap), c - Vector2(0, gap + len), col, 2.0)
		draw_circle(c, 1.5, col)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()


class HitMarker:
	extends Control

	var _a := 0.0

	func ping() -> void:
		_a = 0.9
		queue_redraw()

	func tick(dt: float) -> void:
		if _a > 0.0:
			_a = maxf(_a - dt * 3.2, 0.0)
			queue_redraw()

	func _draw() -> void:
		if _a <= 0.0:
			return
		var c := size * 0.5
		var col := Color(1.0, 1.0, 1.0, _a)
		for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			draw_line(c + d * 7.0, c + d * 14.0, col, 2.0)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()
