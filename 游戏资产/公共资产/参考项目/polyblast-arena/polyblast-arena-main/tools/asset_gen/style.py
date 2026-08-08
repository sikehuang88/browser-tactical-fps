"""Polyblast Arena v2 — shared Blender asset-generation module.

Every gen_*.py script in this folder imports this module and follows these
CONVENTIONS (do not deviate):

  * Units: 1 Blender unit = 1 meter. Real-world prop sizes.
  * Orientation: weapons/props face Blender +Y ("forward"). The glTF exporter
    maps Blender +Y to glTF/Godot -Z, which is Godot's forward. Up is +Z.
  * Weapon origin: the grip/handle pivot at (0,0,0), barrel extending +Y.
  * Pickup/prop origin: center of the base (sits on floor at z=0), except
    floating pickups which use their spin center.
  * Style: chunky low-poly, flat-shaded, beveled edges, bold saturated accents,
    emissive glow strips. No textures — materials only (solid + emissive).
  * Output: GLB per asset into assets/models/<category>/<name>.glb,
    thumbnail PNG into .frugal-fable/v2/thumbs/<name>.png.
  * Every asset ends with style.finish(...) which prints a machine-readable
    QA line. The runner (run.ps1) fails the build if any asset fails.

Run scripts headless:
  blender --background --factory-startup --python tools/asset_gen/gen_x.py
"""

import os
import sys
import json
import math

import bpy
from mathutils import Vector, Matrix

# ---------------------------------------------------------------- paths ----

_HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(_HERE, "..", ".."))
MODELS_DIR = os.path.join(REPO, "assets", "models")
THUMBS_DIR = os.path.join(REPO, ".frugal-fable", "v2", "thumbs")

# --------------------------------------------------------------- palette ---
# Central v2 palette (sRGB hex). Tuned to the reference pack's language:
# dark gunmetal bodies, clean light plates, one loud accent + one emissive.

PAL = {
    "gunmetal":   "2E3440",
    "steel":      "4C566A",
    "dark":       "1B1F27",
    "plate":      "D8DEE9",
    "white":      "ECEFF4",
    "orange":     "FF8C1A",
    "yellow":     "FFC53D",
    "red":        "E5484D",
    "team_red":   "D93A3A",
    "team_blue":  "3E63DD",
    "cyan":       "00E5FF",
    "magenta":    "FF3D81",
    "lime":       "9BE800",
    "violet":     "8B5CF6",
    "gold":       "E8B341",
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h, alpha=1.0):
    """'FF8C1A' or '#FF8C1A' (or a PAL key) -> linear RGBA tuple."""
    h = PAL.get(h, h).lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


# --------------------------------------------------------------- scene -----

def reset():
    """Wipe the scene completely (objects + orphan data)."""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.curves):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


# ------------------------------------------------------------- materials ---

def mat(name, base, rough=0.55, metallic=0.0, emit=None, emit_strength=4.0):
    """Get-or-create a principled material. base/emit: hex or PAL key."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    rgba = hex_rgba(base)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if emit is not None:
        e = hex_rgba(emit)
        # input name differs across versions; try both
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = e
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_strength
        m.diffuse_color = e  # workbench fallback shows the glow color
    else:
        m.diffuse_color = rgba
    m.metallic = metallic
    m.roughness = rough
    return m


# Convenience shared materials (call these, don't invent duplicates).
def m_body():   return mat("pb_body", "gunmetal", rough=0.5)
def m_steel():  return mat("pb_steel", "steel", rough=0.4, metallic=0.6)
def m_dark():   return mat("pb_dark", "dark", rough=0.7)
def m_plate():  return mat("pb_plate", "plate", rough=0.45)
def m_accent(c="orange"): return mat("pb_accent_" + c, c, rough=0.4)
def m_glow(c="cyan", s=2.5): return mat("pb_glow_" + c, c, emit=c, emit_strength=s)


def assign(ob, material):
    if ob.data.materials:
        ob.data.materials[0] = material
    else:
        ob.data.materials.append(material)


# ------------------------------------------------------------ primitives ---

def _post(name, material, loc, rot):
    ob = bpy.context.active_object
    ob.name = name
    if rot:
        ob.rotation_euler = rot
    ob.location = loc
    if material:
        assign(ob, material)
    return ob


def box(name, size=(1, 1, 1), loc=(0, 0, 0), rot=None, material=None):
    """Axis-aligned box; size = full extents (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    # bake size into mesh so joins/exports stay clean
    ob.data.transform(Matrix.Diagonal((*size, 1.0)))
    return _post(name, material, loc, rot) if True else ob


def cyl(name, r=0.5, depth=1.0, loc=(0, 0, 0), rot=None, verts=16,
        material=None, r2=None):
    """Cylinder along Z (rotate for barrels: rot=(pi/2,0,0) points it +Y).
    r2: if set, makes a truncated cone (r at bottom, r2 at top)."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2,
                                        depth=depth)
    return _post(name, material, loc, rot)


def sphere(name, r=0.5, loc=(0, 0, 0), seg=16, rings=12, material=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r)
    return _post(name, material, loc, None)


def torus(name, r_major=0.5, r_minor=0.1, loc=(0, 0, 0), rot=None,
          seg_major=24, seg_minor=8, material=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=r_major, minor_radius=r_minor,
                                     major_segments=seg_major,
                                     minor_segments=seg_minor)
    return _post(name, material, loc, rot)


def prism(name, sides=6, r=0.5, depth=0.3, loc=(0, 0, 0), rot=None,
          material=None):
    """N-sided prism along Z (hexagon plates, octagonal barrels...)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=depth)
    return _post(name, material, loc, rot)


