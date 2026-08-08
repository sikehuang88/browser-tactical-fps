## Procedural materials — all textures generated in code, zero external assets.
## Preload this script and call its static funcs (no class_name: keeps headless
## --script runs independent of the editor's global class cache).

static var _cache: Dictionary = {}


static func floor_mat() -> StandardMaterial3D:
	return _grid("floor", Color("23283d"), Color("3a4160"))


static func wall_mat() -> StandardMaterial3D:
	return _grid("wall", Color("2b3048"), Color("424a6e"))


static func block_mat() -> StandardMaterial3D:
	return _grid("block", Color("343b58"), Color("4d5680"))


static func accent_mat() -> StandardMaterial3D:
	if _cache.has("accent"):
		return _cache["accent"]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color("ff7a1a")
	m.emission_enabled = true
	m.emission = Color("ff7a1a")
	m.emission_energy_multiplier = 1.6
	_cache["accent"] = m
	return m


## Themed material set for arenas: [floor, wall, block, accent].
## t keys: name, floor/floor_line/wall/wall_line/block/block_line (Color hex
## strings), accent (Color hex string), accent_energy (float, default 1.6).
static func themed_set(t: Dictionary) -> Array:
	var prefix: String = t.get("name", "theme")
	var accent_key := prefix + "_accent"
	var accent: StandardMaterial3D
	if _cache.has(accent_key):
		accent = _cache[accent_key]
	else:
		accent = StandardMaterial3D.new()
		var ac := Color(t.get("accent", "ff7a1a"))
		accent.albedo_color = ac
		accent.emission_enabled = true
		accent.emission = ac
		accent.emission_energy_multiplier = t.get("accent_energy", 1.6)
		_cache[accent_key] = accent
	return [
		_grid(prefix + "_floor", Color(t.get("floor", "23283d")), Color(t.get("floor_line", "3a4160"))),
		_grid(prefix + "_wall", Color(t.get("wall", "2b3048")), Color(t.get("wall_line", "424a6e"))),
		_grid(prefix + "_block", Color(t.get("block", "343b58")), Color(t.get("block_line", "4d5680"))),
		accent,
	]


static func _grid(key: String, base: Color, line: Color) -> StandardMaterial3D:
	if _cache.has(key):
		return _cache[key]
	var img := Image.create(128, 128, false, Image.FORMAT_RGB8)
	img.fill(base)
	for i in 128:
		img.set_pixel(i, 0, line)
		img.set_pixel(i, 1, line)
		img.set_pixel(0, i, line)
		img.set_pixel(1, i, line)
		# subtle quarter lines
		img.set_pixel(i, 64, line.lerp(base, 0.5))
		img.set_pixel(64, i, line.lerp(base, 0.5))
	var tex := ImageTexture.create_from_image(img)
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(0.25, 0.25, 0.25)  # one tile per 4 m, world-locked
	m.roughness = 0.85
	_cache[key] = m
	return m
