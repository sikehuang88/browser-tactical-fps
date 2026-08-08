"""Weapons batch B: Longshot (sniper), Viper (sidearm), Ion Splatter (energy).

Weapon origin: grip/handle pivot at (0,0,0), barrel extends +Y, up is +Z.
Each build adds an EMPTY named "muzzle" at the barrel tip and includes it
in the objs list passed to S.finish so downstream tooling can attach FX.
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style as S


import bpy


def make_muzzle(loc):
    ob = bpy.data.objects.new("muzzle", None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.05
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    return ob


# --------------------------------------------------------------- Longshot --

def longshot(name):
    S.reset()
    m_body = S.m_body()          # dark gunmetal — dominant body tone
    m_steel = S.m_steel()        # lighter steel — small greebles only
    m_plate = S.m_plate()
    m_violet = S.m_accent("violet")
    m_glow_cyan = S.m_glow("cyan", 6.0)
    m_glow_thin = S.m_glow("cyan", 3.0)

    parts = []

    # Overall length ~1.25m along +Y. Grip pivot at origin.
    # Zones: barrel/muzzle forward (+Y) ~40%, receiver ~25%, stock rearward (-Y) ~35%.

    # Slim octagonal barrel (long, forward) — gunmetal, not pale steel
    barrel_len = 0.72
    barrel = S.prism("barrel", sides=8, r=0.020, depth=barrel_len,
                      rot=(math.pi / 2, 0, 0),
                      loc=(0, 0.18 + barrel_len / 2, 0.09), material=m_body)
    parts.append(barrel)

    barrel_end_y = 0.18 + barrel_len

    # Muzzle brake: wider octagonal collar with slit fins (steel highlight)
    brake = S.prism("brake", sides=8, r=0.030, depth=0.09,
                     rot=(math.pi / 2, 0, 0),
                     loc=(0, barrel_end_y + 0.045, 0.09), material=m_steel)
    S.bevel(brake, width=0.004, segments=2)
    parts.append(brake)
    for i in range(3):
        slit = S.box(f"brake_slit{i}", (0.05, 0.016, 0.01),
                      loc=(0, barrel_end_y + 0.018 + i * 0.026, 0.114),
                      material=m_dark_local())
        parts.append(slit)

    muzzle_y = barrel_end_y + 0.09

    # Receiver block (boxy, around origin) — dark gunmetal body
    receiver = S.box("receiver", (0.075, 0.26, 0.11),
                      loc=(0, 0.06, 0.09), material=m_body)
    S.bevel(receiver, width=0.006, segments=2)
    parts.append(receiver)

    # Bolt handle nub on the side (steel)
    bolt = S.cyl("bolt", r=0.014, depth=0.05, verts=8,
                 rot=(0, math.pi / 2, 0),
                 loc=(0.045, 0.02, 0.11), material=m_steel)
    parts.append(bolt)

    # Thin rail along the top of the receiver + a stretch toward the scope, with glow pinstripe
    rail = S.box("rail", (0.026, 0.30, 0.010),
                 loc=(0, 0.06, 0.15), material=m_steel)
    parts.append(rail)
    rail_glow = S.box("rail_glow", (0.006, 0.28, 0.006),
                       loc=(0, 0.06, 0.157), material=m_glow_thin)
    parts.append(rail_glow)

    # Large top scope: dark tube body + two lens rings, front lens emissive cyan
    scope_len = 0.30
    scope_body = S.cyl("scope_body", r=0.032, depth=scope_len, verts=16,
                        rot=(math.pi / 2, 0, 0),
                        loc=(0, 0.10, 0.22), material=m_dark_local())
    parts.append(scope_body)
    # scope mounts (two short risers connecting scope to rail)
    for i, ry in enumerate((-0.06, 0.16)):
        riser = S.box(f"scope_mount{i}", (0.022, 0.028, 0.03),
                      loc=(0, 0.10 + ry, 0.182), material=m_steel)
        parts.append(riser)
    # rear lens (ocular) - plain steel ring
    rear_lens = S.cyl("rear_lens", r=0.034, depth=0.012, verts=16,
                       rot=(math.pi / 2, 0, 0),
                       loc=(0, 0.10 - scope_len / 2 - 0.006, 0.22),
                       material=m_steel)
    parts.append(rear_lens)
    # front lens (objective) - emissive cyan, larger + brighter for read
    front_lens = S.cyl("front_lens", r=0.034, depth=0.016, verts=16,
                        rot=(math.pi / 2, 0, 0),
                        loc=(0, 0.10 + scope_len / 2 + 0.008, 0.22),
                        material=m_glow_cyan)
    parts.append(front_lens)

    # Violet accent stripe along the receiver side
    stripe = S.box("accent_stripe", (0.006, 0.24, 0.022),
                    loc=(0.041, 0.06, 0.06), material=m_violet)
    parts.append(stripe)

    # Trigger guard + grip (pivot at origin)
    grip = S.box("grip", (0.05, 0.045, 0.16),
                 loc=(0, -0.01, -0.02), rot=(math.radians(8), 0, 0),
                 material=m_dark_local())
    S.bevel(grip, width=0.006, segments=2)
    parts.append(grip)
    guard = S.box("trigger_guard", (0.05, 0.09, 0.02),
                  loc=(0, 0.03, -0.03), material=m_steel)
    parts.append(guard)

    # Cheek-rest stock extending rearward (-Y), with raised cheek riser + buttpad
    stock_len = 0.44
    stock = S.box("stock", (0.056, stock_len, 0.085),
                  loc=(0, -0.10 - stock_len / 2, 0.07), material=m_body)
    S.bevel(stock, width=0.008, segments=2)
    parts.append(stock)
    cheek = S.box("cheek_rest", (0.046, 0.18, 0.026),
                  loc=(0, -0.18, 0.125), material=m_plate)
    S.bevel(cheek, width=0.004, segments=2)
    parts.append(cheek)
    buttpad = S.box("buttpad", (0.062, 0.03, 0.10),
                    loc=(0, -0.10 - stock_len - 0.012, 0.07),
                    material=m_dark_local())
    parts.append(buttpad)

    # Bipod-style front fins, folded flat against the barrel underside
    for i, sx in enumerate((-1, 1)):
        fin = S.box(f"bipod_fin{i}", (0.012, 0.16, 0.05),
                    loc=(sx * 0.03, 0.30, 0.02),
                    rot=(0, 0, sx * math.radians(6)),
                    material=m_steel)
        S.bevel(fin, width=0.004, segments=1)
        parts.append(fin)

    muzzle = make_muzzle((0, muzzle_y, 0.09))

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob, muzzle]


# ------------------------------------------------------------------ Viper --

def m_dark_local():
    return S.mat("pb_dark", "dark", rough=0.7)


def viper(name):
    S.reset()
    m_body = S.mat("pb_viper_slide", "dark", rough=0.32, metallic=0.4)
    m_steel = S.m_steel()
    m_magenta = S.m_accent("magenta")
    m_glow_dot = S.m_glow("magenta", 5.0)

    parts = []

    # Stubby 2:1 silhouette, ~0.35m long overall, grip pivot at origin (0,0,0).
    # Frame bridges slide (top) to grip (below) so nothing floats disconnected.
    slide_len = 0.20
    slide_bottom_z = 0.01
    slide = S.box("slide", (0.045, slide_len, 0.05),
                  loc=(0, 0.07, slide_bottom_z + 0.025), material=m_body)
    S.bevel(slide, width=0.006, segments=2)
    parts.append(slide)

    # Beveled cuts on the slide: two angled notches (dark inset blocks)
    for i, sy in enumerate((0.01, 0.09)):
        cut = S.box(f"slide_cut{i}", (0.05, 0.022, 0.045),
                    loc=(0, sy, slide_bottom_z + 0.025), rot=(math.radians(18), 0, 0),
                    material=m_dark_local())
        parts.append(cut)

    # Frame/receiver: connects slide underside down to the grip top, fills the
    # gap so slide + grip read as one solid weapon (fixes floating-parts bug).
    frame_top_z = slide_bottom_z
    frame_bot_z = -0.02
    frame = S.box("frame", (0.04, 0.16, frame_top_z - frame_bot_z),
                  loc=(0, 0.0, (frame_top_z + frame_bot_z) / 2),
                  material=m_body)
    S.bevel(frame, width=0.004, segments=1)
    parts.append(frame)

    # Ported barrel shroud forward of the slide, with 3 side ports.
    # Matte dark like the slide (class rule: near-zero color variety on body);
    # a thin steel collar at the base is the only metal highlight here.
    shroud_len = 0.10
    shroud_z = slide_bottom_z + 0.025
    shroud = S.cyl("shroud", r=0.024, depth=shroud_len, verts=12,
                   rot=(math.pi / 2, 0, 0),
                   loc=(0, slide_len + shroud_len / 2 - 0.01, shroud_z),
                   material=m_dark_local())
    parts.append(shroud)
    shroud_collar = S.cyl("shroud_collar", r=0.026, depth=0.014, verts=12,
                          rot=(math.pi / 2, 0, 0),
                          loc=(0, slide_len + 0.005, shroud_z),
                          material=m_steel)
    parts.append(shroud_collar)
    shroud_end_y = slide_len + shroud_len - 0.01
    for i, sx in enumerate((-1, 0, 1)):
        # 3 side ports: dark inset cylinders (left, bottom, right) reading as holes
        ang = sx * math.pi / 2  # -90, 0, +90 deg around barrel axis
        if sx == 0:
            port_loc = (0, slide_len + shroud_len / 2 - 0.01, shroud_z + 0.024)
            port_rot = (math.pi / 2, 0, 0)
        else:
            port_loc = (0.024 * sx, slide_len + shroud_len / 2 - 0.01, shroud_z)
            port_rot = (0, math.pi / 2, 0)
        port = S.cyl(f"port{i}", r=0.009, depth=0.012, verts=8,
                     rot=port_rot, loc=port_loc, material=m_dark_local())
        parts.append(port)

    # Muzzle tip
    tip = S.cyl("tip", r=0.0235, depth=0.012, verts=12,
                rot=(math.pi / 2, 0, 0),
                loc=(0, shroud_end_y + 0.006, shroud_z), material=m_dark_local())
    parts.append(tip)
    muzzle_y = shroud_end_y + 0.012

    # Drop magazine below the grip
    mag_len = 0.10
    mag_top_z = -0.03
    mag = S.box("mag", (0.028, 0.032, mag_len),
                loc=(0, -0.005, mag_top_z - mag_len / 2), material=m_dark_local())
    S.bevel(mag, width=0.003, segments=1)
    parts.append(mag)
    mag_base = S.box("mag_base", (0.034, 0.038, 0.014),
                     loc=(0, -0.005, mag_top_z - mag_len - 0.005),
                     material=m_dark_local())
    parts.append(mag_base)

    # Skeletal grip: thin frame (front strap + back strap + two side rails)
    # attached directly under the frame block — no gap to the slide/frame above.
    # Rails stay dark (matte-dark class rule); steel is reserved for tiny greebles only.
    grip_h = 0.11
    grip_top_z = frame_bot_z
    grip_bot_z = grip_top_z - grip_h
    grip_mid_z = (grip_top_z + grip_bot_z) / 2
    front_strap = S.box("grip_front", (0.04, 0.014, grip_h),
                        loc=(0, 0.03, grip_mid_z),
                        rot=(math.radians(-10), 0, 0), material=m_dark_local())
    parts.append(front_strap)
    back_strap = S.box("grip_back", (0.04, 0.014, grip_h),
                       loc=(0, -0.03, grip_mid_z),
                       rot=(math.radians(-10), 0, 0), material=m_dark_local())
    parts.append(back_strap)
    for i, sx in enumerate((-1, 1)):
        rail = S.box(f"grip_rail{i}", (0.01, 0.05, grip_h - 0.015),
                     loc=(sx * 0.017, 0.0, grip_mid_z),
                     rot=(math.radians(-10), 0, 0), material=m_dark_local())
        parts.append(rail)
    trigger_guard = S.box("trigger_guard", (0.036, 0.06, 0.014),
                          loc=(0, 0.03, grip_top_z - 0.005), material=m_dark_local())
    parts.append(trigger_guard)

    # Magenta accent spine along the top of the slide
    spine = S.box("accent_spine", (0.01, slide_len - 0.02, 0.006),
                  loc=(0, 0.07, slide_bottom_z + 0.053), material=m_magenta)
    parts.append(spine)

    # Small magenta emissive dot sight on the rear of the slide
    dot_sight = S.cyl("dot_sight", r=0.008, depth=0.01, verts=10,
                       rot=(math.pi / 2, 0, 0),
                       loc=(0, -0.015, slide_bottom_z + 0.055), material=m_glow_dot)
    parts.append(dot_sight)

    muzzle = make_muzzle((0, muzzle_y, shroud_z))

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob, muzzle]


# ------------------------------------------------------------ Ion Splatter -

def ion_splatter(name):
    S.reset()
    m_steel = S.m_steel()
    m_dark = m_dark_local()
    m_body = S.m_body()          # dark gunmetal — dominant body tone
    m_glow_lime = S.m_glow("lime", 5.0)
    m_glow_ring = S.m_glow("lime", 3.0)

    parts = []

    # ~0.9m overall. Faceted receiver near origin, barrel + coil rings forward,
    # glass-like emissive lime canister mid-body (kept smaller than the gun's
    # own cross-section so it reads as a component, not the whole silhouette),
    # under-grip below.

    receiver = S.prism("receiver", sides=8, r=0.06, depth=0.28,
                        rot=(math.pi / 2, 0, 0),
                        loc=(0, 0.0, 0.065), material=m_body)
    S.bevel(receiver, width=0.006, segments=2)
    parts.append(receiver)

    # faceted top plate greeble (steel highlight, small)
    top_plate = S.prism("top_plate", sides=6, r=0.04, depth=0.04,
                         rot=(math.pi / 2, 0, 0),
                         loc=(0, 0.0, 0.115), material=m_steel)
    parts.append(top_plate)

    # Glass-like emissive lime canister mid-body: smaller cylinder-capsule
    # rather than an oversized sphere, so it stays a mid-body accent. Sits
    # just ahead of the receiver, leaving the rest of the barrel clear for
    # the coil rings so the two glow elements don't visually merge.
    canister_r = 0.05
    canister_len = 0.14
    canister_y = 0.185
    canister = S.cyl("canister", r=canister_r, depth=canister_len, verts=12,
                     rot=(math.pi / 2, 0, 0),
                     loc=(0, canister_y, 0.075), material=m_glow_lime)
    parts.append(canister)
    # rounded end caps read as a capsule/dome without sphere bulk (low-poly)
    cap_front = S.sphere("canister_cap_f", r=canister_r,
                        loc=(0, canister_y + canister_len / 2, 0.075),
                        seg=10, rings=6, material=m_glow_lime)
    parts.append(cap_front)
    cap_back = S.sphere("canister_cap_b", r=canister_r,
                       loc=(0, canister_y - canister_len / 2, 0.075),
                       seg=10, rings=6, material=m_glow_lime)
    parts.append(cap_back)
    # steel cradle bands holding the canister (front + back)
    for i, cy in enumerate((canister_y - canister_len / 2 + 0.02,
                            canister_y + canister_len / 2 - 0.02)):
        cradle = S.torus(f"canister_cradle{i}", r_major=canister_r + 0.008,
                         r_minor=0.012, loc=(0, cy, 0.075),
                         rot=(math.pi / 2, 0, 0),
                         seg_major=14, seg_minor=6, material=m_steel)
        parts.append(cradle)

    # Barrel: cylinder running from just past the canister to the muzzle
    barrel_len = 0.36
    barrel_start_y = canister_y + canister_len / 2 + 0.01
    barrel = S.cyl("barrel", r=0.026, depth=barrel_len, verts=14,
                   rot=(math.pi / 2, 0, 0),
                   loc=(0, barrel_start_y + barrel_len / 2, 0.075),
                   material=m_body)
    parts.append(barrel)
    barrel_end_y = barrel_start_y + barrel_len

    # Coil rings around the barrel (4 tori), evenly spaced, glowing — kept
    # forward of the canister so the two glow elements read as distinct parts.
    n_coils = 4
    for i in range(n_coils):
        t = (i + 0.5) / n_coils
        ring_y = barrel_start_y + t * barrel_len
        ring = S.torus(f"coil{i}", r_major=0.036, r_minor=0.009,
                       loc=(0, ring_y, 0.075), rot=(math.pi / 2, 0, 0),
                       seg_major=14, seg_minor=6, material=m_glow_ring)
        parts.append(ring)

    # Muzzle cap
    cap = S.cyl("muzzle_cap", r=0.03, depth=0.02, verts=14,
               rot=(math.pi / 2, 0, 0),
               loc=(0, barrel_end_y + 0.01, 0.075), material=m_dark)
    parts.append(cap)
    muzzle_y = barrel_end_y + 0.02

    # Under-grip below the receiver
    grip = S.box("grip", (0.045, 0.05, 0.15),
                 loc=(0, -0.04, -0.03), rot=(math.radians(10), 0, 0),
                 material=m_dark)
    S.bevel(grip, width=0.006, segments=2)
    parts.append(grip)
    guard = S.box("trigger_guard", (0.05, 0.09, 0.016),
                  loc=(0, 0.0, -0.045), material=m_steel)
    parts.append(guard)

    # Rear stub/stock cap (keeps the receiver from reading as truncated)
    rear_cap = S.prism("rear_cap", sides=8, r=0.05, depth=0.04,
                        rot=(math.pi / 2, 0, 0),
                        loc=(0, -0.16, 0.065), material=m_dark)
    parts.append(rear_cap)

    muzzle = make_muzzle((0, muzzle_y, 0.075))

    ob = S.join(parts, name)
    S.shade_auto(ob)
    return [ob, muzzle]


BUILDS = [
    ("wpn_3_longshot",     lambda: longshot("wpn_3_longshot"), 6000),
    ("wpn_4_viper",        lambda: viper("wpn_4_viper"), 4000),
    ("wpn_5_ion_splatter", lambda: ion_splatter("wpn_5_ion_splatter"), 6000),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("weapons", name + ".glb"), budget) and ok

print("GEN_DONE weapons_b ok=%s" % ok)
sys.exit(0 if ok else 1)
