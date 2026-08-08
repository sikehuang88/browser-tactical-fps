"""Environment props: industrial theme (Foundry / Hangar Nine / Ferrovault kit).

All props: origin at base center (sit on floor, z=0). Budget 1500 tris each.
Palette discipline: gunmetal/steel/plate bodies, orange accents, cyan/white
emissive only where the manifest calls for it (crate_l status light, pillar
strip, vent_fan trim, light_strip face).
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style as S


def crate_s(name):
    S.reset()
    size = 0.8
    # gunmetal body is the dominant read; plate panels are inset accents
    body = S.box("body", (size, size, size), loc=(0, 0, size / 2),
                 material=S.m_body())
    S.bevel(body, width=0.02, segments=2)
    # plate panel insets on two visible faces (front/side), slightly proud
    panels = []
    pw = size * 0.7
    inset_d = 0.015
    for axis, sign in (("x", 1), ("y", 1)):
        if axis == "x":
            loc = (size / 2 - inset_d, 0, size / 2)
            dims = (0.01, pw, pw)
        else:
            loc = (0, size / 2 - inset_d, size / 2)
            dims = (pw, 0.01, pw)
        p = S.box(f"panel_{axis}", dims, loc=loc, material=S.m_plate())
        panels.append(p)
    # gunmetal frame edges: thin raised bands on the 4 vertical edges
    frames = []
    fh = size - 0.06
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        f = S.box(f"frame{sx}{sy}", (0.06, 0.06, fh),
                  loc=(sx * size / 2, sy * size / 2, size / 2),
                  material=S.m_steel())
        frames.append(f)
    # panel seam band (horizontal), steel
    band = S.box("band", (size + 0.01, size + 0.01, 0.05),
                 loc=(0, 0, size / 2), material=S.m_steel())
    # small orange hazard corner marks: proud diagonal chips, clearly separated
    marks = []
    m_ext = 0.16
    for sx, sy in ((1, 1), (-1, -1)):
        mk = S.box(f"mark{sx}{sy}", (m_ext, m_ext, 0.025),
                   loc=(sx * (size / 2 - m_ext / 2 - 0.02),
                        sy * (size / 2 - m_ext / 2 - 0.02), size + 0.003),
                   rot=(0, 0, math.pi / 4), material=S.m_accent("orange"))
        marks.append(mk)
    ob = S.join([body, band] + frames + panels + marks, name)
    S.shade_auto(ob)
    return [ob]


def crate_l(name):
    S.reset()
    size = 1.6
    body = S.box("body", (size, size, size), loc=(0, 0, size / 2),
                 material=S.m_body())
    S.bevel(body, width=0.03, segments=2)
    # recessed side panels: inset plate slabs on the 4 vertical faces
    panels = []
    pw = size * 0.62
    ph = size * 0.62
    depth = 0.05
    for axis, sign in (("x", 1), ("x", -1), ("y", 1), ("y", -1)):
        if axis == "x":
            loc = (sign * (size / 2 - depth), 0, size / 2)
            dims = (0.02, pw, ph)
        else:
            loc = (0, sign * (size / 2 - depth), size / 2)
            dims = (pw, 0.02, ph)
        p = S.box(f"panel_{axis}{sign}", dims, loc=loc, material=S.m_plate())
        panels.append(p)
    # orange accent band around the middle
    band = S.box("band", (size + 0.02, size + 0.02, 0.18),
                 loc=(0, 0, size * 0.52), material=S.m_accent("orange"))
    # tiny cyan emissive status light on one face
    light = S.cyl("status", r=0.05, depth=0.03, verts=10,
                  loc=(size / 2 - 0.02, size * 0.3, size * 0.78),
                  rot=(0, math.pi / 2, 0), material=S.m_glow("cyan", 3))
    ob = S.join([body, band, light] + panels, name)
    S.shade_auto(ob)
    return [ob]


def barrel(name):
    S.reset()
    r = 0.32
    h = 0.9
    body = S.cyl("body", r=r, depth=h, loc=(0, 0, h / 2), verts=14,
                 material=S.m_dark())
    S.bevel(body, width=0.015, segments=2)
    ribs = []
    for i, frac in enumerate((0.22, 0.5, 0.78)):
        rib = S.cyl(f"rib{i}", r=r + 0.02, depth=0.06, loc=(0, 0, h * frac),
                    verts=14, material=S.m_steel())
        ribs.append(rib)
    # yellow hazard top ring near the lid
    top_ring = S.cyl("top_ring", r=r + 0.01, depth=0.08, loc=(0, 0, h - 0.06),
                     verts=14, material=S.m_accent("yellow"))
    lid = S.cyl("lid", r=r - 0.01, depth=0.03, loc=(0, 0, h + 0.015), verts=14,
               material=S.m_steel())
    ob = S.join([body, top_ring, lid] + ribs, name)
    S.shade_auto(ob)
    return [ob]


def rail_seg(name):
    S.reset()
    length = 2.0
    post_h = 0.9
    post_r = 0.035
    posts = []
    for i, x in enumerate((-length / 2 + 0.06, length / 2 - 0.06)):
        p = S.cyl(f"post{i}", r=post_r, depth=post_h, loc=(x, 0, post_h / 2),
                  verts=8, material=S.m_steel())
        posts.append(p)
    bars = []
    for i, z in enumerate((post_h * 0.55, post_h - 0.05)):
        b = S.cyl(f"bar{i}", r=0.025, depth=length - 0.02, loc=(0, 0, z),
                  rot=(0, math.pi / 2, 0), verts=8, material=S.m_steel())
        bars.append(b)
    kick = S.box("kick", (length - 0.05, 0.05, 0.12), loc=(0, 0, 0.06),
                material=S.m_body())
    # orange ends: small accent caps on each post top
    ends = []
    for i, x in enumerate((-length / 2 + 0.06, length / 2 - 0.06)):
        e = S.cyl(f"end{i}", r=post_r + 0.008, depth=0.05,
                  loc=(x, 0, post_h - 0.025), verts=8,
                  material=S.m_accent("orange"))
        ends.append(e)
    ob = S.join([kick] + posts + bars + ends, name)
    S.shade_auto(ob)
    return [ob]


def pillar(name):
    S.reset()
    w = 0.6
    h = 4.0
    base_h = 0.15
    cap_h = 0.15
    base = S.box("base", (w + 0.1, w + 0.1, base_h), loc=(0, 0, base_h / 2),
                material=S.m_steel())
    S.bevel(base, width=0.02, segments=2)
    shaft = S.box("shaft", (w, w, h - base_h - cap_h),
                 loc=(0, 0, base_h + (h - base_h - cap_h) / 2),
                 material=S.m_body())
    S.bevel(shaft, width=0.035, segments=2)  # chamfered corners
    cap = S.box("cap", (w + 0.1, w + 0.1, cap_h), loc=(0, 0, h - cap_h / 2),
               material=S.m_steel())
    S.bevel(cap, width=0.02, segments=2)
    # thin cyan emissive strip on two adjacent faces, full height of shaft
    strips = []
    strip_h = h - base_h - cap_h - 0.1
    for sx, sy in ((1, 0), (0, 1)):
        loc = (sx * (w / 2 + 0.001), sy * (w / 2 + 0.001),
               base_h + strip_h / 2 + 0.05)
        dims = (0.03, 0.06, strip_h) if sx else (0.06, 0.03, strip_h)
        st = S.box(f"strip{sx}{sy}", dims, loc=loc, material=S.m_glow("cyan", 3))
        strips.append(st)
    ob = S.join([base, shaft, cap] + strips, name)
    S.shade_auto(ob)
    return [ob]


def vent_fan(name):
    S.reset()
    r = 0.6
    depth = 0.1
    ring = S.cyl("ring", r=r, depth=depth, loc=(0, 0, 0), rot=(math.pi / 2, 0, 0),
                verts=20, material=S.m_dark())
    S.bevel(ring, width=0.015, segments=2)
    # recessed housing well (steel) sits behind the ring, gives depth for blades
    well = S.cyl("well", r=r - 0.05, depth=0.04, loc=(0, -0.05, 0),
                rot=(math.pi / 2, 0, 0), verts=20, material=S.m_steel())
    hub = S.cyl("hub", r=0.09, depth=0.22, loc=(0, 0.02, 0),
               rot=(math.pi / 2, 0, 0), verts=10, material=S.m_steel())
    # 5 static fan blades: flat paddles pitched ~35deg around the hub so they
    # read clearly face-on instead of edge-on to the viewer
    blades = []
    blade_len = r - 0.14
    for i in range(5):
        a = i * 2 * math.pi / 5
        bx = math.cos(a) * (blade_len * 0.5 + 0.09)
        bz = math.sin(a) * (blade_len * 0.5 + 0.09)
        bl = S.box(f"blade{i}", (0.22, 0.02, blade_len),
                   loc=(bx, -0.01, bz),
                   rot=(math.radians(35), 0, a), material=S.m_body())
        blades.append(bl)
    ob = S.join([ring, well, hub] + blades, name)
    S.shade_auto(ob)
    return [ob]


def light_strip(name):
    S.reset()
    length = 1.5
    housing = S.box("housing", (length, 0.14, 0.08), loc=(0, 0, 0.04),
                    material=S.m_dark())
    S.bevel(housing, width=0.015, segments=2)
    # emissive face proud on the -Y front face (visible to the studio camera)
    # instead of buried on the underside, so the glow actually reads.
    face = S.box("face", (length - 0.06, 0.02, 0.05), loc=(0, -0.075, 0.04),
                material=S.m_glow("white", 6))
    end_caps = []
    for i, x in enumerate((-length / 2 + 0.02, length / 2 - 0.02)):
        c = S.box(f"cap{i}", (0.04, 0.16, 0.1), loc=(x, 0, 0.04),
                  material=S.m_steel())
        end_caps.append(c)
    ob = S.join([housing, face] + end_caps, name)
    S.shade_auto(ob)
    return [ob]


def cable_drum(name):
    S.reset()
    r = 0.55
    width = 0.62
    core_r = r * 0.62
    flange_t = 0.05
    flanges = []
    for i, x in enumerate((-width / 2 + flange_t / 2, width / 2 - flange_t / 2)):
        f = S.cyl(f"flange{i}", r=r, depth=flange_t, loc=(x, 0, r),
                  rot=(0, math.pi / 2, 0), verts=20, material=S.m_steel())
        S.bevel(f, width=0.01, segments=2)
        flanges.append(f)
    core = S.cyl("core", r=core_r, depth=width - flange_t * 2, loc=(0, 0, r),
                rot=(0, math.pi / 2, 0), verts=16, material=S.m_dark())
    # wound-cable ribs on the core: raised, alternating radius for a clear
    # "wound cable" silhouette instead of shallow barely-visible rings
    ribs = []
    n_ribs = 6
    for i in range(n_ribs):
        x = -width / 2 + flange_t + (width - flange_t * 2) * (i + 0.5) / n_ribs
        rr = core_r + (0.035 if i % 2 == 0 else 0.02)
        rb = S.cyl(f"cablerib{i}", r=rr, depth=0.045, loc=(x, 0, r),
                  rot=(0, math.pi / 2, 0), verts=16, material=S.m_body())
        ribs.append(rb)
    # orange accent: hub axle cap, proud enough on the flange face to read
    accent = S.cyl("accent", r=0.09, depth=0.03,
                   loc=(-width / 2 - 0.014, 0, r), rot=(0, math.pi / 2, 0),
                   verts=12, material=S.m_accent("orange"))
    ob = S.join([core, accent] + flanges + ribs, name)
    S.shade_auto(ob)
    return [ob]


BUILDS = [
    ("crate_s",     lambda: crate_s("crate_s"),         1500),
    ("crate_l",     lambda: crate_l("crate_l"),         1500),
    ("barrel",      lambda: barrel("barrel"),           1500),
    ("rail_seg",    lambda: rail_seg("rail_seg"),       1500),
    ("pillar",      lambda: pillar("pillar"),           1500),
    ("vent_fan",    lambda: vent_fan("vent_fan"),       1500),
    ("light_strip", lambda: light_strip("light_strip"), 1500),
    ("cable_drum",  lambda: cable_drum("cable_drum"),   1500),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("env", "industrial", name + ".glb"),
                  budget) and ok

print("GEN_DONE env_industrial ok=%s" % ok)
sys.exit(0 if ok else 1)
