## Helpers for working with imported GLB scenes: material retints (team colors,
## weapon finishes) and whole-model transparency. Preload and call statically.

const WPN_MODELS := [
	"res://assets/models/weapons/wpn_0_pulse_rifle.glb",
	"res://assets/models/weapons/wpn_1_thumper.glb",
	"res://assets/models/weapons/wpn_2_scattergun.glb",
	"res://assets/models/weapons/wpn_3_longshot.glb",
	"res://assets/models/weapons/wpn_4_viper.glb",
	"res://assets/models/weapons/wpn_5_ion_splatter.glb",
	"res://assets/models/weapons/wpn_6_nova_cannon.glb",
	"res://assets/models/weapons/wpn_7_circuit_blade.glb",
	"res://assets/models/weapons/wpn_8_lobber.glb",
]


static func instantiate_weapon(weapon: int) -> Node3D:
	if weapon < 0 or weapon >= WPN_MODELS.size():
		return null
	var packed: PackedScene = load(WPN_MODELS[weapon])
	return packed.instantiate() if packed != null else null


static func meshes(root: Node) -> Array:
	var out := []
	var stack := [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is MeshInstance3D:
			out.append(n)
		for c in n.get_children():
			stack.append(c)
	return out


## Retint every surface whose material name contains any of `needles`.
## Sets albedo and (if the material glows) emission to `color`.
static func retint(root: Node, needles: Array, color: Color) -> void:
	for mi: MeshInstance3D in meshes(root):
		for i in mi.get_surface_override_material_count():
			var mat: Material = mi.get_active_material(i)
			if mat == null:
				continue
			var name := mat.resource_name.to_lower()
			var hit := false
			for needle: String in needles:
				if name.contains(needle):
					hit = true
					break
			if not hit:
				continue
			var dup: Material = mat.duplicate()
			if dup is BaseMaterial3D:
				dup.albedo_color = color
				if dup.emission_enabled:
					dup.emission = color
			mi.set_surface_override_material(i, dup)


static func set_transparency(root: Node, t: float) -> void:
	for mi: MeshInstance3D in meshes(root):
		mi.transparency = t
