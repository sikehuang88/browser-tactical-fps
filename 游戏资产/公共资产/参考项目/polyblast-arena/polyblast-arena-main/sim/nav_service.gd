extends RefCounted
## The ONE wrapper around Godot's navigation API (experimental surface).
## Everything nav-related goes through here so an engine API change touches a
## single file. Uses NavigationServer3D map queries directly (the same
## subsystem NavigationAgent3D fronts) — node-free, so it also runs headless.

var _map: RID


func setup(arena: Node3D) -> void:
	_map = arena.get_navigation_map()


func get_nav_path(from: Vector3, to: Vector3) -> PackedVector3Array:
	return NavigationServer3D.map_get_path(_map, from, to, true)


func closest_point(pos: Vector3) -> Vector3:
	return NavigationServer3D.map_get_closest_point(_map, pos)