# ------------------------------------------------------------- modifiers ---

def bevel(ob, width=0.01, segments=2, angle=30):
    md = ob.modifiers.new("Bevel", "BEVEL")
    md.width = width
    md.segments = segments
    md.limit_method = "ANGLE"
    md.angle_limit = math.radians(angle)
    return ob


def shade_auto(ob, angle=35):
    """Flat-ish low-poly shading with smoothed shallow angles."""
    try:
        with bpy.context.temp_override(object=ob, active_object=ob,
                                       selected_editable_objects=[ob]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass  # flat shading is an acceptable fallback
    return ob


def join(objs, name):
    """Join objects into one mesh (child transforms baked in)."""
    objs = [o for o in objs if o and o.type == "MESH"]
    target = objs[0]
    with bpy.context.temp_override(active_object=target,
                                   selected_editable_objects=objs,
                                   selected_objects=objs):
        bpy.ops.object.join()
    target.name = name
    return target


def mirror_x(ob):
    md = ob.modifiers.new("Mirror", "MIRROR")
    md.use_axis = (True, False, False)
    return ob


# ---------------------------------------------------------------- QA -------

def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in objs:
        if ob.type != "MESH":
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        ev.to_mesh_clear()
    return total


# ------------------------------------------------------------- export ------

def export_glb(rel_path, objs=None):
    """Export objs (or everything) to assets/models/<rel_path>."""
    path = os.path.join(MODELS_DIR, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(filepath=path, export_format="GLB", export_apply=True)
    if objs:
        for ob in bpy.data.objects:
            ob.select_set(False)
        for ob in objs:
            ob.select_set(True)
        kwargs["use_selection"] = True
    bpy.ops.export_scene.gltf(**kwargs)
    return path


# ------------------------------------------------------------ thumbnail ----

def _pick_engine(scene):
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = eng
            return eng
        except TypeError:
            continue
    return scene.render.engine


def thumbnail(name, objs, size=768):
    """Render a studio thumbnail of objs to THUMBS_DIR/<name>.png."""
    scene = bpy.context.scene
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        return None

    # bounding sphere
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            pts.append(ev.matrix_world @ Vector(c))
    center = sum(pts, Vector()) / len(pts)
    radius = max((p - center).length for p in pts) or 0.5

    def aim(ob, target):
        d = target - ob.location
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

    cam_data = bpy.data.cameras.new("thumb_cam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("thumb_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = center + Vector((1.0, -1.35, 0.75)).normalized() * radius * 2.6
    aim(cam, center)
    scene.camera = cam

    for i, (off, power) in enumerate((
            (Vector((2, -2, 3)), 150), (Vector((-3, -1, 2)), 60),
            (Vector((0, 3, 2)), 90))):
        ld = bpy.data.lights.new(f"thumb_l{i}", "AREA")
        ld.energy = power * max(radius, 0.5) ** 2
        ld.size = radius * 2
        lo = bpy.data.objects.new(f"thumb_l{i}", ld)
        scene.collection.objects.link(lo)
        lo.location = center + off.normalized() * radius * 3.0
        aim(lo, center)

    world = bpy.data.worlds.get("thumb_world") or bpy.data.worlds.new("thumb_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.022, 0.028, 1.0)
    scene.world = world

    _pick_engine(scene)
    try:  # punchy true-color thumbs (AgX desaturates the neon accents)
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    os.makedirs(THUMBS_DIR, exist_ok=True)
    path = os.path.join(THUMBS_DIR, name + ".png")
    scene.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
    except Exception:
        scene.render.engine = "BLENDER_WORKBENCH"
        bpy.ops.render.render(write_still=True)

    # clean up rig so subsequent assets in the same script start clean
    for ob in [o for o in scene.collection.objects
               if o.name.startswith("thumb_")]:
        bpy.data.objects.remove(ob, do_unlink=True)
    scene.camera = None
    return path


# -------------------------------------------------------------- finish -----

def finish(name, objs, glb_rel_path, tri_budget, do_thumb=True):
    """Export + thumbnail + QA line. Call once per asset, then reset().
    objs may include EMPTY objects (e.g. a 'muzzle' attach point) — they are
    exported into the GLB but ignored for tri count and thumbnail framing."""
    objs = [o for o in objs if o]
    meshes = [o for o in objs if o.type == "MESH"]
    tris = tri_count(meshes)
    glb = export_glb(glb_rel_path, objs)
    thumb = thumbnail(name, meshes) if do_thumb else None
    ok = os.path.exists(glb) and tris <= tri_budget and tris > 0
    line = {"asset": name, "tris": tris, "budget": tri_budget,
            "glb": glb, "thumb": thumb, "ok": bool(ok)}
    print(("ASSET_OK " if ok else "ASSET_FAIL ") + json.dumps(line))
    return ok
