"""Pickups: health / armor / ammo (small, large, uber) + jump pad.

Floating pickups: origin at spin center; the game spins them around Z.
Jump pad: origin at base center (sits on floor).
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style as S


def health(name, scale, uber=False):
    S.reset()
    core = S.box("core", (0.34 * scale, 0.34 * scale, 0.34 * scale),
                 material=S.m_plate())
    S.bevel(core, width=0.05 * scale, segments=3)
    parts = [core]
    # red emissive cross on all four side faces (two flat bars through the cube)
    t = 0.09 * scale     # bar thickness
    d = 0.36 * scale     # protrudes slightly past the cube faces
    for axis in ("x", "y"):
        sz_v = (t, t, 0.26 * scale) if axis == "x" else (t, t, 0.26 * scale)
        sz_h = (0.26 * scale, t, t) if axis == "y" else (t, 0.26 * scale, t)
        if axis == "x":
            v = S.box("crossv_x", (d, t, 0.26 * scale), material=S.m_glow("red"))
            h = S.box("crossh_x", (d, 0.26 * scale, t), material=S.m_glow("red"))
        else:
            v = S.box("crossv_y", (t, d, 0.26 * scale), material=S.m_glow("red"))
            h = S.box("crossh_y", (0.26 * scale, d, t), material=S.m_glow("red"))
        parts += [v, h]
    if uber:
        ring = S.torus("ring", r_major=0.34 * scale, r_minor=0.03 * scale,
                       material=S.m_glow("red", 8))
        parts.append(ring)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def armor(name, scale, uber=False):
    S.reset()
    # faceted shield: hexagonal plate with raised center boss, gold + cyan trim
    plate = S.prism("plate", sides=6, r=0.26 * scale, depth=0.10 * scale,
                    rot=(math.pi / 2, 0, 0), material=S.mat("pb_gold", "gold", 0.35, 0.8))
    S.bevel(plate, width=0.02 * scale, segments=2)
    boss = S.prism("boss", sides=6, r=0.14 * scale, depth=0.08 * scale,
                   rot=(math.pi / 2, 0, 0), loc=(0, -0.07 * scale, 0),
                   material=S.m_steel())
    trim = S.torus("trim", r_major=0.245 * scale, r_minor=0.025 * scale,
                   rot=(math.pi / 2, 0, 0), seg_major=20, seg_minor=6,
                   material=S.m_glow("cyan"))
    parts = [plate, boss, trim]
    if uber:
        ring = S.torus("ring", r_major=0.4 * scale, r_minor=0.03 * scale,
                       seg_major=24, seg_minor=6, material=S.m_glow("cyan", 5))
        parts.append(ring)
    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob]


def ammo(name, scale):
    S.reset()
    crate = S.box("crate", (0.3 * scale, 0.42 * scale, 0.3 * scale),
                  material=S.m_body())
    S.bevel(crate, width=0.03 * scale, segments=2)
    band = S.box("band", (0.32 * scale, 0.1 * scale, 0.32 * scale),
                 material=S.m_glow("orange"))
    lid = S.box("lid", (0.26 * scale, 0.38 * scale, 0.06 * scale),
                loc=(0, 0, 0.17 * scale), material=S.m_steel())
    tips = []
    for i, x in enumerate((-0.07, 0, 0.07)):
        tip = S.cyl(f"tip{i}", r=0.028 * scale, depth=0.1 * scale, verts=8,
                    loc=(x * scale, 0, 0.24 * scale),
                    material=S.m_accent("yellow"))
        cone = S.cyl(f"cone{i}", r=0.028 * scale, r2=0.001, depth=0.05 * scale,
                     verts=8, loc=(x * scale, 0, 0.315 * scale),
                     material=S.m_accent("orange"))
        tips += [tip, cone]
    ob = S.join([crate, band, lid] + tips, name)
    S.shade_auto(ob)
    return [ob]


def jump_pad(name):
    S.reset()
    base = S.cyl("base", r=0.7, depth=0.12, loc=(0, 0, 0.06), verts=24,
                 material=S.m_dark())
    S.bevel(base, width=0.03, segments=2)
    rim = S.torus("rim", r_major=0.62, r_minor=0.045, loc=(0, 0, 0.12),
                  material=S.m_glow("lime", 7))
    disk = S.cyl("disk", r=0.5, depth=0.06, loc=(0, 0, 0.14), verts=24,
                 material=S.m_steel())
    # three chevron fins pointing up
    fins = []
    for i in range(3):
        a = i * 2 * math.pi / 3
        fin = S.box(f"fin{i}", (0.16, 0.05, 0.1),
                    loc=(0.3 * math.cos(a), 0.3 * math.sin(a), 0.2),
                    rot=(0, 0, a), material=S.m_glow("lime"))
        fins.append(fin)
    ob = S.join([base, rim, disk] + fins, name)
    S.shade_auto(ob)
    return [ob]


BUILDS = [
    ("pickup_health_small", lambda: health("pickup_health_small", 1.0), 1500),
    ("pickup_health_large", lambda: health("pickup_health_large", 1.35), 1500),
    ("pickup_health_uber",  lambda: health("pickup_health_uber", 1.7, uber=True), 2500),
    ("pickup_armor_small",  lambda: armor("pickup_armor_small", 1.0), 1500),
    ("pickup_armor_large",  lambda: armor("pickup_armor_large", 1.35), 1500),
    ("pickup_armor_uber",   lambda: armor("pickup_armor_uber", 1.7, uber=True), 2500),
    ("pickup_ammo_small",   lambda: ammo("pickup_ammo_small", 1.0), 2000),
    ("pickup_ammo_large",   lambda: ammo("pickup_ammo_large", 1.4), 2000),
    ("jump_pad",            lambda: jump_pad("jump_pad"), 3000),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("pickups", name + ".glb"), budget) and ok

print("GEN_DONE pickups ok=%s" % ok)
sys.exit(0 if ok else 1)
