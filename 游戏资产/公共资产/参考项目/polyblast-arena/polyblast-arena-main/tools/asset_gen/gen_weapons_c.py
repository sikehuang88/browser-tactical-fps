"""Weapons C: Nova Cannon, Circuit Blade, Lobber.

All weapons: grip pivot at (0,0,0), barrel/blade extends +Y, up +Z.
Each build adds a 'muzzle' EMPTY at the tip and includes it in S.finish objs.
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import style as S


def _empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.05
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


# --------------------------------------------------------------- Nova Cannon
def nova_cannon(name):
    S.reset()
    m_body = S.m_body()
    m_steel = S.m_steel()
    m_dark = S.m_dark()
    m_accent = S.m_accent("orange")
    m_glow_seam = S.m_glow("orange", 6)
    m_glow_muzzle = S.m_glow("orange", 8)

    parts = []

    # main fat tube: 0.2m diameter, runs along +Y. Rear block sits behind grip,
    # tube runs from y=0.18 (front of block) to y=1.0 (before muzzle bell).
    tube_len = 0.82
    tube_y0 = 0.18
    tube = S.cyl("tube", r=0.10, depth=tube_len,
                 loc=(0, tube_y0 + tube_len / 2, 0.02),
                 rot=(math.pi / 2, 0, 0), verts=14, material=m_dark)
    S.bevel(tube, width=0.006, segments=2)
    parts.append(tube)

    # 3 heavy ring clamps along the tube
    for i, ty in enumerate((0.30, 0.55, 0.80)):
        ring = S.torus("ring%d" % i, r_major=0.105, r_minor=0.022,
                       loc=(0, ty, 0.02), rot=(math.pi / 2, 0, 0),
                       seg_major=14, seg_minor=7, material=m_steel)
        parts.append(ring)

    # boxy rear power block with cooling fins, behind the grip area
    block = S.box("block", (0.22, 0.30, 0.24), loc=(0, -0.02, 0.03),
                  material=m_body)
    S.bevel(block, width=0.01, segments=2)
    parts.append(block)

    # cooling fins on top of block (5 thin vertical plates)
    for i, fx in enumerate((-0.08, -0.04, 0.0, 0.04, 0.08)):
        fin = S.box("fin%d" % i, (0.015, 0.26, 0.06),
                    loc=(fx, -0.02, 0.16), material=m_steel)
        parts.append(fin)

    # emissive seam between block and tube base
    seam = S.cyl("seam", r=0.105, depth=0.015, loc=(0, 0.155, 0.02),
                rot=(math.pi / 2, 0, 0), verts=14, material=m_glow_seam)
    parts.append(seam)

    # orange accent plates on the block sides
    for i, sx in enumerate((-1, 1)):
        plate = S.box("accplate%d" % i, (0.02, 0.20, 0.14),
                      loc=(sx * 0.115, -0.02, 0.03), material=m_accent)
        parts.append(plate)

    # oversized muzzle bell (truncated cone), flares out at the front
    bell = S.cyl("bell", r=0.10, r2=0.16, depth=0.16,
                loc=(0, tube_y0 + tube_len + 0.08, 0.02),
                rot=(math.pi / 2, 0, 0), verts=16, material=m_dark)
    S.bevel(bell, width=0.006, segments=2)
    parts.append(bell)

    # emissive muzzle interior (disc inset in the bell mouth)
    muzzle_y = tube_y0 + tube_len + 0.16
    interior = S.cyl("muzzle_glow", r=0.11, depth=0.02,
                     loc=(0, muzzle_y - 0.01, 0.02),
                     rot=(math.pi / 2, 0, 0), verts=16, material=m_glow_muzzle)
    parts.append(interior)

    # twin top handles (small D-shaped loops via torus segments -> use boxes+cyl bridge)
    for i, hx in enumerate((-0.06, 0.06)):
        post_f = S.box("hpostf%d" % i, (0.02, 0.02, 0.09),
                       loc=(hx, 0.02, 0.145), material=m_steel)
        post_b = S.box("hpostb%d" % i, (0.02, 0.02, 0.09),
                       loc=(hx, -0.10, 0.145), material=m_steel)
        bar = S.box("hbar%d" % i, (0.02, 0.14, 0.02),
                    loc=(hx, -0.04, 0.185), material=m_steel)
        parts += [post_f, post_b, bar]

    ob = S.join(parts, name)
    S.shade_auto(ob)

    muzzle = _empty("muzzle", (0, muzzle_y, 0.02))
    return [ob, muzzle]


# ------------------------------------------------------------- Circuit Blade
def circuit_blade(name):
    S.reset()
    m_hilt = S.mat("pb_gunmetal_hilt", "gunmetal", rough=0.45, metallic=0.5)
    m_plate = S.m_plate()
    m_steel = S.m_steel()
    m_glow_lime = S.m_glow("lime", 6)
    m_glow_gem = S.m_glow("lime", 9)

    parts = []

    hilt_len = 0.25
    grip = S.cyl("grip", r=0.028, depth=hilt_len, verts=10,
                loc=(0, hilt_len / 2 - 0.03, 0),
                rot=(math.pi / 2, 0, 0), material=m_hilt)
    S.bevel(grip, width=0.004, segments=2)
    parts.append(grip)

    # pommel cap at the rear
    pommel = S.cyl("pommel", r=0.032, depth=0.03, verts=10,
                   loc=(0, -0.045, 0), rot=(math.pi / 2, 0, 0),
                   material=m_steel)
    parts.append(pommel)

    guard_y = hilt_len - 0.03
    # chunky angular guard plate (box) with guard fins
    guard = S.box("guard", (0.16, 0.03, 0.05), loc=(0, guard_y, 0),
                  material=m_plate)
    S.bevel(guard, width=0.006, segments=2)
    parts.append(guard)

    for i, gx in enumerate((-0.075, 0.075)):
        fin = S.box("guardfin%d" % i, (0.03, 0.05, 0.02),
                    loc=(gx, guard_y + 0.015, 0), rot=(0, 0, 0),
                    material=m_steel)
        parts.append(fin)

    # small emissive power gem in the guard center
    gem = S.box("gem", (0.025, 0.02, 0.025), loc=(0, guard_y - 0.005, 0.0),
               material=m_glow_gem)
    parts.append(gem)

    # flat blade: 0.75 long, 0.09 wide, 0.02 thick, beveled edge
    blade_len = 0.75
    blade_y0 = guard_y + 0.015
    blade = S.box("blade", (0.09, blade_len, 0.02),
                 loc=(0, blade_y0 + blade_len / 2, 0), material=m_plate)
    S.bevel(blade, width=0.012, segments=2)
    parts.append(blade)

    # emissive circuit-line grooves down the blade center (thin inset boxes)
    groove_main = S.box("groove_main", (0.012, blade_len - 0.06, 0.024),
                        loc=(0, blade_y0 + blade_len / 2, 0),
                        material=m_glow_lime)
    parts.append(groove_main)

    # a few perpendicular circuit ticks along the groove for detail
    for i, ty in enumerate((0.18, 0.36, 0.54)):
        tick = S.box("tick%d" % i, (0.05, 0.01, 0.022),
                    loc=(0, blade_y0 + ty, 0), material=m_glow_lime)
        parts.append(tick)

    ob = S.join(parts, name)
    S.shade_auto(ob)

    tip_y = blade_y0 + blade_len
    muzzle = _empty("muzzle", (0, tip_y, 0))
    return [ob, muzzle]


# ------------------------------------------------------------------- Lobber
def lobber(name):
    S.reset()
    m_body = S.m_body()
    m_steel = S.m_steel()
    m_dark = S.m_dark()
    m_accent = S.m_accent("yellow")
    m_glow = S.m_glow("yellow", 6)
    m_glow_ring = S.m_glow("yellow", 8)

    parts = []

    up_tilt = math.radians(8)  # angled slightly up

    # stubby wide barrel, angled up
    barrel_len = 0.34
    barrel = S.cyl("barrel", r=0.055, depth=barrel_len, verts=14,
                  loc=(0, 0.30, 0.10), rot=(math.pi / 2 - up_tilt, 0, 0),
                  material=m_dark)
    S.bevel(barrel, width=0.006, segments=2)
    parts.append(barrel)

    # muzzle ring, emissive yellow, at barrel tip
    muzzle_y = 0.30 + math.cos(up_tilt) * (barrel_len / 2 + 0.015)
    muzzle_z = 0.10 + math.sin(up_tilt) * (barrel_len / 2 + 0.015)
    ring_front = S.torus("muzzle_ring", r_major=0.058, r_minor=0.012,
                        loc=(0, muzzle_y, muzzle_z),
                        rot=(math.pi / 2 - up_tilt, 0, 0),
                        seg_major=14, seg_minor=6, material=m_glow_ring)
    parts.append(ring_front)

    # revolving 5-chamber cylinder drum, mid-body
    drum_y = 0.10
    drum = S.cyl("drum", r=0.085, depth=0.14, verts=16,
                loc=(0, drum_y, 0.05), rot=(math.pi / 2, 0, 0),
                material=m_body)
    S.bevel(drum, width=0.006, segments=2)
    parts.append(drum)

    # yellow accent drum plates (front + back cap rings)
    cap_f = S.cyl("drumcap_f", r=0.086, depth=0.02, verts=16,
                 loc=(0, drum_y + 0.08, 0.05), rot=(math.pi / 2, 0, 0),
                 material=m_accent)
    cap_b = S.cyl("drumcap_b", r=0.086, depth=0.02, verts=16,
                 loc=(0, drum_y - 0.08, 0.05), rot=(math.pi / 2, 0, 0),
                 material=m_accent)
    parts += [cap_f, cap_b]

    # 5 visible chambers as small cylinders in a ring on the drum face
    for i in range(5):
        a = i * 2 * math.pi / 5
        cx = 0.05 * math.cos(a)
        cz = 0.05 + 0.05 * math.sin(a)
        chamber = S.cyl("chamber%d" % i, r=0.022, depth=0.145, verts=10,
                        loc=(cx, drum_y, cz), rot=(math.pi / 2, 0, 0),
                        material=m_dark)
        parts.append(chamber)
        dot = S.cyl("chamberdot%d" % i, r=0.016, depth=0.01, verts=10,
                   loc=(cx, drum_y + 0.075, cz), rot=(math.pi / 2, 0, 0),
                   material=m_glow)
        parts.append(dot)

    # thick stock (rear)
    stock = S.box("stock", (0.075, 0.30, 0.11), loc=(0, -0.22, 0.0),
                 material=m_body)
    S.bevel(stock, width=0.01, segments=2)
    parts.append(stock)

    # steel butt plate at the rear of the stock
    butt = S.box("buttplate", (0.08, 0.02, 0.12), loc=(0, -0.375, 0.0),
                material=m_steel)
    parts.append(butt)

    # front grip (vertical, under the drum)
    grip = S.box("frontgrip", (0.032, 0.05, 0.14), loc=(0, 0.10, -0.09),
                material=m_dark)
    S.bevel(grip, width=0.006, segments=2)
    parts.append(grip)

    # rear grip (angled down from receiver, houses origin at (0,0,0))
    rear_grip = S.box("reargrip", (0.034, 0.055, 0.15),
                      loc=(0, -0.02, -0.09), rot=(math.radians(12), 0, 0),
                      material=m_dark)
    S.bevel(rear_grip, width=0.006, segments=2)
    parts.append(rear_grip)

    # trigger guard (small ring under receiver)
    tguard = S.torus("tguard", r_major=0.035, r_minor=0.007,
                     loc=(0, -0.01, -0.03), rot=(math.pi / 2, 0, 0),
                     seg_major=12, seg_minor=6, material=m_steel)
    parts.append(tguard)

    # receiver body tying stock/drum/grips together
    receiver = S.box("receiver", (0.07, 0.22, 0.10), loc=(0, -0.02, 0.02),
                     material=m_body)
    S.bevel(receiver, width=0.008, segments=2)
    parts.append(receiver)

    ob = S.join(parts, name)
    S.shade_auto(ob)

    muzzle = _empty("muzzle", (0, muzzle_y, muzzle_z))
    return [ob, muzzle]


BUILDS = [
    ("wpn_6_nova_cannon", lambda: nova_cannon("wpn_6_nova_cannon"), 6000),
    ("wpn_7_circuit_blade", lambda: circuit_blade("wpn_7_circuit_blade"), 5000),
    ("wpn_8_lobber", lambda: lobber("wpn_8_lobber"), 6000),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("weapons", name + ".glb"), budget) and ok

print("GEN_DONE weapons_c ok=%s" % ok)
sys.exit(0 if ok else 1)
