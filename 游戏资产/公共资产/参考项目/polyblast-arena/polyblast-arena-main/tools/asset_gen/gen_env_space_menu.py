"""Env kit: space (5 props) + menu (2 props) for the Skyreach map and the
main-menu 3D showcase scene.

Space kit: origin at base center (sits on floor/platform at z=0), except
ring_arch which is a walk-through archway (origin at its own base center,
players walk through it along Y).
Menu props: podium origin at base center (z=0); backdrop_wall origin at
wall base center (z=0), visible face toward -Y (stands behind the podium,
viewed from -Y per main_menu-spec.md).
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import bmesh
import style as S


# ------------------------------------------------------------- helpers -----

def half_torus(name, r_major, r_minor, loc=(0, 0, 0), rot=None,
               seg_major=24, seg_minor=8, material=None, keep="+Z"):
    """Half-torus arch: full torus with one half removed via bisect, leaving
    an open tube (a proper C-profile arch, not a filled disc). The two small
    tube-end openings are capped individually (never seen from outside a
    walk-through archway, but caps keep the mesh watertight and cheap)."""
    ob = S.torus(name, r_major=r_major, r_minor=r_minor, loc=(0, 0, 0),
                 rot=None, seg_major=seg_major, seg_minor=seg_minor,
                 material=material)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    plane_no = (0, 0, 1) if keep in ("+Z", "-Z") else (0, 1, 0)
    sign = 1 if keep in ("+Z", "+Y") else -1
    bmesh.ops.bisect_plane(
        bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
        plane_co=(0, 0, 0), plane_no=[c * sign for c in plane_no],
        clear_inner=True, clear_outer=False)
    # cap each small tube-end boundary loop independently -- bmesh.ops
    # holes_fill treats ALL boundary edges as one job and can bridge
    # unrelated loops into one giant flat n-gon, so walk + fill per loop.
    remaining = set(e for e in bm.edges if e.is_boundary)
    while remaining:
        seed = next(iter(remaining))
        loop_edges = [seed]
        remaining.discard(seed)
        stack = [seed]
        while stack:
            cur = stack.pop()
            for v in cur.verts:
                for e2 in v.link_edges:
                    if e2 in remaining:
                        remaining.discard(e2)
                        loop_edges.append(e2)
                        stack.append(e2)
        bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=True,
                                edges=loop_edges)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    if rot:
        ob.rotation_euler = rot
    ob.location = loc
    return ob


def lattice_pole(name, r, height, loc, n=3, material=None):
    """n thin cylinders spaced around a small radius, faking a lattice mast."""
    parts = []
    ring_r = r * 1.6
    for i in range(n):
        a = i * 2 * math.pi / n
        p = S.cyl(f"{name}_rod{i}", r=r * 0.35, depth=height,
                  loc=(loc[0] + ring_r * math.cos(a),
                       loc[1] + ring_r * math.sin(a),
                       loc[2] + height / 2),
                  verts=6, material=material)
        parts.append(p)
    return parts


# =================================================================== SPACE =

def pylon_glow(name):
    S.reset()
    parts = []
    h_total = 2.2
    seg_h = h_total / 3.0
    r_bottoms = (0.42, 0.30, 0.18)
    r_tops = (0.32, 0.19, 0.07)
    z = 0.0
    for i in range(3):
        seg = S.cyl(f"seg{i}", r=r_bottoms[i], r2=r_tops[i], depth=seg_h,
                    verts=8, loc=(0, 0, z + seg_h / 2), material=S.m_steel())
        S.bevel(seg, width=0.015, segments=1)
        parts.append(seg)
        if i < 2:
            ring = S.torus(f"ring{i}", r_major=r_tops[i] + 0.015, r_minor=0.03,
                           loc=(0, 0, z + seg_h), seg_major=12, seg_minor=5,
                           material=S.m_glow("cyan", 6))
            parts.append(ring)
        z += seg_h
    base = S.cyl("base", r=0.46, depth=0.08, loc=(0, 0, 0.04), verts=8,
                 material=S.m_dark())
    parts.append(base)
    tip = S.sphere("tip", r=0.09, loc=(0, 0, h_total + 0.02), seg=8, rings=5,
                   material=S.m_glow("cyan", 8))
    parts.append(tip)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def antenna(name):
    S.reset()
    parts = []
    base = S.box("base", (0.5, 0.5, 0.22), loc=(0, 0, 0.11),
                 material=S.m_body())
    S.bevel(base, width=0.02, segments=1)
    parts.append(base)
    pole_h = 2.5
    parts += lattice_pole("pole", r=0.045, height=pole_h,
                          loc=(0, 0, 0.22), n=3, material=S.m_steel())
    # cross braces between rods, a couple of rungs
    for t in (0.3, 0.62, 0.9):
        brace = S.torus(f"brace{int(t*100)}", r_major=0.045 * 1.6, r_minor=0.012,
                        loc=(0, 0, 0.22 + pole_h * t), seg_major=6, seg_minor=4,
                        material=S.m_steel())
        parts.append(brace)
    # shallow dish plates (satellite-dish read: wide + thin, facing outward
    # along +X), a shallow cone flattened almost flat so it reads as a disc
    # with a slight concave taper rather than a tall lens/cone blob.
    dish_z0 = 0.22 + pole_h * 0.55
    dish_z1 = 0.22 + pole_h * 0.85
    for i, dz in enumerate((dish_z0, dish_z1)):
        dish = S.cyl(f"dish{i}", r=0.2, r2=0.16, depth=0.05, verts=10,
                     loc=(0.32, 0, dz), rot=(0, math.pi / 2, 0),
                     material=S.m_plate())
        parts.append(dish)
        mount = S.cyl(f"mount{i}", r=0.025, depth=0.24, verts=6,
                      loc=(0.16, 0, dz), rot=(0, math.pi / 2, 0),
                      material=S.m_steel())
        parts.append(mount)
    beacon = S.sphere("beacon", r=0.06, loc=(0, 0, 0.22 + pole_h + 0.06),
                      seg=8, rings=5, material=S.m_glow("red", 8))
    parts.append(beacon)
    mast_tip = S.cyl("mast_tip", r=0.02, r2=0.005, depth=0.15, verts=6,
                     loc=(0, 0, 0.22 + pole_h + 0.075),
                     material=S.m_steel())
    parts.append(mast_tip)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def solar_fin(name):
    S.reset()
    parts = []
    post = S.cyl("post", r=0.07, depth=1.1, loc=(0, 0, 0.55), verts=8,
                 material=S.m_steel())
    S.bevel(post, width=0.015, segments=2)
    parts.append(post)
    base = S.cyl("base", r=0.24, depth=0.1, loc=(0, 0, 0.05), verts=10,
                 material=S.m_dark())
    parts.append(base)
    # angled panel assembly pivoting from the post top
    panel_w, panel_h, panel_t = 1.5, 1.7, 0.05
    tilt = math.radians(35)
    panel = S.box("panel", (panel_w, panel_t, panel_h),
                  loc=(0, 0, 1.1 + panel_h / 2 * math.cos(tilt)),
                  rot=(tilt, 0, 0), material=S.m_dark())
    S.bevel(panel, width=0.02, segments=1)
    parts.append(panel)
    # steel frame as 4 thin border strips around the panel edge (not a solid
    # slab) so it frames the face without occluding the grid lines that sit
    # proud of the panel's front (-Y-in-local-space) face.
    frame_th = 0.03
    for fx, fz, fw, fh in (
            (0, panel_h / 2, panel_w + frame_th, frame_th),   # top
            (0, -panel_h / 2, panel_w + frame_th, frame_th),  # bottom
            (panel_w / 2, 0, frame_th, panel_h),              # right
            (-panel_w / 2, 0, frame_th, panel_h)):            # left
        strip = S.box(f"frame_{fx}_{fz}", (fw, panel_t + 0.02, fh),
                      material=S.m_steel())
        strip.location = (fx, 0, 1.1 + panel_h / 2 * math.cos(tilt) + fz * math.cos(tilt))
        strip.location = (fx, -fz * math.sin(tilt),
                          1.1 + panel_h / 2 * math.cos(tilt) + fz * math.cos(tilt))
        strip.rotation_euler = (tilt, 0, 0)
        parts.append(strip)
    # violet emissive grid lines across the panel face (proud of the front
    # face by more than the panel's own half-thickness so they aren't
    # z-fighting/occluded by the panel body).
    grid_y_off = panel_t / 2 + 0.015
    n_v, n_h = 3, 3
    for i in range(1, n_v):
        gx = -panel_w / 2 + panel_w * i / n_v
        line = S.box(f"gridv{i}", (0.02, 0.01, panel_h * 0.92),
                     material=S.m_glow("violet", 4))
        line.location = (gx, -grid_y_off, 1.1 + panel_h / 2 * math.cos(tilt))
        line.rotation_euler = (tilt, 0, 0)
        parts.append(line)
    for j in range(1, n_h):
        gz_local = -panel_h / 2 + panel_h * j / n_h
        line = S.box(f"gridh{j}", (panel_w * 0.92, 0.01, 0.02),
                     material=S.m_glow("violet", 4))
        # offset along the panel's tilted local Z axis, then push out along
        # local -Y (front face normal) by grid_y_off
        line.location = (0,
                         -gz_local * math.sin(tilt) - grid_y_off * math.cos(tilt),
                         1.1 + panel_h / 2 * math.cos(tilt) + gz_local * math.cos(tilt) - grid_y_off * math.sin(tilt))
        line.rotation_euler = (tilt, 0, 0)
        parts.append(line)
    # strut bracing the panel back to the post
    strut = S.box("strut", (0.05, 0.05, 0.55),
                  loc=(0, -0.28, 1.1 + 0.25),
                  rot=(tilt * 0.55, 0, 0), material=S.m_steel())
    parts.append(strut)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def edge_trim(name):
    S.reset()
    parts = []
    length = 2.0
    # L-profile: horizontal lip (top, sits on platform edge) + vertical face
    horiz = S.box("horiz", (length, 0.28, 0.05), loc=(0, 0, -0.025),
                  material=S.m_steel())
    S.bevel(horiz, width=0.01, segments=2)
    parts.append(horiz)
    vert = S.box("vert", (length, 0.05, 0.22), loc=(0, 0.115, -0.11),
                material=S.m_body())
    S.bevel(vert, width=0.008, segments=2)
    parts.append(vert)
    strip = S.box("strip", (length * 0.94, 0.02, 0.06), loc=(0, 0.14, -0.11),
                 material=S.m_glow("cyan", 5))
    parts.append(strip)
    # a couple of rivet-like steel studs for detail
    for x in (-length * 0.35, length * 0.35):
        stud = S.cyl("stud%d" % int(x * 100), r=0.025, depth=0.03, verts=6,
                     loc=(x, 0.14, -0.11), rot=(math.pi / 2, 0, 0),
                     material=S.m_steel())
        parts.append(stud)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def ring_arch(name):
    S.reset()
    parts = []
    r_major = 1.5   # 3.0m diameter
    r_minor = 0.14
    steel = half_torus("arch_steel", r_major=r_major - 0.05, r_minor=r_minor,
                       rot=(math.pi / 2, 0, 0), seg_major=18, seg_minor=6,
                       material=S.m_steel(), keep="+Z")
    S.bevel(steel, width=0.02, segments=1)
    parts.append(steel)
    glow = half_torus("arch_glow", r_major=r_major - 0.05, r_minor=r_minor * 0.45,
                      rot=(math.pi / 2, 0, 0), seg_major=18, seg_minor=5,
                      material=S.m_glow("violet", 5), keep="+Z")
    parts.append(glow)
    # two footings at the base so it reads as a real archway
    for side in (-1, 1):
        foot = S.cyl(f"foot{side}", r=r_minor + 0.05, depth=0.3,
                     loc=(side * (r_major - 0.05), 0, 0.15), verts=8,
                     material=S.m_dark())
        S.bevel(foot, width=0.015, segments=1)
        parts.append(foot)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


# ==================================================================== MENU =

def podium(name):
    S.reset()
    parts = []
    r = 0.8  # 1.6m diameter
    # 3 stacked discs
    d0 = S.cyl("disc0", r=r, depth=0.09, loc=(0, 0, 0.045), verts=28,
              material=S.m_dark())
    S.bevel(d0, width=0.015, segments=2)
    parts.append(d0)
    d1 = S.cyl("disc1", r=r - 0.08, depth=0.08, loc=(0, 0, 0.09 + 0.04), verts=28,
              material=S.m_steel())
    S.bevel(d1, width=0.012, segments=2)
    parts.append(d1)
    d2 = S.cyl("disc2", r=r - 0.16, depth=0.06, loc=(0, 0, 0.09 + 0.08 + 0.03),
              verts=28, material=S.m_body())
    S.bevel(d2, width=0.01, segments=2)
    parts.append(d2)
    rim = S.torus("rim", r_major=r - 0.02, r_minor=0.025, loc=(0, 0, 0.09),
                  seg_major=32, seg_minor=6, material=S.m_glow("cyan", 6))
    parts.append(rim)
    top_ring = S.torus("top_ring", r_major=r - 0.2, r_minor=0.012,
                       loc=(0, 0, 0.09 + 0.08 + 0.06), seg_major=28, seg_minor=5,
                       material=S.m_glow("cyan", 2.5))
    parts.append(top_ring)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def backdrop_wall(name):
    S.reset()
    parts = []
    width, height, thick = 6.0, 3.5, 0.3
    # Visible face must point -Y -> panel face plane sits at +Y side of the
    # slab is the BACK; the front detail (seams, plates) sits on -Y face.
    wall = S.box("wall", (width, thick, height), loc=(0, 0, height / 2),
                material=S.m_body())
    S.bevel(wall, width=0.02, segments=2)
    parts.append(wall)

    face_y = -thick / 2 - 0.01  # just proud of the -Y face

    # grid of beveled plates on the visible (-Y) face
    cols, rows = 5, 3
    pad = 0.08
    cell_w = (width - pad * (cols + 1)) / cols
    cell_h = (height - pad * (rows + 1)) / rows
    recessed = {(1, 1), (3, 0), (0, 2)}
    for cxi in range(cols):
        for ryi in range(rows):
            cx = -width / 2 + pad * (cxi + 1) + cell_w * (cxi + 0.5)
            cz = pad * (ryi + 1) + cell_h * (ryi + 0.5)
            is_recessed = (cxi, ryi) in recessed
            depth = 0.03 if not is_recessed else 0.05
            yoff = face_y - (0.01 if not is_recessed else -0.02)
            plate = S.box(f"plate_{cxi}_{ryi}", (cell_w, depth, cell_h),
                         loc=(cx, yoff, cz), material=S.m_steel())
            S.bevel(plate, width=0.012, segments=2)
            parts.append(plate)

    # two vertical cyan emissive light seams
    for sx in (-width * 0.22, width * 0.22):
        seam = S.box(f"seam_v_{int(sx*100)}", (0.05, 0.04, height * 0.88),
                     loc=(sx, face_y - 0.02, height / 2),
                     material=S.m_glow("cyan", 6))
        parts.append(seam)

    # one horizontal white emissive strip
    strip = S.box("seam_h", (width * 0.9, 0.04, 0.06),
                  loc=(0, face_y - 0.02, height * 0.58),
                  material=S.m_glow("white", 5))
    parts.append(strip)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


# ================================================================= BUILDS ==

BUILDS = [
    ("pylon_glow",    lambda: pylon_glow("pylon_glow"),       os.path.join("env", "space", "pylon_glow.glb"), 2000),
    ("antenna",       lambda: antenna("antenna"),             os.path.join("env", "space", "antenna.glb"), 2000),
    ("solar_fin",     lambda: solar_fin("solar_fin"),         os.path.join("env", "space", "solar_fin.glb"), 2000),
    ("edge_trim",     lambda: edge_trim("edge_trim"),         os.path.join("env", "space", "edge_trim.glb"), 2000),
    ("ring_arch",     lambda: ring_arch("ring_arch"),         os.path.join("env", "space", "ring_arch.glb"), 2000),
    ("podium",        lambda: podium("podium"),               os.path.join("menu", "podium.glb"), 3000),
    ("backdrop_wall", lambda: backdrop_wall("backdrop_wall"), os.path.join("menu", "backdrop_wall.glb"), 3000),
]

ok = True
for name, build, rel_path, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, rel_path, budget) and ok

print("GEN_DONE env_space_menu ok=%s" % ok)
sys.exit(0 if ok else 1)
