"""Env kit: snow/winter military outpost (Glacier Post) props.

sandbag_wall, watchtower, fence_seg, floodlight, crate_snow.
All props: origin at base center, sitting on floor at z=0. Budget 2500 tris each.
Palette: gunmetal/steel/dark bodies + plate/white snow caps, orange/red accents,
white emissive floodlight faces + small yellow emissive indicator only.
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style as S
from mathutils import Vector, Matrix


def m_snowcap():
    return S.m_plate()  # cool light plate reused as the "snow" material


def m_snowwhite():
    return S.mat("pb_snow_white", "white", rough=0.6)


def sandbag_wall(name):
    S.reset()
    parts = []
    length = 1.8
    height = 0.9
    depth = 0.34
    rows = 3
    row_h = height / rows
    bag_len = 0.34
    n_bags = int(round(length / bag_len))

    for row in range(rows):
        z = row_h * row + row_h / 2
        stagger = (row_h * 0.35) if (row % 2 == 1) else 0.0
        # slight per-row inset so the stack tapers a bit like real sandbag walls
        row_depth = depth * (1.0 - row * 0.06)
        for i in range(n_bags):
            x = -length / 2 + bag_len / 2 + i * bag_len + stagger * (1 if i % 2 == 0 else -1) * 0.15
            # keep bags within the wall footprint
            x = max(-length / 2 + bag_len * 0.4, min(length / 2 - bag_len * 0.4, x))
            bulge = 1.0 + 0.06 * ((i + row) % 2)
            bag = S.box(f"bag_{row}_{i}",
                        (bag_len * 0.94, row_depth * bulge, row_h * 0.92),
                        loc=(x, 0, z),
                        material=S.m_plate())
            S.bevel(bag, width=0.05, segments=2)
            parts.append(bag)

    # thin white snow cap layer on top row only
    cap = S.box("snow_cap", (length * 0.98, depth * 0.86, 0.05),
                loc=(0, 0, height + 0.025), material=m_snowwhite())
    S.bevel(cap, width=0.015, segments=1)
    parts.append(cap)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def watchtower(name):
    S.reset()
    parts = []
    total_h = 4.5
    leg_span = 1.6      # half-span of legs footprint (x/y each direction)
    cabin_h = 1.5
    cabin_w = 1.9
    cabin_d = 1.9
    deck_z = total_h - cabin_h - 0.15   # deck sits below cabin
    leg_r = 0.07

    # 4 tapered legs, gunmetal, angled inward slightly (truncated cone)
    leg_positions = [(-leg_span, -leg_span), (leg_span, -leg_span),
                      (-leg_span, leg_span), (leg_span, leg_span)]
    for i, (lx, ly) in enumerate(leg_positions):
        top_x, top_y = lx * 0.55, ly * 0.55
        # approximate an angled leg with a rotated cylinder between base and deck
        base = (lx, ly, 0.0)
        top = (top_x, top_y, deck_z)
        mid = ((base[0] + top[0]) / 2, (base[1] + top[1]) / 2, (base[2] + top[2]) / 2)
        dx, dy, dz = top[0] - base[0], top[1] - base[1], top[2] - base[2]
        leg_len = math.sqrt(dx * dx + dy * dy + dz * dz)
        pitch = math.atan2(math.sqrt(dx * dx + dy * dy), dz)
        yaw = math.atan2(dy, dx)
        leg = S.cyl(f"leg{i}", r=leg_r, r2=leg_r * 0.7, depth=leg_len, verts=8,
                    loc=mid, rot=(pitch, 0, yaw - math.pi / 2),
                    material=S.m_body())
        S.bevel(leg, width=0.01, segments=1)
        parts.append(leg)

        # cross braces between adjacent legs (simple horizontal strut at mid height)
    brace_z = deck_z * 0.5
    brace_positions = [
        ((-leg_span * 0.78, -leg_span * 0.78), (leg_span * 0.78, -leg_span * 0.78)),
        ((-leg_span * 0.78, leg_span * 0.78), (leg_span * 0.78, leg_span * 0.78)),
        ((-leg_span * 0.78, -leg_span * 0.78), (-leg_span * 0.78, leg_span * 0.78)),
        ((leg_span * 0.78, -leg_span * 0.78), (leg_span * 0.78, leg_span * 0.78)),
    ]
    for i, (p0, p1) in enumerate(brace_positions):
        bx = (p0[0] + p1[0]) / 2
        by = (p0[1] + p1[1]) / 2
        blen = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        yaw = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        brace = S.box(f"brace{i}", (blen, 0.05, 0.05), loc=(bx, by, brace_z),
                      rot=(0, 0, yaw), material=S.m_steel())
        parts.append(brace)

    # ladder hint: 2 rails + rungs on the -Y face, from ground to deck
    rail_x = 0.18
    ladder_y = -leg_span * 0.6
    for side in (-1, 1):
        rail = S.box(f"ladder_rail{side}", (0.04, 0.04, deck_z),
                     loc=(side * rail_x, ladder_y, deck_z / 2),
                     material=S.m_steel())
        parts.append(rail)
    n_rungs = 6
    for i in range(n_rungs):
        rz = 0.25 + i * (deck_z - 0.4) / max(1, n_rungs - 1)
        rung = S.box(f"rung{i}", (rail_x * 2, 0.03, 0.03),
                     loc=(0, ladder_y, rz), material=S.m_steel())
        parts.append(rung)

    # deck plate under cabin
    deck = S.box("deck", (cabin_w * 1.08, cabin_d * 1.08, 0.12),
                loc=(0, 0, deck_z + 0.06), material=S.m_body())
    S.bevel(deck, width=0.02, segments=2)
    parts.append(deck)

    # cabin box
    cabin_z = deck_z + 0.12 + cabin_h / 2
    cabin = S.box("cabin", (cabin_w, cabin_d, cabin_h),
                 loc=(0, 0, cabin_z), material=S.m_body())
    S.bevel(cabin, width=0.02, segments=2)
    parts.append(cabin)

    # window slits: recessed dark panels on all 4 cabin faces
    slit_w, slit_h = cabin_w * 0.6, 0.22
    slit_positions = [
        (0, -cabin_d / 2 - 0.01, cabin_z, (math.pi / 2, 0, 0)),
        (0, cabin_d / 2 + 0.01, cabin_z, (math.pi / 2, 0, 0)),
        (-cabin_w / 2 - 0.01, 0, cabin_z, (math.pi / 2, 0, math.pi / 2)),
        (cabin_w / 2 + 0.01, 0, cabin_z, (math.pi / 2, 0, math.pi / 2)),
    ]
    for i, (sx, sy, sz, rot) in enumerate(slit_positions):
        slit = S.box(f"slit{i}", (slit_w, 0.02, slit_h), loc=(sx, sy, sz),
                     rot=rot, material=S.m_dark())
        parts.append(slit)

    # orange accent trim band around cabin base
    trim = S.box("trim", (cabin_w * 1.02, cabin_d * 1.02, 0.08),
                loc=(0, 0, cabin_z - cabin_h / 2 + 0.04),
                material=S.m_accent("orange"))
    parts.append(trim)

    # slanted roof (single tilted plate) + white snow cap top plate
    roof_z = cabin_z + cabin_h / 2 + 0.06
    roof = S.box("roof", (cabin_w * 1.25, cabin_d * 1.25, 0.08),
                loc=(0, 0.05, roof_z), rot=(math.radians(8), 0, 0),
                material=S.m_steel())
    S.bevel(roof, width=0.02, segments=2)
    parts.append(roof)
    snow_top = S.box("roof_snow", (cabin_w * 1.15, cabin_d * 0.7, 0.05),
                     loc=(0, -cabin_d * 0.15, roof_z + 0.065),
                     rot=(math.radians(8), 0, 0), material=m_snowwhite())
    parts.append(snow_top)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def fence_seg(name):
    S.reset()
    parts = []
    seg_len = 2.0
    post_h = 1.1
    post_r = 0.045

    for side in (-1, 1):
        px = side * (seg_len / 2 - 0.05)
        post = S.cyl(f"post{side}", r=post_r, depth=post_h,
                     loc=(px, 0, post_h / 2), verts=8, material=S.m_steel())
        S.bevel(post, width=0.008, segments=1)
        parts.append(post)
        cap = S.box(f"cap{side}", (post_r * 2.4, post_r * 2.4, 0.05),
                   loc=(px, 0, post_h + 0.02), material=m_snowwhite())
        parts.append(cap)

    # top rail
    rail = S.cyl("rail", r=0.03, depth=seg_len - 0.05, verts=8,
                loc=(0, 0, post_h - 0.03), rot=(0, math.pi / 2, 0),
                material=S.m_steel())
    parts.append(rail)

    # thin latticed panel: very thin backing box + inset grid of small diagonal
    # struts per cell (cheap chain-link hint, no wires overshooting the frame)
    panel_h = post_h - 0.15
    panel_z = 0.1 + panel_h / 2
    panel_w = seg_len - 0.14
    panel = S.box("panel_frame", (panel_w, 0.01, panel_h), loc=(0, 0, panel_z),
                 material=S.m_steel())
    parts.append(panel)

    cols, rows_ = 6, 3
    cell_w = panel_w / cols
    cell_h = panel_h / rows_
    diag_len = math.hypot(cell_w, cell_h) * 0.92
    for c in range(cols):
        for r in range(rows_):
            cx = -panel_w / 2 + cell_w * (c + 0.5)
            cz = panel_z - panel_h / 2 + cell_h * (r + 0.5)
            ang = math.atan2(cell_h, cell_w)
            wv = S.box(f"wv_{c}_{r}", (diag_len, 0.02, 0.012),
                       loc=(cx, 0, cz), rot=(0, 0, ang), material=S.m_dark())
            parts.append(wv)
            wh = S.box(f"wh_{c}_{r}", (diag_len, 0.02, 0.012),
                       loc=(cx, 0, cz), rot=(0, 0, -ang), material=S.m_dark())
            parts.append(wh)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def floodlight(name):
    S.reset()
    parts = []
    pole_h = 3.2
    pole_r = 0.06

    base = S.cyl("base", r=0.2, depth=0.14, loc=(0, 0, 0.07), verts=12,
                material=S.m_body())
    S.bevel(base, width=0.015, segments=2)
    parts.append(base)

    pole = S.cyl("pole", r=pole_r, r2=pole_r * 0.8, depth=pole_h - 0.55,
                loc=(0, 0, 0.14 + (pole_h - 0.55) / 2), verts=10,
                material=S.m_steel())
    S.bevel(pole, width=0.008, segments=1)
    parts.append(pole)

    # sized-up head assembly so it reads clearly against the tall thin pole
    head_mount_z = pole_h - 0.42
    yoke = S.box("yoke", (0.5, 0.09, 0.09), loc=(0, 0, head_mount_z),
                material=S.m_body())
    S.bevel(yoke, width=0.01, segments=1)
    parts.append(yoke)

    housing_size = 0.34
    tilt = math.radians(-28)  # tips the heads down/forward toward the arena
    for side in (-1, 1):
        hx = side * 0.24
        yaw = math.radians(8) * side
        head_z = head_mount_z + 0.22
        housing = S.box(f"housing{side}", (housing_size, housing_size * 0.72, housing_size),
                        loc=(hx, 0.03, head_z),
                        rot=(tilt, 0, yaw),
                        material=S.m_body())
        S.bevel(housing, width=0.015, segments=2)
        parts.append(housing)

        # white emissive face on the front (local +Y) of each head: offset
        # from the housing center along its own rotated forward axis so it
        # sits flush on the front plate regardless of tilt/yaw.
        fwd = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(tilt, 4, "X") @ Vector((0, 1, 0))
        face_loc = Vector((hx, 0.03, head_z)) + fwd * (housing_size * 0.72 / 2 + 0.005)
        face = S.box(f"face{side}", (housing_size * 0.86, 0.01, housing_size * 0.86),
                    loc=tuple(face_loc), rot=(math.pi / 2 + tilt, 0, yaw),
                    material=S.m_glow("white", 3.0))
        parts.append(face)

    # small yellow emissive indicator light near the yoke
    indicator = S.sphere("indicator", r=0.035,
                         loc=(0, -0.07, head_mount_z + 0.07),
                         material=S.m_glow("yellow", 3.0))
    parts.append(indicator)

    # thin snow ledge on base rim
    snow_ledge = S.cyl("snow_ledge", r=0.205, depth=0.03, loc=(0, 0, 0.145),
                       verts=12, material=m_snowwhite())
    parts.append(snow_ledge)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def crate_snow(name):
    S.reset()
    parts = []
    size = 1.2

    body = S.box("body", (size, size, size * 0.82), loc=(0, 0, size * 0.41),
                material=S.m_plate())
    S.bevel(body, width=0.03, segments=2)
    parts.append(body)

    # gunmetal frame: edge battens on the body (4 vertical corner posts)
    for sx in (-1, 1):
        for sy in (-1, 1):
            post = S.box(f"post_{sx}_{sy}", (0.07, 0.07, size * 0.82),
                        loc=(sx * (size / 2 - 0.05), sy * (size / 2 - 0.05), size * 0.41),
                        material=S.m_body())
            parts.append(post)
    # horizontal frame bands (top & bottom edges)
    for fz, fname in ((0.06, "band_bot"), (size * 0.82 - 0.06, "band_top")):
        band = S.box(fname, (size + 0.02, size + 0.02, 0.08), loc=(0, 0, fz),
                    material=S.m_body())
        parts.append(band)

    # red accent stencil band around the middle
    stencil = S.box("stencil", (size + 0.03, 0.16, 0.10),
                    loc=(0, -size / 2 - 0.005, size * 0.5),
                    material=S.m_accent("red"))
    parts.append(stencil)
    stencil2 = S.box("stencil2", (0.16, size + 0.03, 0.10),
                     loc=(size / 2 + 0.005, 0, size * 0.5),
                     material=S.m_accent("red"))
    parts.append(stencil2)

    # white snow cap plate on top
    cap = S.box("snow_cap", (size * 1.04, size * 1.04, 0.05),
               loc=(0, 0, size * 0.82 + 0.025), material=m_snowwhite())
    S.bevel(cap, width=0.01, segments=1)
    parts.append(cap)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


BUILDS = [
    ("sandbag_wall", lambda: sandbag_wall("sandbag_wall"), 2500),
    ("watchtower",   lambda: watchtower("watchtower"), 2500),
    ("fence_seg",    lambda: fence_seg("fence_seg"), 2500),
    ("floodlight",   lambda: floodlight("floodlight"), 2500),
    ("crate_snow",   lambda: crate_snow("crate_snow"), 2500),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("env", "snow", name + ".glb"), budget) and ok

print("GEN_DONE gen_env_snow ok=%s" % ok)
sys.exit(0 if ok else 1)
