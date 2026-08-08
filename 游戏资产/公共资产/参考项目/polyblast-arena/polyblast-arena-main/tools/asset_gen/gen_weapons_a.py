"""Weapons batch A: pulse_rifle, thumper, scattergun.

Weapon origin: grip/handle pivot at (0,0,0), barrel extends +Y, up is +Z.
Each build adds a "muzzle" EMPTY at the barrel tip and includes it in the
objs list passed to S.finish so it exports inside the GLB.
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style as S
import bpy


def _muzzle(y):
    bpy.ops.object.empty_add(type="PLAIN_AXES", radius=0.03, location=(0, y, 0))
    ob = bpy.context.active_object
    ob.name = "muzzle"
    return ob


def pulse_rifle(name):
    S.reset()
    parts = []

    # --- receiver: boxy body, gunmetal, sits behind grip toward -Y/rear ---
    receiver = S.box("receiver", (0.09, 0.36, 0.12), loc=(0, -0.06, 0.02),
                      material=S.m_body())
    S.bevel(receiver, width=0.008, segments=2)
    parts.append(receiver)

    # front sub-block where receiver steps down toward the barrel collar
    collar = S.box("collar", (0.075, 0.10, 0.095), loc=(0, 0.14, 0.015),
                    material=S.m_body())
    S.bevel(collar, width=0.006, segments=2)
    parts.append(collar)

    # side plate detail (gunmetal body + plate accent panel)
    plate = S.box("plate", (0.005, 0.22, 0.06), loc=(0.048, -0.04, 0.03),
                   material=S.m_plate())
    parts.append(plate)
    plate2 = plate.copy()
    plate2.data = plate.data.copy()
    plate2.name = "plate_l"
    plate2.location = (-0.048, -0.04, 0.03)
    bpy.context.collection.objects.link(plate2)
    parts.append(plate2)

    # --- barrel: octagonal, extends +Y from collar ---
    barrel_len = 0.46
    barrel = S.prism("barrel", sides=8, r=0.028, depth=barrel_len,
                      loc=(0, 0.19 + barrel_len / 2, 0.015),
                      rot=(math.pi / 2, 0, 0), material=S.m_steel())
    S.bevel(barrel, width=0.004, segments=1)
    parts.append(barrel)

    # shroud around front half of barrel with vent slits (thin boxes cut look
    # via small gaps -- represented as separate short ring segments)
    shroud_len = 0.24
    shroud_y = 0.19 + barrel_len - shroud_len / 2 + 0.02
    shroud = S.cyl("shroud", r=0.042, depth=shroud_len, loc=(0, shroud_y, 0.015),
                    rot=(math.pi / 2, 0, 0), verts=10, material=S.m_dark())
    S.bevel(shroud, width=0.004, segments=1)
    parts.append(shroud)
    # vent ring cuts: thin darker rings to break up the shroud silhouette
    n_vents = 3
    for i in range(n_vents):
        vy = shroud_y - shroud_len / 2 + 0.03 + i * (shroud_len - 0.06) / (n_vents - 1)
        vent = S.torus("vent%d" % i, r_major=0.043, r_minor=0.006,
                        loc=(0, vy, 0.015), rot=(math.pi / 2, 0, 0),
                        seg_major=8, seg_minor=4, material=S.m_dark())
        parts.append(vent)

    # muzzle cap (flat octagon end)
    cap = S.prism("cap", sides=8, r=0.034, depth=0.02,
                   loc=(0, 0.19 + barrel_len + 0.03, 0.015),
                   rot=(math.pi / 2, 0, 0), material=S.m_steel())
    parts.append(cap)

    # single cyan emissive strip along receiver top + onto barrel top
    strip = S.box("emis_strip", (0.015, 0.30, 0.012),
                   loc=(0, 0.02, 0.085), material=S.m_glow("cyan"))
    parts.append(strip)
    strip2 = S.box("emis_strip_barrel", (0.012, 0.20, 0.01),
                    loc=(0, 0.20, 0.05), material=S.m_glow("cyan"))
    parts.append(strip2)

    # top rail (thin plate along receiver top)
    rail = S.box("rail", (0.05, 0.28, 0.014), loc=(0, -0.02, 0.10),
                  material=S.m_dark())
    S.bevel(rail, width=0.004, segments=1)
    parts.append(rail)

    # compact sight on rail
    sight_base = S.box("sight_base", (0.03, 0.05, 0.03), loc=(0, 0.05, 0.125),
                        material=S.m_dark())
    parts.append(sight_base)
    sight_dot = S.cyl("sight_dot", r=0.008, depth=0.01, loc=(0, 0.05, 0.145),
                       rot=(math.pi / 2, 0, 0), verts=8, material=S.m_glow("cyan", 3.0))
    parts.append(sight_dot)

    # drop magazine ahead of grip, pointing down
    mag = S.box("mag", (0.045, 0.075, 0.16), loc=(0, 0.02, -0.10),
                rot=(0.12, 0, 0), material=S.m_dark())
    S.bevel(mag, width=0.006, segments=2)
    parts.append(mag)
    mag_band = S.box("mag_band", (0.05, 0.078, 0.02), loc=(0, 0.02, -0.05),
                      rot=(0.12, 0, 0), material=S.m_plate())
    parts.append(mag_band)

    # grip (pivot origin) below receiver rear, angled slightly back
    grip = S.box("grip", (0.05, 0.05, 0.14), loc=(0, -0.015, -0.075),
                 rot=(-0.15, 0, 0), material=S.m_dark())
    S.bevel(grip, width=0.006, segments=2)
    parts.append(grip)
    trigger_guard = S.torus("tguard", r_major=0.028, r_minor=0.006,
                             loc=(0, 0.04, -0.015), rot=(0, math.pi / 2, 0),
                             seg_major=8, seg_minor=4, material=S.m_dark())
    parts.append(trigger_guard)

    # stock extends -Y from receiver rear
    stock = S.box("stock", (0.05, 0.20, 0.075), loc=(0, -0.28, 0.0),
                   material=S.m_body())
    S.bevel(stock, width=0.006, segments=2)
    parts.append(stock)
    stock_pad = S.box("stock_pad", (0.055, 0.02, 0.09), loc=(0, -0.38, 0.0),
                       material=S.m_dark())
    parts.append(stock_pad)

    muzzle = _muzzle(0.19 + barrel_len + 0.04)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob, muzzle]


def thumper(name):
    S.reset()
    parts = []

    tube_len = 0.75
    tube_r = 0.08
    tube_start_y = -0.20

    # main tube (thick, extends +Y), grip pivot roughly under the tube middle
    tube = S.cyl("tube", r=tube_r, depth=tube_len, verts=14,
                 loc=(0, tube_start_y + tube_len / 2, 0.0),
                 rot=(math.pi / 2, 0, 0), material=S.m_body())
    S.bevel(tube, width=0.008, segments=2)
    parts.append(tube)

    # ribbed rear drum (rear third), slightly larger radius, orange accent bands
    drum = S.cyl("drum", r=tube_r + 0.012, depth=0.26, verts=14,
                 loc=(0, tube_start_y + 0.10, 0.0), rot=(math.pi / 2, 0, 0),
                 material=S.m_steel())
    S.bevel(drum, width=0.006, segments=2)
    parts.append(drum)
    n_ribs = 4
    for i in range(n_ribs):
        ry = tube_start_y + 0.01 + i * 0.22 / (n_ribs - 1)
        rib = S.torus("rib%d" % i, r_major=tube_r + 0.016, r_minor=0.012,
                       loc=(0, ry, 0.0), rot=(math.pi / 2, 0, 0),
                       seg_major=14, seg_minor=6, material=S.m_dark())
        parts.append(rib)

    # rear end cap
    endcap = S.cyl("endcap", r=tube_r + 0.01, depth=0.03, verts=14,
                    loc=(0, tube_start_y - 0.015, 0.0), rot=(math.pi / 2, 0, 0),
                    material=S.m_dark())
    parts.append(endcap)

    # orange accent bands along the tube (two thin rings)
    band1 = S.torus("band1", r_major=tube_r + 0.006, r_minor=0.014,
                     loc=(0, tube_start_y + 0.34, 0.0), rot=(math.pi / 2, 0, 0),
                     seg_major=14, seg_minor=6, material=S.m_accent("orange"))
    parts.append(band1)
    band2 = S.torus("band2", r_major=tube_r + 0.006, r_minor=0.014,
                     loc=(0, tube_start_y + 0.52, 0.0), rot=(math.pi / 2, 0, 0),
                     seg_major=14, seg_minor=6, material=S.m_accent("orange"))
    parts.append(band2)

    # front blast ring (flared muzzle end)
    blast_y = tube_start_y + tube_len
    blast_ring = S.cyl("blast_ring", r=tube_r + 0.03, r2=tube_r + 0.005,
                        depth=0.09, verts=14, loc=(0, blast_y - 0.02, 0.0),
                        rot=(math.pi / 2, 0, 0), material=S.m_steel())
    S.bevel(blast_ring, width=0.005, segments=1)
    parts.append(blast_ring)

    # orange emissive muzzle ring at the very front lip
    muzzle_glow = S.torus("muzzle_glow", r_major=tube_r + 0.025, r_minor=0.014,
                           loc=(0, blast_y + 0.02, 0.0), rot=(math.pi / 2, 0, 0),
                           seg_major=16, seg_minor=6, material=S.m_glow("orange", 5.0))
    parts.append(muzzle_glow)

    # side grip (pivot origin at 0,0,0), mounted under tube near center-front
    grip = S.box("grip", (0.05, 0.055, 0.16), loc=(0, 0.0, -0.10),
                 rot=(-0.08, 0, 0), material=S.m_dark())
    S.bevel(grip, width=0.007, segments=2)
    parts.append(grip)
    trigger_guard = S.torus("tguard", r_major=0.03, r_minor=0.007,
                             loc=(0, 0.045, -0.03), rot=(0, math.pi / 2, 0),
                             seg_major=12, seg_minor=6, material=S.m_dark())
    parts.append(trigger_guard)

    # top carry handle, arched over the rear/mid section
    handle_l = S.box("handle_l", (0.02, 0.02, 0.09),
                      loc=(0, tube_start_y + 0.16, tube_r + 0.05),
                      material=S.m_dark())
    parts.append(handle_l)
    handle_r = S.box("handle_r", (0.02, 0.02, 0.09),
                      loc=(0, tube_start_y + 0.32, tube_r + 0.05),
                      material=S.m_dark())
    parts.append(handle_r)
    handle_top = S.box("handle_top", (0.022, 0.20, 0.02),
                        loc=(0, tube_start_y + 0.24, tube_r + 0.095),
                        material=S.m_dark())
    S.bevel(handle_top, width=0.004, segments=1)
    parts.append(handle_top)

    # small rear stabilizer fin (thin, orange accent) underside near drum
    fin = S.box("fin", (0.008, 0.09, 0.05), loc=(0, tube_start_y + 0.06, -tube_r - 0.02),
                material=S.m_accent("orange"))
    parts.append(fin)

    muzzle = _muzzle(blast_y + 0.05)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob, muzzle]


def scattergun(name):
    S.reset()
    parts = []

    # wide flat receiver block
    receiver = S.box("receiver", (0.12, 0.28, 0.10), loc=(0, -0.02, 0.02),
                      material=S.m_body())
    S.bevel(receiver, width=0.008, segments=2)
    parts.append(receiver)

    # double short barrels side-by-side, extend +Y (poke out past the shroud
    # so the twin-barrel silhouette reads clearly)
    barrel_len = 0.34
    barrel_y = 0.12 + barrel_len / 2
    br = 0.022
    barrel_l = S.cyl("barrel_l", r=br, depth=barrel_len, verts=8,
                      loc=(-0.032, barrel_y, 0.03), rot=(math.pi / 2, 0, 0),
                      material=S.m_steel())
    parts.append(barrel_l)
    barrel_r = S.cyl("barrel_r", r=br, depth=barrel_len, verts=8,
                      loc=(0.032, barrel_y, 0.03), rot=(math.pi / 2, 0, 0),
                      material=S.m_steel())
    parts.append(barrel_r)

    # perforated shroud wrapping both barrels: a single flattened box (not a
    # cylinder) so it clearly reads as a shroud sleeve, shorter than the
    # barrels so the muzzle tips poke out the front
    shroud_len = barrel_len - 0.10
    shroud = S.box("shroud", (0.10, shroud_len, 0.05),
                    loc=(0, barrel_y - 0.035, 0.03), material=S.m_dark())
    S.bevel(shroud, width=0.006, segments=2)
    parts.append(shroud)
    # perforation accents (small dark disks) to read as vent holes, cheap tris
    n_holes = 3
    for i in range(n_holes):
        hy = barrel_y - shroud_len / 2 - 0.02 + i * (shroud_len - 0.04) / (n_holes - 1)
        for side in (-0.032, 0.032):
            hole = S.cyl("hole%d_%d" % (i, 0 if side < 0 else 1), r=0.012,
                          depth=0.008, verts=6, loc=(side, hy, 0.055),
                          rot=(math.pi / 2, 0, 0), material=S.m_dark())
            parts.append(hole)

    # muzzle end caps (flat, where the two barrels terminate)
    cap_l = S.cyl("cap_l", r=br + 0.004, depth=0.012, verts=8,
                   loc=(-0.032, 0.12 + barrel_len, 0.03), rot=(math.pi / 2, 0, 0),
                   material=S.m_steel())
    parts.append(cap_l)
    cap_r = S.cyl("cap_r", r=br + 0.004, depth=0.012, verts=8,
                   loc=(0.032, 0.12 + barrel_len, 0.03), rot=(math.pi / 2, 0, 0),
                   material=S.m_steel())
    parts.append(cap_r)

    # yellow accent band around receiver front (single accent color)
    accent_band = S.box("accent_band", (0.125, 0.03, 0.105), loc=(0, 0.10, 0.02),
                         material=S.m_accent("yellow"))
    parts.append(accent_band)

    # pump slide (box under barrels, forward of receiver)
    pump = S.box("pump", (0.075, 0.14, 0.05), loc=(0, 0.08, -0.03),
                 material=S.m_dark())
    S.bevel(pump, width=0.006, segments=2)
    parts.append(pump)
    # pump grip ridges (thin ring accents)
    for i in range(3):
        py = 0.03 + i * 0.05
        ridge = S.torus("ridge%d" % i, r_major=0.045, r_minor=0.006,
                         loc=(0, py, -0.03), rot=(math.pi / 2, 0, 0),
                         seg_major=8, seg_minor=4, material=S.m_steel())
        parts.append(ridge)

    # small lime emissive shell indicator strip on receiver side
    shell_ind = S.box("shell_indicator", (0.006, 0.10, 0.02),
                       loc=(0.062, -0.04, 0.03), material=S.m_glow("lime"))
    parts.append(shell_ind)

    # grip (pivot origin) below receiver rear
    grip = S.box("grip", (0.055, 0.055, 0.15), loc=(0, -0.11, -0.03),
                 rot=(-0.18, 0, 0), material=S.m_dark())
    S.bevel(grip, width=0.007, segments=2)
    parts.append(grip)
    trigger_guard = S.torus("tguard", r_major=0.03, r_minor=0.007,
                             loc=(0, -0.03, -0.045), rot=(0, math.pi / 2, 0),
                             seg_major=8, seg_minor=4, material=S.m_dark())
    parts.append(trigger_guard)

    # thick stock extends -Y from receiver rear
    stock = S.box("stock", (0.07, 0.24, 0.11), loc=(0, -0.30, 0.03),
                  material=S.m_body())
    S.bevel(stock, width=0.008, segments=2)
    parts.append(stock)
    stock_pad = S.box("stock_pad", (0.075, 0.025, 0.125), loc=(0, -0.415, 0.03),
                       material=S.m_dark())
    parts.append(stock_pad)

    muzzle = _muzzle(0.12 + barrel_len + 0.015)

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob, muzzle]


BUILDS = [
    ("wpn_0_pulse_rifle", lambda: pulse_rifle("wpn_0_pulse_rifle"), 6000),
    ("wpn_1_thumper",     lambda: thumper("wpn_1_thumper"), 6000),
    ("wpn_2_scattergun",  lambda: scattergun("wpn_2_scattergun"), 6000),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("weapons", name + ".glb"), budget) and ok

print("GEN_DONE weapons_a ok=%s" % ok)
sys.exit(0 if ok else 1)
