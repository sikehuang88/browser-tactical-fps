"""Characters: 3 static low-poly humanoids sharing ONE heroic rig, re-themed.

Convention (see style.py): 1 unit = 1 m, feet on the floor at z=0, FACING +Y,
up is +Z. Height ~1.8 m. No armature — static mesh, joined to one object.

Shared rig proportions (heroic chunky, per armor_gear-spec.md):
  * total height ~1.8 m; head ~1/6.5 of height (~0.28 m tall).
  * legs ~50% of height (hip pivot at z~0.90); broad shoulders ~0.55 m across.
  * tapered waist; chunky forearms/gloves and boots (hands/feet oversized ~1.3x).
  * slight A-pose: arms angled ~20 deg out from the torso so the silhouette reads.

Per-character theming re-skins the SAME construction:
  * two base tones + one theme accent + one emissive + the shared "pb_team" mat.
  * "pb_team" (S.mat("pb_team","team_red",0.45)) is applied to the chest core
    plate, the helmet crest/stripe and the shin accent plates on EVERY character
    (the game re-tints it red/blue at runtime).
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style as S
import bpy

# ------------------------------------------------------------ rig metrics ---
# All z values are heights above the floor (feet at z=0).
H          = 1.8            # total height target
HIP_Z      = 0.92           # pelvis pivot -> legs ~51% of height
WAIST_Z    = 1.06
CHEST_Z    = 1.30
SHOULDER_Z = 1.42
NECK_Z     = 1.52
HEAD_Z     = 1.66           # head centre (~0.28 m head reads as ~1/6.5)
SHOULDER_X = 0.235          # half shoulder span -> ~0.55 m across at the pads
HIP_X      = 0.11           # half hip span
ARM_TILT   = math.radians(20)   # A-pose splay (arms angled out from torso)


def _team():
    """The runtime-tinted material. Name MUST be exactly 'pb_team'."""
    return S.mat("pb_team", "team_red", 0.45)


def _mirror(ob, name):
    """Duplicate ob reflected across the X=0 plane (build one side, mirror it).

    Reflection = negate location.x and negate the Y/Z euler components (a box
    rotated +ang about Y becomes -ang on the other side). Scale is kept positive
    (no negative-scale winding flip), so joins/exports stay clean. Any per-object
    non-uniform scale on X is also negated so scaled primitives mirror too.
    """
    dup = ob.copy()
    dup.data = ob.data.copy()
    dup.name = name
    bpy.context.collection.objects.link(dup)
    dup.location = (-ob.location.x, ob.location.y, ob.location.z)
    rx, ry, rz = ob.rotation_euler
    dup.rotation_euler = (rx, -ry, -rz)
    dup.scale = ob.scale
    return dup


# --------------------------------------------------------- shared builder ---

def build_character(name, theme_factory):
    """Build the shared humanoid rig, skinned with the theme dict returned by
    `theme_factory` (called AFTER reset so its materials survive the wipe).

    theme keys:
      base   : primary shell material (plate/dark/gunmetal ...)
      under  : darker underlayer material
      metal  : steel/gunmetal accents
      accent : theme accent material
      glow   : emissive material (visor / core / circuits)
      helmet : "scout" | "heavy" | "hex"  -> distinct helmet silhouette
      bulk   : shoulder/chest bulk multiplier (ashfang > 1)
    """
    S.reset()
    theme  = theme_factory()
    base   = theme["base"]
    under  = theme["under"]
    metal  = theme["metal"]
    accent = theme["accent"]
    glow   = theme["glow"]
    team   = _team()
    bulk   = theme.get("bulk", 1.0)
    parts  = []

    # ---------------------------------------------------------- pelvis / belt
    pelvis = S.box("pelvis", (0.30, 0.20, 0.20), loc=(0, 0, HIP_Z),
                   material=under)
    S.bevel(pelvis, width=0.02, segments=2)
    parts.append(pelvis)
    belt = S.box("belt", (0.34, 0.235, 0.08), loc=(0, 0, HIP_Z + 0.02),
                 material=base)
    S.bevel(belt, width=0.015, segments=2)
    parts.append(belt)
    buckle = S.box("buckle", (0.09, 0.02, 0.07), loc=(0, 0.125, HIP_Z + 0.02),
                   material=accent)
    parts.append(buckle)

    # ------------------------------------------------------- inner torso (dark)
    # slightly tapered: wide chest, narrow waist. Cone (r bottom < r top gives
    # a V-torso). Built as a beveled box stack for a clean plate read.
    lower_torso = S.box("lower_torso", (0.26, 0.17, 0.16),
                        loc=(0, 0, WAIST_Z), material=under)
    S.bevel(lower_torso, width=0.02, segments=2)
    parts.append(lower_torso)
    inner_chest = S.box("inner_chest", (0.40 * bulk, 0.22, 0.30),
                        loc=(0, 0, CHEST_Z), material=under)
    S.bevel(inner_chest, width=0.025, segments=2)
    parts.append(inner_chest)

    # -------------------------------------------------- outer chest plate (base)
    chest_plate = S.box("chest_plate", (0.42 * bulk, 0.14, 0.32),
                        loc=(0, 0.075, CHEST_Z + 0.01), material=base)
    S.bevel(chest_plate, width=0.03, segments=3)
    parts.append(chest_plate)
    # pectoral split ridge for definition
    for sx in (-1, 1):
        pec = S.box("pec%d" % sx, (0.16 * bulk, 0.05, 0.16),
                    loc=(sx * 0.11 * bulk, 0.14, CHEST_Z + 0.05),
                    material=base)
        S.bevel(pec, width=0.02, segments=2)
        parts.append(pec)
    # collar ring
    collar = S.cyl("collar", r=0.11, depth=0.06, loc=(0, 0.02, SHOULDER_Z),
                   verts=12, material=metal)
    S.bevel(collar, width=0.01, segments=1)
    parts.append(collar)

    # -------------------------------------------- TEAM chest core (pb_team) + glow
    # single clear sternum unit: a raised team-tinted housing with one round
    # emissive core lens set into it (reads as ONE landmark, not stripes).
    core_plate = S.box("chest_core", (0.17, 0.06, 0.17),
                       loc=(0, 0.14, CHEST_Z + 0.03), material=team)
    S.bevel(core_plate, width=0.02, segments=2)
    parts.append(core_plate)
    core_ring = S.cyl("core_ring", r=0.075, depth=0.05, loc=(0, 0.16, CHEST_Z + 0.03),
                      rot=(math.pi / 2, 0, 0), verts=16, material=metal)
    S.bevel(core_ring, width=0.008, segments=1)
    parts.append(core_ring)
    core_glow = S.cyl("core_glow", r=0.05, depth=0.055, loc=(0, 0.175, CHEST_Z + 0.03),
                      rot=(math.pi / 2, 0, 0), verts=16, material=glow)
    parts.append(core_glow)

    # small backpack / power unit on the back (-Y)
    pack = S.box("backpack", (0.24, 0.10, 0.26), loc=(0, -0.13, CHEST_Z + 0.01),
                 material=metal)
    S.bevel(pack, width=0.02, segments=2)
    parts.append(pack)
    # short horizontal vent slats on the back (dim, do not read from the front)
    for i, dz in enumerate((-0.06, 0.0, 0.06)):
        vent = S.box("pack_vent%d" % i, (0.15, 0.02, 0.025),
                     loc=(0, -0.185, CHEST_Z + 0.01 + dz), material=glow)
        parts.append(vent)

    # ---------------------------------------------------------------- neck
    neck = S.cyl("neck", r=0.06, depth=0.10, loc=(0, 0.01, NECK_Z), verts=12,
                 material=under)
    parts.append(neck)

    # ---------------------------------------------------------------- helmet
    parts += _helmet(name, theme, team, glow, accent, metal, base)

    # -------------------------------------------------- shoulders + arms (mirror)
    parts += _arm_and_shoulder(theme, base, under, metal, accent, glow, bulk)

    # ------------------------------------------------------------- legs (mirror)
    parts += _leg(theme, base, under, metal, team, bulk)

    ob = S.join(parts, name)
    S.shade_auto(ob, angle=32)
    return [ob]


# --------------------------------------------------------------- helmet ------

def _helmet(name, theme, team, glow, accent, metal, base):
    kind = theme["helmet"]
    parts = []
    hz = HEAD_Z

    # Head layout is FRONT-facing (+Y). Every theme keeps the same rule so the
    # visor reads at a glance: shell/crown lives at back+top (-Y / +Z), the FACE
    # is a flat plane at the front, and the emissive VISOR protrudes past it.
    HEAD_FRONT = 0.13     # y of the face plane front surface

    if kind == "scout":
        # low crown cap (flattened) pulled BACK -> reads as a helmet, not a ball
        dome = S.sphere("helm", r=0.115, loc=(0, -0.05, hz + 0.05), seg=20,
                        rings=14, material=base)
        dome.scale = (1.15, 1.1, 0.85)
        bpy.context.view_layer.update()
        S.bevel(dome, width=0.008, segments=1)
        parts.append(dome)
        # full face slab (base) the visor wraps around, front surface at HEAD_FRONT
        face = S.box("faceplate", (0.19, 0.15, 0.215), loc=(0, HEAD_FRONT - 0.075, hz),
                     material=base)
        S.bevel(face, width=0.03, segments=2)
        parts.append(face)
        # chin / jaw guard (metal)
        jaw = S.box("jaw", (0.155, 0.13, 0.08), loc=(0, HEAD_FRONT - 0.075, hz - 0.115),
                    material=metal)
        S.bevel(jaw, width=0.02, segments=2)
        parts.append(jaw)
        # wide cyan visor band that WRAPS to the temples (reads from any angle)
        visor = S.box("visor", (0.205, 0.075, 0.08), loc=(0, HEAD_FRONT - 0.01, hz + 0.01),
                      material=glow)
        S.bevel(visor, width=0.02, segments=2)
        parts.append(visor)
        # brow lip above the visor
        brow = S.box("brow", (0.20, 0.07, 0.05), loc=(0, HEAD_FRONT - 0.04, hz + 0.075),
                     material=base)
        S.bevel(brow, width=0.014, segments=2)
        parts.append(brow)
        # TEAM crest fin along the crown centre (front-to-back)
        crest = S.box("crest", (0.04, 0.20, 0.06), loc=(0, -0.02, hz + 0.11),
                      material=team)
        S.bevel(crest, width=0.012, segments=2)
        parts.append(crest)
        # side comm pods
        for sx in (-1, 1):
            pod = S.cyl("pod%d" % sx, r=0.032, depth=0.05,
                        loc=(sx * 0.135, -0.02, hz - 0.01),
                        rot=(0, math.pi / 2, 0), verts=10, material=metal)
            parts.append(pod)

    elif kind == "heavy":
        # blocky armored helm; face plane forward, narrow ember slit protruding
        shell = S.box("helm", (0.25, 0.23, 0.25), loc=(0, HEAD_FRONT - 0.115, hz),
                      material=base)
        S.bevel(shell, width=0.035, segments=3)
        parts.append(shell)
        # heavy angled jaw block (metal)
        jaw = S.box("jaw", (0.20, 0.15, 0.10), loc=(0, HEAD_FRONT - 0.05, hz - 0.11),
                    material=metal)
        S.bevel(jaw, width=0.025, segments=2)
        parts.append(jaw)
        # forward-swept crest spike (TEAM) rising from the crown
        spike = S.cyl("crest", r=0.05, r2=0.006, depth=0.24,
                      loc=(0, -0.02, hz + 0.17), rot=(math.radians(-16), 0, 0),
                      verts=8, material=team)
        parts.append(spike)
        # heavy brow ridge (base) over the slit
        brow = S.box("brow", (0.24, 0.07, 0.06), loc=(0, HEAD_FRONT - 0.02, hz + 0.055),
                     material=base)
        S.bevel(brow, width=0.018, segments=2)
        parts.append(brow)
        # narrow ember slit visor, protruding, just under the brow
        slit = S.box("visor", (0.20, 0.045, 0.04), loc=(0, HEAD_FRONT + 0.01, hz + 0.015),
                     material=glow)
        S.bevel(slit, width=0.006, segments=1)
        parts.append(slit)
        # cheek vents (ember glow) either side of the jaw
        for sx in (-1, 1):
            cv = S.box("cheek%d" % sx, (0.028, 0.06, 0.07),
                       loc=(sx * 0.11, HEAD_FRONT - 0.04, hz - 0.05), material=glow)
            parts.append(cv)

    else:  # "hex" -- tech, hexagonal helmet (flat hex facing +Y)
        helm = S.prism("helm", sides=6, r=0.15, depth=0.24,
                       loc=(0, HEAD_FRONT - 0.10, hz), rot=(math.pi / 2, 0, 0),
                       material=base)
        S.bevel(helm, width=0.02, segments=2)
        parts.append(helm)
        # recessed hex face plate (metal)
        face = S.prism("faceplate", sides=6, r=0.115, depth=0.05,
                       loc=(0, HEAD_FRONT - 0.005, hz), rot=(math.pi / 2, 0, 0),
                       material=metal)
        S.bevel(face, width=0.012, segments=2)
        parts.append(face)
        # single-eye lime visor bar, protruding
        visor = S.box("visor", (0.155, 0.05, 0.05), loc=(0, HEAD_FRONT + 0.02, hz + 0.01),
                      material=glow)
        S.bevel(visor, width=0.01, segments=2)
        parts.append(visor)
        # TEAM crest ridge across the crown (front-to-back)
        crest = S.box("crest", (0.05, 0.22, 0.05), loc=(0, -0.02, hz + 0.125),
                      material=team)
        S.bevel(crest, width=0.012, segments=2)
        parts.append(crest)
        # circuit trace lines over the crown (accent glow)
        for i, off in enumerate((-0.055, 0.055)):
            trace = S.box("htrace%d" % i, (0.012, 0.18, 0.012),
                          loc=(off, -0.02, hz + 0.14), material=glow)
            parts.append(trace)

    return parts


# ----------------------------------------------------- shoulders + arm -------

def _seg_between(name, p_top, p_bot, w, d, material, sx):
    """A box spanning from p_top to p_bot (both (x,z)), rotated in the X-Z plane.
    Returns the placed box. y is 0. Length = distance; overlaps handled by caller.
    """
    tx, tz = p_top
    bx, bz = p_bot
    length = math.hypot(bx - tx, bz - tz)
    cx, cz = (tx + bx) * 0.5, (tz + bz) * 0.5
    # box length is along local Z; tilt angle from vertical (about Y)
    ang = math.atan2(bx - tx, -(bz - tz))   # 0 = straight down
    ob = S.box(name, (w, d, length), loc=(cx, 0.0, cz), rot=(0, ang, 0),
               material=material)
    return ob


def _arm_and_shoulder(theme, base, under, metal, accent, glow, bulk):
    parts = []
    sx = 1  # build right side (+X), then mirror
    shoulder_x = SHOULDER_X

    # Joint chain in the X-Z plane. Shoulder socket sits just below/outside the
    # collar; arm splays out ~18 deg so hands clear the hips (true A-pose).
    socket = (sx * shoulder_x, SHOULDER_Z - 0.04)
    splay  = math.sin(ARM_TILT)
    drop_u = math.cos(ARM_TILT)
    ua_len = 0.34
    fa_len = 0.32
    elbow  = (socket[0] + sx * splay * ua_len, socket[1] - drop_u * ua_len)
    # forearm continues at the same splay (straight-ish arm, chunkier)
    wrist  = (elbow[0] + sx * splay * fa_len, elbow[1] - drop_u * fa_len)

    # --- pauldron: rounded wedge sitting OVER the socket, overlapping torso ---
    # a beveled box scaled to a dome-ish cap; bigger on ashfang via bulk.
    pw = 0.18 * bulk
    pad = S.box("shoulder", (pw, 0.20 * bulk, 0.17 * bulk),
                loc=(sx * (shoulder_x - 0.01), 0.0, SHOULDER_Z + 0.02),
                material=base)
    S.bevel(pad, width=0.05 * bulk, segments=3)   # heavy bevel -> rounded pauldron
    parts.append(pad)
    parts.append(_mirror(pad, "shoulder_L"))
    # under-shoulder cap (fills the socket so the arm connects cleanly)
    cap = S.sphere("shoulder_cap", r=0.095 * bulk,
                   loc=(socket[0], 0.0, socket[1] + 0.02), seg=14, rings=10,
                   material=under)
    parts.append(cap)
    parts.append(_mirror(cap, "shoulder_cap_L"))
    # accent trim ridge along the outer edge of the pauldron
    trim = S.box("pad_trim", (0.03, 0.16 * bulk, 0.035),
                 loc=(sx * (shoulder_x + pw * 0.5), 0.0, SHOULDER_Z + 0.05),
                 material=accent)
    parts.append(trim)
    parts.append(_mirror(trim, "pad_trim_L"))

    # --- upper arm (under-layer), overlaps into the pauldron at the top ---
    upper = _seg_between("upper_arm", (socket[0], socket[1] + 0.06), elbow,
                         0.115, 0.12, under, sx)
    S.bevel(upper, width=0.02, segments=2)
    parts.append(upper)
    parts.append(_mirror(upper, "upper_arm_L"))
    # bicep armor band (base) over the upper third
    bic = _seg_between("bicep", (socket[0], socket[1] + 0.02),
                       (elbow[0] * 0.5 + socket[0] * 0.5,
                        elbow[1] * 0.5 + socket[1] * 0.5),
                       0.125, 0.13, base, sx)
    S.bevel(bic, width=0.02, segments=2)
    parts.append(bic)
    parts.append(_mirror(bic, "bicep_L"))

    # --- elbow joint cap ---
    ecap = S.sphere("elbow", r=0.075, loc=(elbow[0], 0.0, elbow[1]),
                    seg=12, rings=8, material=metal)
    parts.append(ecap)
    parts.append(_mirror(ecap, "elbow_L"))

    # --- forearm + glove (chunky), overlaps the elbow at the top ---
    forearm = _seg_between("forearm", (elbow[0], elbow[1] + 0.05),
                           (wrist[0], wrist[1] + 0.02),
                           0.15, 0.15, base, sx)
    S.bevel(forearm, width=0.025, segments=2)
    parts.append(forearm)
    parts.append(_mirror(forearm, "forearm_L"))
    # theme accent/glow stripe running down the forearm front
    fmid = ((elbow[0] + wrist[0]) * 0.5, (elbow[1] + wrist[1]) * 0.5)
    fang = math.atan2(wrist[0] - elbow[0], -(wrist[1] - elbow[1]))
    stripe = S.box("fa_stripe", (0.02, 0.16, fa_len * 0.66),
                   loc=(fmid[0] + sx * 0.02, 0.10, fmid[1]),
                   rot=(0, fang, 0),
                   material=theme.get("forearm_stripe", accent))
    parts.append(stripe)
    parts.append(_mirror(stripe, "fa_stripe_L"))

    # oversized glove/fist at the wrist (~1.3x). Slight forward (+Y) knuckle.
    glove = S.box("glove", (0.165, 0.19, 0.17),
                  loc=(wrist[0], 0.02, wrist[1] - 0.04), material=metal)
    S.bevel(glove, width=0.03, segments=2)
    parts.append(glove)
    parts.append(_mirror(glove, "glove_L"))
    # knuckle plate accent on the front of the fist
    knk = S.box("knuckle", (0.14, 0.05, 0.06),
                loc=(wrist[0], 0.11, wrist[1] - 0.02), material=accent)
    parts.append(knk)
    parts.append(_mirror(knk, "knuckle_L"))

    return parts


# ------------------------------------------------------------------ legs -----

def _leg(theme, base, under, metal, team, bulk):
    parts = []
    sx = 1  # build right leg (+X), mirror the left
    hip_x = HIP_X

    # hip / thigh joint cap
    cap = S.sphere("hip_cap", r=0.10, loc=(sx * hip_x, 0, HIP_Z - 0.06),
                   seg=14, rings=10, material=under)
    parts.append(cap)
    parts.append(_mirror(cap, "hip_cap_L"))

    # upper leg (thigh)
    ul_len = 0.42
    ul_cz = HIP_Z - 0.06 - ul_len * 0.5
    thigh = S.box("thigh", (0.15, 0.16, ul_len), loc=(sx * hip_x, 0, ul_cz),
                  material=under)
    S.bevel(thigh, width=0.02, segments=2)
    parts.append(thigh)
    parts.append(_mirror(thigh, "thigh_L"))
    # thigh armor plate (base) on the front
    tplate = S.box("thigh_plate", (0.15, 0.06, ul_len * 0.7),
                   loc=(sx * hip_x, 0.075, ul_cz), material=base)
    S.bevel(tplate, width=0.015, segments=2)
    parts.append(tplate)
    parts.append(_mirror(tplate, "thigh_plate_L"))

    # knee pad (disc/box over the joint)
    knee_z = HIP_Z - 0.06 - ul_len
    knee = S.box("knee", (0.15, 0.15, 0.11), loc=(sx * hip_x, 0.02, knee_z),
                 material=base)
    S.bevel(knee, width=0.02, segments=2)
    parts.append(knee)
    parts.append(_mirror(knee, "knee_L"))

    # shin + boot (chunky). shin plate carries the TEAM accent.
    sh_len = 0.40
    sh_cz = knee_z - sh_len * 0.5
    shin = S.box("shin", (0.155, 0.17, sh_len), loc=(sx * hip_x, 0, sh_cz),
                 material=under)
    S.bevel(shin, width=0.02, segments=2)
    parts.append(shin)
    parts.append(_mirror(shin, "shin_L"))
    # TEAM shin accent plate on the front of the shin
    shin_acc = S.box("shin_accent", (0.13, 0.05, sh_len * 0.6),
                     loc=(sx * hip_x, 0.09, sh_cz + 0.02), material=team)
    S.bevel(shin_acc, width=0.012, segments=2)
    parts.append(shin_acc)
    parts.append(_mirror(shin_acc, "shin_accent_L"))
    # metal ankle band
    ankle = S.box("ankle", (0.16, 0.16, 0.06), loc=(sx * hip_x, 0, 0.10),
                  material=metal)
    S.bevel(ankle, width=0.012, segments=2)
    parts.append(ankle)
    parts.append(_mirror(ankle, "ankle_L"))

    # oversized boot (~1.3x foot, extends +Y forward). Feet reach z=0.
    boot = S.box("boot", (0.18, 0.30, 0.10), loc=(sx * hip_x, 0.06, 0.05),
                 material=base)
    S.bevel(boot, width=0.025, segments=2)
    parts.append(boot)
    parts.append(_mirror(boot, "boot_L"))
    # rounded toe cap
    toe = S.box("toe", (0.17, 0.10, 0.075), loc=(sx * hip_x, 0.20, 0.037),
                material=metal)
    S.bevel(toe, width=0.02, segments=2)
    parts.append(toe)
    parts.append(_mirror(toe, "toe_L"))
    # heel block
    heel = S.box("heel", (0.16, 0.09, 0.09), loc=(sx * hip_x, -0.11, 0.045),
                 material=under)
    S.bevel(heel, width=0.02, segments=2)
    parts.append(heel)
    parts.append(_mirror(heel, "heel_L"))

    return parts


# --------------------------------------------------------------- themes ------

def theme_vanguard():
    return dict(
        base   = S.m_plate(),                       # white/plate shells
        under  = S.m_body(),                        # gunmetal underlayer
        metal  = S.m_steel(),
        accent = S.mat("pb_van_accent", "steel", 0.4, 0.5),
        glow   = S.m_glow("cyan", 3.0),
        helmet = "scout",
        bulk   = 1.0,
    )


def theme_ashfang():
    return dict(
        base   = S.m_dark(),                        # dark shell
        under  = S.mat("pb_ash_under", "gunmetal", 0.6),
        metal  = S.m_steel(),
        accent = S.mat("pb_ash_accent", "gunmetal", 0.5, 0.4),
        glow   = S.m_glow("orange", 4.0),           # ember
        helmet = "heavy",
        bulk   = 1.30,                              # bulkier shoulders/chest
    )


def theme_circuit():
    return dict(
        base           = S.m_body(),                # gunmetal
        under          = S.m_dark(),
        metal          = S.m_steel(),               # steel
        accent         = S.m_glow("lime", 3.0),     # circuit accents glow
        glow           = S.m_glow("lime", 3.5),
        forearm_stripe = S.m_glow("lime", 3.5),     # lime circuit lines on forearms
        helmet         = "hex",
        bulk           = 1.05,
    )


BUILDS = [
    ("char_vanguard", lambda: build_character("char_vanguard", theme_vanguard), 10000),
    ("char_ashfang",  lambda: build_character("char_ashfang",  theme_ashfang),  10000),
    ("char_circuit",  lambda: build_character("char_circuit",  theme_circuit),  10000),
]

ok = True
for name, build, budget in BUILDS:
    objs = build()
    ok = S.finish(name, objs, os.path.join("characters", name + ".glb"), budget) and ok

print("GEN_DONE characters ok=%s" % ok)
sys.exit(0 if ok else 1)
