"""Retro water ring-toss toy — procedural Blender live-wallpaper scene.

The handheld water game from the nineties: a sealed water-filled window, a
handful of little plastic rings, pegs to land them on, and a button on the
bezel that fires a jet of water and bubbles up through the chamber to throw
the rings around.

Built as a seamless phone-portrait loop for a live wallpaper. Nothing is
hand-placed: geometry, materials, the ring physics, the button presses and
the jet are all built from CLI flags, the same way `liquid_shaker.py` builds
its scene — and this file borrows that scene's geometry and material spine
directly rather than re-deriving it.

Run headless:

    blender -b -P blender/water_ring_toy.py -- --out renders/ringtoy

Or against the `bpy` pip module:

    python blender/water_ring_toy.py --out renders/ringtoy

See blender/WATER-RING-TOY.md for the flag reference and quality presets.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The shaker is the template. Its plan curve, pillow loft, fill-line boolean
# and render plumbing are the same problems solved the same way, so they are
# imported rather than copied — a fix in one is a fix in both.
from liquid_shaker import (  # noqa: E402
    activate,
    blend_seam,
    bubble_material,
    clear_scene,
    configure_render,
    cut_above,
    frame_paths,
    link,
    new_material,
    pillow,
    plan_curve,
    put,
    rgba,
)

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
#
# Every entry below is written in sRGB — the numbers you would read off a
# colour picker — and converted on the way into a socket by `lin()`. Feeding
# them in raw is the quiet way to lose a palette: a shader socket is linear,
# so a mid-saturation coral handed over as-is renders as pale pink and looks
# like a lighting fault rather than a colour-space one.


def lin(colour: tuple[float, float, float]) -> tuple[float, float, float]:
    """sRGB → linear, component-wise."""
    def channel(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(channel(c) for c in colour)


# Pool-blue water: lighter and greener at the surface where the light gets
# in, deeper and bluer down in the pool.
WATER_TOP = (0.212, 0.749, 0.882)
WATER_DEEP = (0.055, 0.408, 0.678)

# The backing plate behind the water. This — not the water — is where the
# blue in one of these toys actually comes from: the chamber holds maybe a
# centimetre of water, which tints almost nothing, and the field you see the
# rings against is a sheet of coloured plastic at the back.
PLATE_TOP = (0.396, 0.831, 0.898)
PLATE_DEEP = (0.114, 0.478, 0.722)

# The case. These toys were moulded in flat, saturated primaries — the coral
# reads warmest against the aqua and is the one most people picture.
CASE_COLOUR = (0.898, 0.286, 0.278)
BUTTON_COLOUR = (0.988, 0.827, 0.298)

# Ring plastic. Object Info → Random picks one per ring.
RING_HUES = [
    (0.98, 0.42, 0.62),   # candy pink
    (0.99, 0.83, 0.33),   # butter yellow
    (0.46, 0.93, 0.66),   # mint
    (0.99, 0.58, 0.26),   # tangerine
    (0.66, 0.62, 0.98),   # lilac
    (0.96, 0.98, 0.99),   # milky white
]

HOOK_COLOUR = (0.96, 0.96, 0.94)


# --------------------------------------------------------------------------
# flags
# --------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse our flags whether we are run through Blender or through `bpy`.

    Same convention as the shaker: `blender -b -P script.py -- --out x` puts
    our flags after a `--`, and a Python with `bpy` installed puts them
    straight on argv.
    """
    if argv is None:
        if "--" in sys.argv:
            argv = sys.argv[sys.argv.index("--") + 1:]
        elif os.path.basename(sys.argv[0]).startswith("blender"):
            argv = []
        else:
            argv = sys.argv[1:]

    p = argparse.ArgumentParser(prog="water_ring_toy", description=__doc__)

    case = p.add_argument_group("case")
    case.add_argument("--width", type=float, default=2.0,
                      help="case width in metres (X)")
    case.add_argument("--height", type=float, default=0.0,
                      help="case height in metres (Z); 0 derives it from the "
                           "render aspect so the case fills the frame")
    case.add_argument("--thickness", type=float, default=0.46,
                      help="case depth in metres (Y)")
    case.add_argument("--corner", type=float, default=0.16,
                      help="case corner radius as a fraction of the short "
                           "side")
    case.add_argument("--squircle-n", type=float, default=4.0,
                      help="corner superellipse exponent; 2=circle, "
                           "4=squircle, 8=near-square")
    case.add_argument("--profile-n", type=float, default=7.0,
                      help="edge profile exponent; higher = flatter faces "
                           "and a tighter rim")
    case.add_argument("--bezel", type=float, default=0.105,
                      help="opaque frame width as a fraction of case width. "
                           "It also sets how big the button can be, since "
                           "the button lives in the chin")
    case.add_argument("--segments", type=int, default=96,
                      help="mesh resolution around the plan curve")
    case.add_argument("--glass", type=float, default=0.022,
                      help="window glass thickness in metres")
    case.add_argument("--case-colour", default="",
                      help="case colour as r,g,b in 0-1; empty uses the "
                           "retro coral")

    water = p.add_argument_group("water")
    water.add_argument("--fill", type=float, default=0.95,
                       help="water level as a fraction of chamber height. "
                            "The air gap at the top is where the jet breaks "
                            "the surface, so 1.0 costs the splash")
    water.add_argument("--density", type=float, default=2.5,
                       help="water absorption density. It is a tint, not the "
                            "colour of the toy: crank it and the rings go to "
                            "silhouettes, because every photon that reaches "
                            "one has crossed the volume twice")
    water.add_argument("--plate", type=float, default=0.6,
                       help="backing-plate glow. The plate is lit from the "
                            "front through the water, so it arrives dimmer "
                            "than the rings in front of it; a little "
                            "emission puts the field back behind them. 0 "
                            "leaves it plain diffuse plastic")
    water.add_argument("--ripple", type=float, default=0.012,
                       help="resting surface displacement in metres")
    water.add_argument("--ripple-kick", type=float, default=4.0,
                       help="how much a button press multiplies the ripple")

    play = p.add_argument_group("rings and pegs")
    play.add_argument("--rings", type=int, default=9)
    play.add_argument("--ring-radius", type=float, default=0.155,
                      help="ring outer radius in metres")
    play.add_argument("--ring-tube", type=float, default=0.028,
                      help="ring stock radius in metres")
    play.add_argument("--hooks", type=int, default=5,
                      help="pegs to land rings on")
    play.add_argument("--hook-fit", type=float, default=0.72,
                      help="peg shaft radius as a fraction of a ring's hole. "
                           "This is the slop in the joint, and it is what "
                           "decides whether a seated ring stays seated: a "
                           "thin peg in a wide hole lets the ring swing "
                           "until its plane lines up with the shaft, and "
                           "then it simply falls off")
    play.add_argument("--hook-grip", type=float, default=0.86,
                      help="knob radius as a fraction of a ring's hole. "
                           "Under 1 a ring can be threaded on and worked "
                           "back off; the closer to 1, the more a landing "
                           "sticks and the less the board ever changes")
    play.add_argument("--hook-tilt", type=float, default=38.0,
                      help="how far the pegs lean up out of the back wall, "
                           "in degrees. A peg pointing straight at an "
                           "orthographic camera is a dot; leaning it up "
                           "gives it a length to read, and gives a ring "
                           "something to actually hang on")
    play.add_argument("--hook-bob", type=float, default=0.022,
                      help="how far the pegs drift on their stalks, in "
                           "metres; 0 bolts them down")
    play.add_argument("--seed", type=int, default=7,
                      help="seed for ring placement and peg layout")

    motion = p.add_argument_group("motion")
    motion.add_argument("--presses", type=int, default=2,
                        help="button presses inside one loop")
    motion.add_argument("--buttons", type=int, default=1,
                        choices=[1, 2],
                        help="1 is the classic single-jet toy; 2 gives the "
                             "two-button variant, and presses alternate")
    motion.add_argument("--jet", type=float, default=18.0,
                        help="peak upward acceleration a ring feels on the "
                             "jet axis, in m/s^2. This is the water "
                             "pressure the button releases")
    motion.add_argument("--jet-wind", type=float, default=45.0,
                        help="peak strength of the wind field the bubbles "
                             "ride. Same envelope as --jet, different units "
                             "— one is our solver, the other is Blender's "
                             "particle system")
    motion.add_argument("--jet-frames", type=int, default=26,
                        help="frames a single press keeps pushing")
    motion.add_argument("--jet-reach", type=float, default=0.0,
                        help="how far up the chamber the jet reaches, in "
                            "metres; 0 uses two thirds of the water column")
    motion.add_argument("--jet-spread", type=float, default=5.0,
                        help="jet column radius at the nozzle, as a multiple "
                             "of the nozzle itself. The column widens with "
                             "height on top of this. Too narrow and a press "
                             "only moves whatever is directly over the hole, "
                             "which from across the chamber looks like "
                             "nothing happened")
    motion.add_argument("--drift", type=float, default=0.9,
                        help="background turbulence. Without it the rings "
                            "never move in depth and so never line up with "
                            "a peg")
    motion.add_argument("--ring-gravity", type=float, default=1.25,
                        help="apparent downward acceleration on a ring, in "
                             "m/s^2. Buoyancy cancels most of g for a "
                             "plastic ring in water; this is what is left")
    motion.add_argument("--ring-drag", type=float, default=5.0,
                        help="water drag on a ring, per second. With "
                             "--ring-gravity it fixes the sinking speed: a "
                             "ring settles at gravity over drag")
    motion.add_argument("--catch", type=float, default=0.85,
                        help="how close a ring's centre must come to a peg "
                             "to be caught, as a fraction of its hole. It is "
                             "measured on screen, because that is where a "
                             "ring either looks threaded or does not")
    motion.add_argument("--catch-speed", type=float, default=0.45,
                        help="fastest a ring can be moving and still be "
                             "caught, in m/s. A ring flying past a peg does "
                             "not land on it")
    motion.add_argument("--release", type=float, default=2.0,
                        help="jet acceleration that knocks a ring off a peg, "
                             "in m/s^2. Below it the press only rocks the "
                             "ring, which is what a weak press does")
    motion.add_argument("--loop", type=int, default=240,
                        help="frames in the finished loop")
    motion.add_argument("--preroll", type=int, default=90,
                        help="settle frames simulated before the loop "
                             "starts; never rendered")
    motion.add_argument("--quiet", type=int, default=78,
                        help="frames at the tail of the loop with no jet, so "
                             "the last bubbles are gone before the seam")
    motion.add_argument("--rewind", type=int, default=54,
                        help="frames over which the rings drift back to "
                             "their opening pose, which is what closes the "
                             "loop; 0 disables and the seam will jump")
    motion.add_argument("--fps", type=int, default=30)

    fizz = p.add_argument_group("bubbles")
    fizz.add_argument("--bubbles", type=int, default=340,
                      help="bubbles released per press")
    fizz.add_argument("--bubble-size", type=float, default=0.022)
    fizz.add_argument("--bubble-life", type=int, default=44,
                      help="frames a jet bubble lasts")
    fizz.add_argument("--cling", type=int, default=40,
                      help="bubbles stuck to the inside of the glass, which "
                           "do not move and cost nothing")

    out = p.add_argument_group("output")
    out.add_argument("--out", default="//renders/ringtoy",
                     help="output directory for the frame sequence")
    out.add_argument("--res-x", type=int, default=1080)
    out.add_argument("--res-y", type=int, default=2400)
    out.add_argument("--samples", type=int, default=192)
    out.add_argument("--percent", type=int, default=100,
                     help="resolution percentage; 25 for fast look-dev")
    out.add_argument("--margin", type=float, default=1.0,
                     help="framing headroom; 1.0 touches the frame edges")
    out.add_argument("--transparent", action="store_true")
    out.add_argument("--backdrop", default="0.97,0.97,0.98",
                     help="backdrop colour as r,g,b in 0-1")
    out.add_argument("--env", type=float, default=0.9,
                     help="world lighting strength")
    out.add_argument("--sweep", type=float, default=0.75,
                     help="emissive backdrop strength. It is the light the "
                          "water is seen against, so it sets how saturated "
                          "the blue can get before it clips")
    out.add_argument("--blend-frames", type=int, default=0,
                     help="frames crossfaded across the loop seam. The rings "
                          "are rewound instead, so this defaults off; raise "
                          "it only if --rewind is 0")
    out.add_argument("--static", action="store_true",
                     help="look-dev mode: no physics at all. Rings are "
                          "placed where they would plausibly sit, so "
                          "materials and framing can be judged in seconds")
    out.add_argument("--no-sim", action="store_true",
                     help="build and render without stepping the rings; the "
                          "jet and bubbles still play")
    out.add_argument("--no-render", action="store_true")
    out.add_argument("--encode", action="store_true",
                     help="encode an mp4 next to the frame sequence")
    out.add_argument("--save-blend", default="")
    out.add_argument("--device", choices=["CPU", "GPU"], default="CPU")
    out.add_argument("--view-transform", default="Khronos PBR Neutral",
                     choices=["Khronos PBR Neutral", "Standard", "AgX",
                              "Filmic"])
    out.add_argument("--exposure", type=float, default=0.0)

    args = p.parse_args(argv)

    # A press has to be over, and its bubbles gone, before the loop wraps —
    # otherwise the seam has a bubble in mid-rise on one side and nothing on
    # the other. This is the constraint that makes the loop closeable at all,
    # so it is enforced rather than left to the caller.
    needed = args.jet_frames + args.bubble_life + 8
    if args.quiet < needed:
        print(f"[ringtoy] --quiet {args.quiet} is too short for a "
              f"{args.jet_frames}-frame jet and {args.bubble_life}-frame "
              f"bubbles; using {needed}")
        args.quiet = needed
    args.rewind = max(0, min(args.rewind, args.quiet - 4))
    return args


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def setattrs(target, **values) -> None:
    """Set the attributes that exist and ignore the rest.

    Force-field and rigid-body properties drift between Blender versions;
    this keeps a rename from aborting the whole build.
    """
    for name, value in values.items():
        if hasattr(target, name):
            try:
                setattr(target, name, value)
            except (TypeError, AttributeError):
                pass


def smoothstep(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def join(objs: list[bpy.types.Object], name: str) -> bpy.types.Object:
    """Join a pile of primitives into one object, keeping the first."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------


def prism(name: str, plan: list[tuple[float, float]],
          depth: float) -> bpy.types.Object:
    """Extrude a plan curve straight through Y.

    The window is a hole, not a dent: a pillow-shaped cutter would leave the
    case closed at the back, so the cutter has to run clear through the
    depth.
    """
    n = len(plan)
    verts = [Vector((x, -depth * 0.5, z)) for x, z in plan]
    verts += [Vector((x, depth * 0.5, z)) for x, z in plan]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    obj = link(bpy.data.objects.new(name, mesh))
    # The exact boolean solver decides inside from outside by the normals.
    # Hand-wound caps and walls do not agree on which way is out, and a
    # cutter it reads inside-out subtracts the complement: the window fills
    # in with a plug of case instead of opening.
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def boolean(obj: bpy.types.Object, cutter: bpy.types.Object,
            operation: str = "DIFFERENCE") -> None:
    activate(obj)
    mod = obj.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=mod.name)


def ring_mesh(name: str, radius: float, tube: float,
              major: int = 48, minor: int = 14) -> bpy.types.Object:
    """One plastic ring, standing in the screen plane.

    The chamber is only a few ring-thicknesses deep, so a ring is held
    roughly face-on by the glass in front and behind it — which is exactly
    how the real toy keeps the rings readable and how they end up able to
    slide over a peg that points at the player.
    """
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius - tube, minor_radius=tube,
        major_segments=major, minor_segments=minor,
        rotation=(math.radians(90.0), 0.0, 0.0))
    obj = bpy.context.active_object
    obj.name = name
    # Bake the stand-up rotation into the mesh. Left on the object it is the
    # first thing overwritten when a ring is given its own tilt, and every
    # ring goes back to lying flat — which from a dead-on camera is a stick.
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.shade_smooth()
    return obj


# How thick the collar disc is, as a multiple of the shaft radius. It is a
# module constant because two places need to agree on it: the peg that is
# built with it, and the seat a ring is placed at, which has to start clear
# of it.
COLLAR_DEPTH = 0.9


def hook_post(name: str, shaft_r: float, length: float, knob_r: float,
              collar_r: float) -> bpy.types.Object:
    """A peg: collar at the back wall, shaft toward the camera, knob on top.

    Origin sits at the collar, and the post runs along -Y — toward the
    viewer — because that is the axis a ring floating in the screen plane
    can actually be threaded along.
    """
    parts = []

    bpy.ops.mesh.primitive_cylinder_add(
        radius=collar_r, depth=shaft_r * COLLAR_DEPTH, vertices=28,
        location=(0.0, -shaft_r * COLLAR_DEPTH * 0.5, 0.0),
        rotation=(math.radians(90.0), 0.0, 0.0))
    parts.append(bpy.context.active_object)

    bpy.ops.mesh.primitive_cylinder_add(
        radius=shaft_r, depth=length, vertices=24,
        location=(0.0, -length * 0.5, 0.0),
        rotation=(math.radians(90.0), 0.0, 0.0))
    parts.append(bpy.context.active_object)

    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=knob_r, segments=20, ring_count=12,
        location=(0.0, -length, 0.0))
    parts.append(bpy.context.active_object)

    obj = join(parts, name)
    activate(obj)
    bpy.ops.object.shade_smooth()
    return obj


def button_body(name: str, radius: float, depth: float) -> bpy.types.Object:
    """The press button, standing proud of the bezel toward the camera."""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=40,
        rotation=(math.radians(90.0), 0.0, 0.0))
    obj = bpy.context.active_object
    obj.name = name
    bevel = obj.modifiers.new("soften", "BEVEL")
    bevel.width = min(radius, depth) * 0.28
    bevel.segments = 4
    bevel.limit_method = "ANGLE"
    activate(obj)
    bpy.ops.object.shade_smooth()
    return obj


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------


def case_material(colour: tuple[float, float, float]) -> bpy.types.Material:
    """Moulded opaque ABS. Slightly rough, with a thin factory gloss."""
    mat, tree = new_material("ringtoy_case")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    put(bsdf, ("Base Color",), rgba(lin(colour)))
    put(bsdf, ("Roughness",), 0.34)
    put(bsdf, ("Specular IOR Level", "Specular"), 0.5)
    put(bsdf, ("Coat Weight", "Clearcoat"), 0.35)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.12)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def glass_material() -> bpy.types.Material:
    """The clear window. Thin, so almost no absorption of its own."""
    mat, tree = new_material("ringtoy_glass")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    put(bsdf, ("Base Color",), rgba((1.0, 1.0, 1.0)))
    put(bsdf, ("Roughness",), 0.012)
    put(bsdf, ("IOR",), 1.49)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    put(bsdf, ("Coat Weight", "Clearcoat"), 1.0)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.02)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def water_material(reference: bpy.types.Object, size: Vector,
                   density: float) -> bpy.types.Material:
    """Clear surface over a graded absorbing volume.

    Same construction as the shaker's liquid, and for the same reason: a
    gradient in the volume reads as depth of water, where the same gradient
    on the surface reads as paint. Coordinates come from the chamber rather
    than from the water body so the ramp does not move when the surface is
    displaced.
    """
    mat, tree = new_material("ringtoy_water")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 200)
    put(bsdf, ("Base Color",), rgba((1.0, 1.0, 1.0)))
    put(bsdf, ("Roughness",), 0.015)
    put(bsdf, ("IOR",), 1.333)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-600, -200)
    coord.object = reference

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-400, -200)
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0 / size.z)
    mapping.inputs["Location"].default_value = (0.0, 0.0, 0.5)

    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-200, -420)

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (0, -200)
    ramp.color_ramp.elements[0].position = 0.05
    ramp.color_ramp.elements[0].color = rgba(lin(WATER_DEEP))
    ramp.color_ramp.elements[1].position = 0.98
    ramp.color_ramp.elements[1].color = rgba(lin(WATER_TOP))

    absorb = tree.nodes.new("ShaderNodeVolumeAbsorption")
    absorb.location = (300, -200)
    absorb.inputs["Density"].default_value = density

    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    tree.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], absorb.inputs["Color"])
    tree.links.new(absorb.outputs["Volume"], out.inputs["Volume"])
    return mat


def ring_material() -> bpy.types.Material:
    """Translucent injection-moulded plastic, one hue per ring.

    The hue is picked by Object Info → Random, which is per-object, so every
    ring is a different colour from one material — and a ring keeps its
    colour for the whole loop instead of strobing.
    """
    mat, tree = new_material("ringtoy_ring")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)

    info = tree.nodes.new("ShaderNodeObjectInfo")
    info.location = (-300, 0)

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-100, 0)
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    while len(elements) > 1:
        elements.remove(elements[-1])
    elements[0].position = 0.0
    elements[0].color = rgba(lin(RING_HUES[0]))
    for i, hue in enumerate(RING_HUES[1:], start=1):
        elements.new(i / len(RING_HUES)).color = rgba(lin(hue))

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (200, 0)
    put(bsdf, ("Roughness",), 0.16)
    put(bsdf, ("IOR",), 1.5)
    # Part-transmissive: a solid ring goes flat and dark once it is behind a
    # metre of absorbing water, and a fully clear one disappears into it.
    put(bsdf, ("Transmission Weight", "Transmission"), 0.32)
    put(bsdf, ("Coat Weight", "Clearcoat"), 0.8)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.06)
    # A little emission, to hold the hue against the plate behind. Any
    # more and the rings stop looking like plastic and start looking like
    # they are lit from inside.
    put(bsdf, ("Emission Strength",), 0.28)

    tree.links.new(info.outputs["Random"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    emission = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    if emission is not None:
        tree.links.new(ramp.outputs["Color"], emission)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def plate_material(size: Vector, boost: float) -> bpy.types.Material:
    """The backing plate: a vertical aqua-to-blue ramp on matte plastic.

    Diffuse rather than emissive, and lit from the front through the same
    glass and water the camera looks through. That is what keeps the rings
    reading as objects in front of it: light them from behind and every ring
    in the chamber becomes a silhouette.
    """
    mat, tree = new_material("ringtoy_plate")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)

    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-600, 0)

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-400, 0)
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0 / size.z)
    mapping.inputs["Location"].default_value = (0.0, 0.0, 0.5)

    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-200, 0)

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (0, 0)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = rgba(lin(PLATE_DEEP))
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = rgba(lin(PLATE_TOP))

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (250, 0)
    put(bsdf, ("Roughness",), 0.52)
    put(bsdf, ("Coat Weight", "Clearcoat"), 0.25)

    tree.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    tree.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if boost > 0.0:
        put(bsdf, ("Emission Strength",), boost)
        socket = bsdf.inputs.get("Emission Color") or \
            bsdf.inputs.get("Emission")
        if socket is not None:
            tree.links.new(ramp.outputs["Color"], socket)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def sweep_material(colour: tuple[float, float, float],
                   strength: float) -> bpy.types.Material:
    """Emissive backdrop and light tent.

    The shaker's equivalent is fixed at a strength that suits a pouch of
    glitter seen against white. Here the same light has to cross a metre of
    absorbing water before it reaches the camera, and at that strength it
    arrives still clipped — the water renders pale blue and the tint the
    absorption is doing never shows. So the strength is a flag.
    """
    mat, tree = new_material("ringtoy_sweep")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    emit = tree.nodes.new("ShaderNodeEmission")
    emit.location = (-200, 0)
    emit.inputs["Color"].default_value = rgba(colour)
    emit.inputs["Strength"].default_value = strength
    tree.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def simple_material(name: str, colour: tuple[float, float, float],
                    roughness: float = 0.3,
                    emission: float = 0.0) -> bpy.types.Material:
    mat, tree = new_material(name)
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    put(bsdf, ("Base Color",), rgba(lin(colour)))
    put(bsdf, ("Roughness",), roughness)
    if emission > 0.0:
        put(bsdf, ("Emission Strength",), emission)
        socket = bsdf.inputs.get("Emission Color") or \
            bsdf.inputs.get("Emission")
        if socket is not None:
            socket.default_value = rgba(lin(colour))
    put(bsdf, ("Coat Weight", "Clearcoat"), 0.5)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.08)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------------------
# the scene
# --------------------------------------------------------------------------


def build_case(args, size: Vector) -> dict:
    """Opaque frame with a through-window, and the clear pane that fills it.

    The case is a pillow the size of the frame; the window is that pillow
    with a straight prism cut clean through it. The pane then sits in the
    hole, so the silhouette of the frame and the silhouette of the glass are
    the same curve rather than two curves that nearly agree.
    """
    corner = args.corner * min(size.x, size.z)
    outer = plan_curve(size.x, size.z, args.squircle_n, corner, args.segments)

    case = pillow("Ringtoy_Case", outer, size.y, args.profile_n,
                  max(8, args.segments // 3))

    bezel = args.bezel * size.x
    win = Vector((size.x - bezel * 2.0, size.y, size.z - bezel * 2.0))
    win_corner = max(0.0, corner - bezel)
    win_plan = plan_curve(win.x, win.z, args.squircle_n, win_corner,
                          args.segments)

    cutter = prism("Ringtoy_Window_Cut", win_plan, size.y * 3.0)
    boolean(case, cutter)
    bpy.data.objects.remove(cutter, do_unlink=True)

    colour = CASE_COLOUR
    if args.case_colour:
        colour = tuple(float(c) for c in args.case_colour.split(","))
    case.data.materials.append(case_material(colour))

    # The pane is a pillow of its own so the window bulges the way a moulded
    # lens does; flat glass over a curved bezel reads as a screenshot.
    pane = pillow("Ringtoy_Pane", win_plan, size.y * 0.92, args.profile_n,
                  max(8, args.segments // 3))
    pane.data.materials.append(glass_material())

    # The water chamber is the pane's interior: the pane's own wall thickness
    # taken off every side.
    glass = args.glass
    inner = Vector((win.x - glass * 2.0, size.y * 0.92 - glass * 2.0,
                    win.z - glass * 2.0))
    inner_corner = max(0.0, win_corner - glass)
    inner_plan = plan_curve(inner.x, inner.z, args.squircle_n, inner_corner,
                            max(32, args.segments // 2))

    return {"case": case, "pane": pane, "window": win,
            "interior": inner, "interior_plan": inner_plan,
            "interior_corner": inner_corner}


def build_plate(args, built: dict) -> bpy.types.Object:
    """A flat sheet across the back of the chamber.

    It sits just inside the back wall rather than behind the glass, so the
    water is genuinely between it and the camera and the plate's own colour
    deepens with the water it is seen through.
    """
    inner = built["interior"]
    plate = prism("Ringtoy_Plate", built["interior_plan"], inner.y * 0.02)
    plate.location = (0.0, inner.y * 0.5 - inner.y * 0.02, 0.0)
    plate.data.materials.append(plate_material(inner, args.plate))
    return plate


def build_water(args, built: dict, fill_z: float) -> dict:
    """The water body, and the machinery that ripples its surface.

    Displacement is confined to a band under the waterline by a vertex
    group, because the same modifier run over the whole body would ripple
    the water where it meets the glass a metre down, which is a place water
    does not ripple.
    """
    inner = built["interior"]
    water = pillow("Ringtoy_Water", built["interior_plan"], inner.y * 0.995,
                   args.profile_n, max(8, args.segments // 4))
    # Shrink very slightly in plan so the water surface is not coplanar with
    # the chamber wall; coincident transmissive faces produce a black seam.
    water.scale = (0.996, 1.0, 1.0)
    activate(water)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cut_above(water, fill_z, inner)
    water.data.materials.append(
        water_material(built["pane"], inner, args.density))
    activate(water)
    bpy.ops.object.shade_smooth()

    band = inner.z * 0.10
    group = water.vertex_groups.new(name="waterline")
    for vert in water.data.vertices:
        weight = smoothstep(1.0 - (fill_z - vert.co.z) / band)
        if weight > 0.001:
            group.add([vert.index], weight, "REPLACE")

    subsurf = water.modifiers.new("dense", "SUBSURF")
    subsurf.subdivision_type = "SIMPLE"
    subsurf.levels = 2
    subsurf.render_levels = 3

    texture = bpy.data.textures.new("ringtoy_ripple", type="CLOUDS")
    texture.noise_scale = 0.22
    texture.noise_depth = 3

    # The displacement texture is nailed to the world; what moves is the
    # object the modifier takes its coordinates from. Drive that on a
    # sinusoid and the ripple pattern returns exactly to where it started at
    # the end of the loop, which a scrolling offset never would.
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    drift = bpy.context.active_object
    drift.name = "Ripple_Drift"
    drift.empty_display_size = 0.1

    displace = water.modifiers.new("ripple", "DISPLACE")
    displace.texture = texture
    displace.texture_coords = "OBJECT"
    displace.texture_coords_object = drift
    displace.direction = "Z"
    displace.mid_level = 0.5
    displace.vertex_group = group.name
    displace.strength = args.ripple

    return {"water": water, "ripple_drift": drift, "ripple": displace}


def ring_hole(args) -> float:
    """Inner radius of a ring — the clearance a peg has to fit through."""
    return args.ring_radius - args.ring_tube * 2.0


def hook_length(inner: Vector) -> float:
    """How far a peg reaches into the chamber.

    It has to be short enough that a ring can float past in front of it —
    otherwise the pegs are a wall and nothing ever crosses them — and long
    enough that a ring which does line up gets threaded rather than nudged.
    """
    return inner.y * 0.58


def hook_layout(args, inner: Vector, fill_z: float
                ) -> list[tuple[float, float]]:
    """Where the pegs go: a staggered column, never two at the same height.

    The real toy clusters its pegs so a ring that misses one has a chance at
    the next. Staggering them in X as well means a ring rising up the jet
    passes several, which is what makes a landing look earned rather than
    scripted.
    """
    rng = random.Random(args.seed)
    n = max(1, args.hooks)
    spots = []
    low = -inner.z * 0.5 + inner.z * 0.20
    high = fill_z - inner.z * 0.12
    for i in range(n):
        t = (i + 0.5) / n
        z = low + (high - low) * t
        side = 1.0 if i % 2 == 0 else -1.0
        x = side * inner.x * (0.16 + 0.13 * ((i * 3) % 3) / 2.0)
        x += rng.uniform(-0.03, 0.03) * inner.x
        spots.append((x, z))
    return spots


def build_hooks(args, built: dict, fill_z: float) -> list[bpy.types.Object]:
    """The pegs, mounted off the back wall so they can float.

    They carry no physics of their own. The ring solver treats a peg as a
    place a ring can be caught rather than as a body to bounce off, which is
    the only reading that produces a ring hanging *on* a peg rather than
    resting against it.
    """
    inner = built["interior"]
    length = hook_length(inner)
    hole = ring_hole(args)
    # Every diameter here comes off the ring's hole, because every one of
    # them is really a statement about the ring. The knob is what a ring has
    # to climb over to leave by the front; the collar is what stops it
    # walking off the back — and a collar narrower than the hole is not a
    # stop at all, it is a ramp.
    shaft = hole * args.hook_fit
    knob = hole * args.hook_grip
    collar = hole * 1.16
    # The pegs sit against the back wall, which is the deepest water in
    # the chamber; a plain white plastic reads as charcoal from there.
    material = simple_material("ringtoy_hook", HOOK_COLOUR, 0.22, 0.35)

    back = inner.y * 0.5
    # Leaning the post up means -Y rotates toward +Z, so a ring that slides
    # on has to climb to come off again. It is what turns a peg into a hook.
    tilt = -math.radians(args.hook_tilt)

    hooks = []
    for i, (x, z) in enumerate(hook_layout(args, inner, fill_z)):
        post = hook_post(f"Ringtoy_Hook_{i}", shaft, length, knob, collar)
        post.location = (x, back - shaft * 0.2, z)
        post.rotation_euler = (tilt, 0.0, 0.0)
        post.data.materials.append(material)
        hooks.append(post)
    return hooks


def build_rings(args, built: dict, fill_z: float,
                hooks: list[bpy.types.Object]) -> list[bpy.types.Object]:
    """The rings, in their opening pose.

    Some start already on a peg, because a loop that opens with an empty
    board has to earn every landing inside its own length, and that is not
    what the toy looks like when you pick it up. The rest lie in the
    bottom of the chamber where they have settled.
    """
    rng = random.Random(args.seed + 1)
    inner = built["interior"]
    material = ring_material()
    radius = args.ring_radius
    tube = args.ring_tube

    # Somewhere between a third and a half of the rings start on a peg. A
    # loop that opens with an empty board has to earn every landing inside
    # 240 frames, which is not how the toy looks when you pick it up.
    seated = min(len(hooks), max(1, args.rings // 3))
    order = list(range(len(hooks)))
    rng.shuffle(order)

    rings = []
    for i in range(args.rings):
        ring = ring_mesh(f"Ringtoy_Ring_{i}", radius, tube)
        ring.data.materials.append(material)

        if i < seated:
            hook = hooks[order[i % len(order)]]
            # Square to the peg, not square to the camera: a hoop on an
            # angled peg is seen as an ellipse, and reading it as one is
            # most of what says the peg goes *through* the ring.
            ring.rotation_euler = (-math.radians(args.hook_tilt),
                                   rng.uniform(-0.10, 0.10),
                                   rng.uniform(-0.06, 0.06))
            ring.location = hang_point(args, hook)
        else:
            ring.location = (
                rng.uniform(-1.0, 1.0) * inner.x * 0.32,
                rng.uniform(-0.28, 0.28) * inner.y,
                -inner.z * 0.5 + radius * (1.4 + 1.9 * rng.random()))
            ring.rotation_euler = (rng.uniform(-0.2, 0.2),
                                   rng.uniform(-0.6, 0.6),
                                   rng.uniform(-0.4, 0.4))

        rings.append(ring)
    return rings


def build_jets(args, built: dict, fill_z: float) -> list[dict]:
    """A button on the bezel, a nozzle in the floor, and the jet between.

    The jet is a wind field with a tube falloff — a column of moving water
    rather than a point that shoves everything radially. Rigid bodies and
    particles both read it, so one animated strength drives the rings and
    the bubbles together, which is the whole trick: the bubbles are not
    decoration on top of the push, they are in it.
    """
    inner = built["interior"]
    size = built["size"]
    reach = args.jet_reach if args.jet_reach > 0 else \
        (fill_z + inner.z * 0.5) * 0.66
    nozzle_r = inner.x * 0.045
    floor = -inner.z * 0.5 + nozzle_r * 0.6

    offsets = [0.0] if args.buttons == 1 else \
        [-size.x * 0.20, size.x * 0.20]
    # Sized off the chin rather than off the case, so widening the bezel
    # widens the button with it and the two never disagree.
    chin = args.bezel * size.x
    button_r = chin * 0.52
    button_mat = simple_material("ringtoy_button", BUTTON_COLOUR, 0.28)

    jets = []
    for i, x in enumerate(offsets):
        bpy.ops.object.effector_add(type="WIND", location=(x, 0.0, floor))
        field = bpy.context.active_object
        field.name = f"Ringtoy_Jet_{i}"
        setattrs(field.field, strength=0.0, flow=0.6, noise=0.12,
                 seed=args.seed + i, falloff_type="TUBE",
                 z_direction="POSITIVE", use_min_distance=False,
                 use_max_distance=True, distance_max=reach,
                 falloff_power=1.1, use_radial_max=True,
                 radial_max=nozzle_r * args.jet_spread, radial_falloff=1.6)

        bpy.ops.mesh.primitive_circle_add(
            radius=nozzle_r, vertices=20, fill_type="NGON",
            location=(x, 0.0, floor))
        nozzle = bpy.context.active_object
        nozzle.name = f"Ringtoy_Nozzle_{i}"
        # Hide the disc, not what it emits: hide_render here would take the
        # bubbles with it.
        nozzle.show_instancer_for_render = False
        nozzle.show_instancer_for_viewport = False

        button = button_body(f"Ringtoy_Button_{i}", button_r,
                             size.y * 0.55)
        button.location = (x, -size.y * 0.5 - size.y * 0.12,
                           -size.z * 0.5 + chin * 0.5)
        button.data.materials.append(button_mat)

        jets.append({"field": field, "nozzle": nozzle, "button": button,
                     "rest_y": button.location.y, "reach": reach,
                     "spread": nozzle_r * args.jet_spread, "floor": floor})
    return jets


def build_bubbles(args, built: dict, jets: list[dict],
                  schedule: list[tuple[int, int]], fill_z: float) -> None:
    """One particle system per press, plus the bubbles stuck to the glass.

    A burst per press is what keeps the loop closeable. A single continuous
    system would always have something mid-rise at the seam; a system that
    starts and finishes inside the loop leaves the chamber genuinely empty
    at both ends, which is also how the toy behaves — no press, no bubbles.
    """
    material = bubble_material()
    inner = built["interior"]

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,
                                          radius=args.bubble_size)
    bubble = bpy.context.active_object
    bubble.name = "Ringtoy_Bubble"
    bubble.data.materials.append(material)
    bpy.ops.object.shade_smooth()

    assets = bpy.data.collections.new("Ringtoy_Assets")
    bpy.context.collection.objects.unlink(bubble)
    assets.objects.link(bubble)

    rise = fill_z + inner.z * 0.5
    for index, (frame, which) in enumerate(schedule):
        nozzle = jets[which]["nozzle"]
        activate(nozzle)
        nozzle.modifiers.new(f"burst_{index}", "PARTICLE_SYSTEM")
        settings = nozzle.particle_systems[-1].settings
        settings.name = f"ringtoy_burst_{index}"
        settings.type = "EMITTER"
        settings.count = args.bubbles
        settings.frame_start = frame
        settings.frame_end = frame + max(1, int(args.jet_frames * 0.55))
        settings.lifetime = args.bubble_life
        settings.lifetime_random = 0.35
        settings.emit_from = "FACE"
        settings.distribution = "RAND"
        settings.use_emit_random = True
        settings.physics_type = "NEWTON"
        settings.mass = 0.002
        settings.particle_size = 1.0
        settings.size_random = 0.75
        # The nozzle disc faces up, so normal_factor is the pressure kick
        # itself; the rest of the rise is buoyancy and the jet field.
        # Fast enough to reach the surface inside a lifetime. Bubbles that
        # expire halfway up read as a dust that fades rather than as air
        # going somewhere.
        settings.normal_factor = rise / max(1, args.bubble_life) * \
            args.fps * 0.8
        # Tight, because it is a jet. Scattered across the chamber the
        # bubbles stop looking like they came out of the nozzle at all, and
        # the press loses its cause.
        settings.factor_random = 0.14
        settings.brownian_factor = 0.05
        settings.drag_factor = 0.55
        settings.damping = 0.1
        settings.render_type = "OBJECT"
        settings.instance_object = bubble
        # Negative gravity weight is the buoyancy; the wind weight is what
        # puts them inside the jet rather than beside it.
        settings.effector_weights.gravity = -0.28
        settings.effector_weights.wind = 1.0
        settings.effector_weights.turbulence = 0.5

    if args.cling <= 0:
        return

    # Bubbles that never move: the ones clinging to the inside of the front
    # glass. They cost one static instance each and they are the detail that
    # says "sealed chamber" rather than "empty tank".
    rng = random.Random(args.seed + 3)
    stuck = bpy.data.collections.new("Ringtoy_Cling")
    for i in range(args.cling):
        r = args.bubble_size * rng.uniform(0.35, 0.9)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r)
        obj = bpy.context.active_object
        obj.name = f"Ringtoy_Cling_{i}"
        obj.data.materials.append(material)
        obj.location = (rng.uniform(-0.46, 0.46) * inner.x,
                        -inner.y * 0.5 + r * 0.8,
                        rng.uniform(-0.48, 0.46) * inner.z)
        if obj.location.z > fill_z:
            obj.location.z = fill_z - r
        bpy.ops.object.shade_smooth()
        bpy.context.collection.objects.unlink(obj)
        stuck.objects.link(obj)
    bpy.context.scene.collection.children.link(stuck)


def build_drift(args, inner: Vector) -> bpy.types.Object | None:
    """Slow turbulence through the whole chamber.

    Without it the rings only ever move in the screen plane, and a ring that
    never changes depth can never line up with a peg pointing at the camera
    — the board would be frozen from the first frame no matter how hard the
    jet blows.
    """
    if args.drift <= 0.0:
        return None
    bpy.ops.object.effector_add(type="TURBULENCE", location=(0, 0, 0))
    field = bpy.context.active_object
    field.name = "Ringtoy_Drift"
    setattrs(field.field, strength=args.drift, size=0.9, noise=1.1,
             flow=0.35, seed=args.seed)
    return field


def build_camera(args, size: Vector) -> bpy.types.Object:
    """Orthographic and dead-on. The toy is held flat; so is the camera."""
    data = bpy.data.cameras.new("Ringtoy_Cam")
    data.type = "ORTHO"
    # ortho_scale maps to the longer edge, which on a portrait frame is the
    # height — so framing on height alone crops the case sideways.
    aspect = args.res_y / max(1, args.res_x)
    data.ortho_scale = max(size.z * args.margin,
                           size.x * args.margin * aspect)
    cam = link(bpy.data.objects.new("Ringtoy_Cam", data))
    cam.location = (0.0, -8.0, 0.0)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def build_lighting(args, size: Vector) -> None:
    """Studio rig plus a light tent, same reasoning as the shaker.

    The window's rim rolls away from camera and total-internal-reflects down
    the sides; whatever those rays sample is what the edge of the frame
    looks like. Against an unlit void they sample nothing and the window is
    hemmed in black.
    """
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Ringtoy_World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = rgba((0.94, 0.97, 1.0))
    bg.inputs["Strength"].default_value = args.env
    scene.world = world

    def area(name, location, rotation, size_m, energy):
        data = bpy.data.lights.new(name, "AREA")
        data.shape = "RECTANGLE"
        data.size = size_m
        data.size_y = size_m * 1.6
        data.energy = energy
        light = link(bpy.data.objects.new(name, data))
        light.location = location
        light.rotation_euler = rotation
        return light

    area("Key", (-3.0, -4.4, 3.4),
         (math.radians(54), 0.0, math.radians(-36)), 4.0, 460)
    area("Fill", (3.4, -3.6, -1.4),
         (math.radians(102), 0.0, math.radians(44)), 5.0, 240)
    # Back light is what makes the water glow rather than sit there as a
    # dark slab, and it is what puts the bright rim on every bubble.
    area("Rim", (0.0, 5.2, 1.4), (math.radians(-108), 0.0, 0.0), 6.0, 700)

    if args.transparent:
        scene.render.film_transparent = True
        return

    colour = tuple(float(c) for c in args.backdrop.split(","))
    material = sweep_material(colour, args.sweep)
    span = max(size.x, size.z) * 6.0
    for name, location, rotation in (
        ("Backdrop", (0.0, span * 0.5, 0.0), (math.radians(90), 0, 0)),
        ("Tent_L", (-span * 0.35, 0.0, 0.0), (0, math.radians(90), 0)),
        ("Tent_R", (span * 0.35, 0.0, 0.0), (0, math.radians(-90), 0)),
        ("Tent_T", (0.0, 0.0, span * 0.35), (math.radians(180), 0, 0)),
        ("Tent_B", (0.0, 0.0, -span * 0.35), (0, 0, 0)),
    ):
        bpy.ops.mesh.primitive_plane_add(size=span, location=location,
                                         rotation=rotation)
        panel = bpy.context.active_object
        panel.name = name
        panel.data.materials.append(material)
        if name != "Backdrop":
            panel.visible_camera = False
            # The tent is there to be refracted by the glass and the water,
            # not to light the case. Left visible to diffuse rays it wraps
            # the coral in so much bounce that it renders as pale pink.
            panel.visible_diffuse = False


# --------------------------------------------------------------------------
# motion
# --------------------------------------------------------------------------


def press_schedule(args) -> list[tuple[int, int]]:
    """When the button goes down, and which button it is.

    Every press has to finish, and its bubbles clear, before the loop wraps.
    So the presses are spread across the loop minus the quiet tail rather
    than across the loop, and the last one lands well inside it.
    """
    first = args.preroll + 1
    span = max(1, args.loop - args.quiet)
    presses = max(0, args.presses)
    schedule = []
    for k in range(presses):
        offset = span * (k + 0.28) / presses
        schedule.append((first + int(round(offset)), k % args.buttons))
    return schedule


def animate_jets(args, jets: list[dict],
                 schedule: list[tuple[int, int]]) -> None:
    """Keyframe the jet strength and the button travel for each press.

    A jet is keyed only at its own breakpoints and is exactly zero
    everywhere else, which is what lets the seam be quiet: there is no
    residual forcing to match up across it.
    """
    travel = args.thickness * 0.16
    for jet in jets:
        jet["field"].field.strength = 0.0
        jet["field"].field.keyframe_insert(data_path="strength", frame=1)
        jet["button"].keyframe_insert(data_path="location", index=1, frame=1)

    decay = max(4, args.jet_frames)
    for frame, which in schedule:
        jet = jets[which]
        field = jet["field"].field
        for at in (frame - 2, frame + 1, frame + 5, frame + decay):
            field.strength = args.jet_wind * jet_level(args, schedule,
                                                       which, at)
            field.keyframe_insert(data_path="strength", frame=at)

        button = jet["button"]
        rest = jet["rest_y"]
        for at, value in ((frame - 3, rest),
                          (frame, rest + travel),
                          (frame + 4, rest + travel),
                          (frame + 14, rest)):
            button.location.y = value
            button.keyframe_insert(data_path="location", index=1, frame=at)
        button.location.y = rest

    for jet in jets:
        jet["field"].field.strength = 0.0


def animate_surface(args, water: dict, schedule: list[tuple[int, int]],
                    total: int) -> None:
    """Ripple the waterline: a slow resting swell, a spike on every press.

    The swell is an integer harmonic of the loop, so it returns exactly. The
    spikes are keyed to zero on both sides, so they add nothing at the seam.
    """
    drift = water["ripple_drift"]
    displace = water["ripple"]
    first = args.preroll + 1
    loop = float(args.loop)

    for frame in range(1, total + 2):
        t = (frame - first) / loop
        drift.location = (0.18 * math.sin(2 * math.pi * t),
                          0.11 * math.sin(2 * math.pi * 2 * t),
                          0.09 * math.cos(2 * math.pi * t))
        drift.keyframe_insert(data_path="location", frame=frame)

    displace.strength = args.ripple
    displace.keyframe_insert(data_path="strength", frame=1)
    for frame, _ in schedule:
        # The jet reaches the surface a little after it fires, and the swell
        # it raises outlasts the push.
        for at, value in ((frame + 2, args.ripple),
                          (frame + 12, args.ripple * args.ripple_kick),
                          (frame + args.jet_frames + 26, args.ripple)):
            displace.strength = value
            displace.keyframe_insert(data_path="strength", frame=at)
    displace.strength = args.ripple


def hook_offset(args, index: int, count: int, t: float) -> Vector:
    """Where a peg sits relative to its mount, at loop phase `t`.

    Shared, because two things need the same answer: the keyframer that
    makes the peg move, and the ring solver that decides where a ring
    hanging on it should be. Computed twice they disagree, and a hooked
    ring slides off a peg that is no longer under it.
    """
    if args.hook_bob <= 0.0:
        return Vector((0.0, 0.0, 0.0))
    phase = 2.0 * math.pi * (index / max(1, count))
    harmonic = 1 + (index % 2)
    return Vector((
        args.hook_bob * 0.45 * math.sin(2 * math.pi * t + phase * 1.7),
        0.0,
        args.hook_bob * math.sin(2 * math.pi * harmonic * t + phase)))


def animate_hooks(args, hooks: list[bpy.types.Object], total: int) -> None:
    """Float the pegs.

    In the toy the pegs are moulded into the back wall and do not move. Here
    they are on stalks and drift, because a wallpaper is looked at for a
    long time and a board that is perfectly rigid behind moving water reads
    as a painted backdrop. Both terms are integer harmonics of the loop, so
    the drift closes with everything else.
    """
    if args.hook_bob <= 0.0:
        return
    first = args.preroll + 1
    loop = float(args.loop)
    for i, hook in enumerate(hooks):
        base = Vector(hook.location)
        for frame in range(1, total + 2):
            t = (frame - first) / loop
            hook.location = base + hook_offset(args, i, len(hooks), t)
            hook.keyframe_insert(data_path="location", frame=frame)
        hook.location = base


# --------------------------------------------------------------------------
# simulation
# --------------------------------------------------------------------------


def jet_level(args, schedule: list[tuple[int, int]], which: int,
              frame: int) -> float:
    """How hard one jet is blowing at a frame, on 0..1.

    One envelope, read by three things: the wind field that carries the
    bubbles, the ripple on the surface, and the solver that moves the
    rings. Written twice they drift apart, and the bubbles stop agreeing
    with the push that is supposed to have made them.
    """
    decay = max(4, args.jet_frames)
    level = 0.0
    for at, index in schedule:
        if index != which or frame <= at - 2 or frame >= at + decay:
            continue
        if frame <= at + 1:
            here = (frame - (at - 2)) / 3.0
        elif frame <= at + 5:
            here = 1.0 - 0.38 * (frame - (at + 1)) / 4.0
        else:
            here = 0.62 * (1.0 - (frame - (at + 5)) / max(1, decay - 5))
        level = max(level, min(1.0, max(0.0, here)))
    return level


def jet_push(args, jets: list[dict], levels: list[float],
             p: Vector) -> Vector:
    """Acceleration on a ring sitting in the jet column.

    A column, not a point: full strength on the axis, falling off across it
    and fading out with height as the plume spreads and slows. The sideways
    term is what makes a press scatter the rings instead of firing them all
    up the same line.
    """
    total = Vector((0.0, 0.0, 0.0))
    for jet, level in zip(jets, levels):
        if level <= 0.0:
            continue
        nozzle = jet["nozzle"].location
        radial = Vector((p.x - nozzle.x, p.y - nozzle.y, 0.0))
        # Height above the nozzle mouth, not above the chamber floor: the
        # jet starts where the hole is.
        height = p.z - jet["floor"]
        if height < 0.0 or height > jet["reach"]:
            continue
        spread = jet["spread"] * (1.0 + 1.2 * height / jet["reach"])
        distance = radial.length
        if distance > spread:
            continue
        across = (1.0 - distance / spread) ** 1.5
        up = (1.0 - height / jet["reach"]) ** 0.7
        strength = args.jet * level * across * up
        total.z += strength
        if distance > 1e-4:
            total += radial * (strength * 0.22 / distance)
    return total


def drift_field(args, p: Vector, phase: float) -> Vector:
    """A slow, divergence-ignorant swirl standing in for the water at rest.

    Three sinusoids, all at integer harmonics of the loop, so the field a
    ring feels on the last frame is the field it felt on the first. Nothing
    here is a fluid solve — it is the residual motion a sealed chamber has
    minutes after anyone touched it, which is mostly what this wallpaper
    shows.
    """
    if args.drift <= 0.0:
        return Vector((0.0, 0.0, 0.0))
    k = args.drift * 0.4
    return Vector((
        k * math.sin(1.7 * p.z + phase) * math.cos(1.1 * p.x),
        k * 0.7 * math.sin(2.3 * p.x + 2.0 * phase),
        k * 0.6 * math.cos(1.3 * p.x - phase) * math.sin(0.9 * p.z),
    ))


def hang_point(args, hook: bpy.types.Object,
               offset: Vector | None = None) -> Vector:
    """Where a ring sits once it is on a peg.

    Down the shaft until the collar stops it, and hanging by the inside of
    its hole — which is what a ring on a peg does, and is a good deal lower
    than centred on the peg.
    """
    axis = hook.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))
    hole = ring_hole(args)
    shaft = hole * args.hook_fit
    base = Vector(hook.location) + (offset or Vector((0.0, 0.0, 0.0)))
    seat = base + axis * (shaft * COLLAR_DEPTH + args.ring_tube * 1.7)
    down = Vector((0.0, 0.0, -1.0))
    down = (down - axis * down.dot(axis)).normalized()
    return seat + down * (hole - shaft) * 0.8


def simulate_rings(args, built: dict) -> None:
    """Integrate the rings, then bake them to keyframes that close the loop.

    Not Bullet. A ring is a body with a hole in it, and the whole point of
    this toy is putting that hole over a peg — which is the one thing a
    rigid-body solver here will not do. A convex hull has no hole; a concave
    triangle mesh is unsupported for a moving body; and a compound of beads
    following the stock, which is the shape that would work, is silently
    dropped, because parenting the beads to the ring they describe is a
    dependency cycle. The ring then has no collision shape at all and falls
    through everything, quietly, which is worse than failing.

    So the rings are integrated here instead: apparent gravity, water drag,
    the jet column, a slow drift, separation from each other, the chamber
    walls, and a latch that catches a ring on a peg when it drifts over one
    slowly and lets go when a jet hits it hard enough. Every term is
    something you can see in the render, which is the test that matters for
    a wallpaper, and being ours it is deterministic and repeatable.

    The loop is closed in pose. Over the last `--rewind` frames each ring is
    eased back toward the pose it held on the first rendered frame —
    position lerped, orientation slerped — so the last frame steps into the
    first without a jump. A ring drifting a few centimetres over two seconds
    is what rings in water do anyway, which is why the cheat survives being
    looked at.
    """
    rings = built["rings"]
    if not rings:
        return

    inner = built["interior"]
    hooks = built["hooks"]
    jets = built["jets"]
    schedule = built["schedule"]
    fill_z = built["fill_z"]

    total = args.preroll + args.loop
    first = args.preroll + 1
    dt = 1.0 / max(1, args.fps)
    radius, tube = args.ring_radius, args.ring_tube
    hole = ring_hole(args)
    floor = -inner.z * 0.5

    # The box a ring centre may occupy. Depth is the tight one: the chamber
    # is only a few ring-thicknesses deep, and that is what holds the rings
    # face-on instead of letting them turn edge-on and disappear.
    bound_x = inner.x * 0.5 - radius
    bound_y = inner.y * 0.5 - tube * 1.6
    bound_lo = floor + radius
    bound_hi = fill_z - radius * 0.15

    rng = random.Random(args.seed + 11)
    state = []
    for ring in rings:
        state.append({
            "p": Vector(ring.location),
            "v": Vector((rng.uniform(-0.02, 0.02), rng.uniform(-0.01, 0.01),
                         0.0)),
            "euler": Vector(ring.rotation_euler),
            "spin": rng.uniform(-0.4, 0.4),
            "hook": None,
            "cool": 0,
        })

    # A ring that starts on a peg starts latched to it, so the opening frame
    # is the pose it was authored in rather than a ring in freefall next to
    # a peg it has never been told about.
    for entry in state:
        for index, hook in enumerate(hooks):
            if (entry["p"] - hang_point(args, hook)).length < tube:
                entry["hook"] = index
                break

    catch = hole * args.catch
    tracks: list[list[tuple[Vector, object]]] = [[] for _ in rings]
    print(f"[ringtoy] integrating {total} frames for {len(rings)} rings")

    for frame in range(1, total + 1):
        phase = 2.0 * math.pi * (frame - first) / float(args.loop)
        levels = [jet_level(args, schedule, i, frame)
                  for i in range(len(jets))]
        # The pegs float, and a ring hanging on one has to float with it.
        t = (frame - first) / float(args.loop)
        offsets = [hook_offset(args, i, len(hooks), t)
                   for i in range(len(hooks))]

        for index, entry in enumerate(state):
            p, v = entry["p"], entry["v"]
            push = jet_push(args, jets, levels, p)

            if entry["hook"] is not None:
                hook = hooks[entry["hook"]]
                target = hang_point(args, hook, offsets[entry["hook"]])
                # A press strong enough to lift the ring off the peg is a
                # press strong enough to take it off; anything less only
                # rocks it, which is what the toy does too.
                if push.length > args.release:
                    entry["hook"] = None
                    entry["cool"] = args.jet_frames
                    v += push * dt
                else:
                    # Critically damped-ish pull toward the hang pose, plus
                    # whatever the drift and the wash of the jet are doing.
                    sway = drift_field(args, p, phase) * 0.5 + push * 0.25
                    v += ((target - p) * 26.0 - v * 9.0 + sway) * dt
                    entry["spin"] *= 0.86
            else:
                a = Vector((0.0, 0.0, -args.ring_gravity))
                a += drift_field(args, p, phase)
                a += push
                a -= v * args.ring_drag
                v += a * dt
                entry["spin"] += (push.x * 0.9 - entry["spin"] * 2.2) * dt

            entry["v"] = v
            entry["push"] = push

        # Separation. Rings are nearly coplanar, so overlap is measured in
        # the plane the camera sees and resolved there; two rings that
        # overlap on screen read as one shape whatever their depth.
        for i in range(len(state)):
            for j in range(i + 1, len(state)):
                a, b = state[i], state[j]
                delta = a["p"] - b["p"]
                flat = Vector((delta.x, 0.0, delta.z))
                gap = flat.length
                reach = radius * 1.92
                if gap < 1e-5 or gap >= reach:
                    continue
                if abs(delta.y) > tube * 2.2:
                    continue
                kick = flat * ((reach - gap) / gap * 5.5)
                if a["hook"] is None:
                    a["v"] += kick * dt
                if b["hook"] is None:
                    b["v"] -= kick * dt

        for index, entry in enumerate(state):
            entry["p"] = entry["p"] + entry["v"] * dt
            p, v = entry["p"], entry["v"]

            if entry["hook"] is None:
                # Walls. Restitution is low because this is a ring in water
                # hitting plastic, not a ball bearing hitting a table.
                for axis_i, lo, hi in ((0, -bound_x, bound_x),
                                       (1, -bound_y, bound_y),
                                       (2, bound_lo, bound_hi)):
                    if p[axis_i] < lo:
                        p[axis_i] = lo
                        v[axis_i] = abs(v[axis_i]) * 0.28
                    elif p[axis_i] > hi:
                        p[axis_i] = hi
                        v[axis_i] = -abs(v[axis_i]) * 0.28

                if entry["cool"] > 0:
                    entry["cool"] -= 1
                elif v.length < args.catch_speed:
                    for hook_i, hook in enumerate(hooks):
                        if any(other["hook"] == hook_i for other in state):
                            continue
                        target = hang_point(args, hook, offsets[hook_i])
                        # Caught on what the camera sees: the peg has to be
                        # inside the ring's hole on screen, and the ring has
                        # to be near enough in depth to be threaded on it.
                        flat = Vector((p.x - target.x, 0.0, p.z - target.z))
                        if flat.length < catch and \
                                abs(p.y - target.y) < radius * 0.9:
                            entry["hook"] = hook_i
                            break

            # Orientation. A free ring spins slowly in its own plane and
            # wobbles; a hooked one eases square to the peg it is on.
            euler = entry["euler"]
            euler.y += entry["spin"] * dt
            if entry["hook"] is None:
                euler.x += (0.35 * math.sin(phase * 2.0 + index) -
                            euler.x) * 1.4 * dt
                euler.z += (0.25 * math.sin(phase + index * 1.7) -
                            euler.z) * 1.2 * dt
            else:
                target_x = -math.radians(args.hook_tilt)
                euler.x += (target_x - euler.x) * 5.0 * dt
                euler.z += (0.0 - euler.z) * 5.0 * dt

            quaternion = Euler((euler.x, euler.y, euler.z), "XYZ").to_quaternion()
            tracks[index].append((p.copy(), quaternion))

        if frame % 60 == 0:
            print(f"[ringtoy]   frame {frame}/{total}")

    rewind = args.rewind
    for index, ring in enumerate(rings):
        poses = tracks[index][first - 1:]
        n = len(poses)
        if rewind > 0 and n > rewind:
            start = n - rewind
            target_loc, target_rot = poses[0]
            for i in range(start, n):
                # +1 in the numerator and denominator so the weight is short
                # of 1 on the final frame: frame n-1 steps *into* frame 0
                # rather than duplicating it.
                w = smoothstep((i - start + 1) / (rewind + 1))
                location, rotation = poses[i]
                poses[i] = (location.lerp(target_loc, w),
                            rotation.slerp(target_rot, w))

        ring.rotation_mode = "QUATERNION"
        for i, (location, rotation) in enumerate(poses):
            ring.location = location
            ring.rotation_quaternion = rotation
            ring.keyframe_insert(data_path="location", frame=first + i)
            ring.keyframe_insert(data_path="rotation_quaternion",
                                 frame=first + i)

    landed = sum(1 for entry in state if entry["hook"] is not None)
    print(f"[ringtoy] baked {len(rings)} rings, {landed} on pegs at the end, "
          f"rewound over {rewind} frames")


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------


def build_scene(args) -> dict:
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = args.preroll + args.loop
    scene.gravity = (0.0, 0.0, -9.81)

    height = args.height if args.height > 0 else \
        args.width * (args.res_y / max(1, args.res_x))
    size = Vector((args.width, args.thickness, height))

    built = build_case(args, size)
    built["size"] = size
    built["scene"] = scene

    inner = built["interior"]
    fill_z = -inner.z * 0.5 + inner.z * args.fill

    built["plate"] = build_plate(args, built)
    built["fill_z"] = fill_z
    built.update(build_water(args, built, fill_z))

    hooks = build_hooks(args, built, fill_z)
    built["hooks"] = hooks
    built["rings"] = build_rings(args, built, fill_z, hooks)

    schedule = press_schedule(args)
    jets = build_jets(args, built, fill_z)
    built["jets"] = jets
    built["schedule"] = schedule
    built["drift"] = build_drift(args, inner)

    total = args.preroll + args.loop
    if not args.static:
        animate_jets(args, jets, schedule)
        animate_surface(args, built, schedule, total)
        animate_hooks(args, hooks, total)
        build_bubbles(args, built, jets, schedule, fill_z)

    build_camera(args, size)
    build_lighting(args, size)

    if args.static:
        print("[ringtoy] static look-dev: no physics, no bubbles")
    else:
        pressed = ", ".join(str(f) for f, _ in schedule) or "none"
        print(f"[ringtoy] {len(built['rings'])} rings, {len(hooks)} pegs, "
              f"presses at {pressed}")
    return built


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------


def render_loop(args, scene: bpy.types.Scene) -> None:
    """Render the loop window only; the pre-roll settles and is never seen."""
    scene.frame_start = args.preroll + 1
    scene.frame_end = args.preroll + args.loop
    bpy.ops.render.render(animation=True)


def encode(args) -> str | None:
    """Encode the sequence to mp4 through Blender's bundled FFmpeg."""
    paths = frame_paths(args)
    if not paths:
        print("[ringtoy] nothing to encode")
        return None

    scene = bpy.data.scenes.new("ringtoy_encode")
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = len(paths)
    scene.render.resolution_x = args.res_x
    scene.render.resolution_y = args.res_y
    scene.render.resolution_percentage = args.percent
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.ffmpeg.gopsize = 12
    out_path = os.path.join(bpy.path.abspath(args.out), "ringtoy_loop.mp4")
    scene.render.filepath = out_path

    editor = scene.sequence_editor_create()
    strip = editor.sequences.new_image(
        name="frames", filepath=paths[0], channel=1, frame_start=1)
    for path in paths[1:]:
        strip.elements.append(os.path.basename(path))
    strip.directory = os.path.dirname(paths[0]) + os.sep

    with bpy.context.temp_override(scene=scene):
        bpy.ops.render.render(animation=True, scene=scene.name)

    print(f"[ringtoy] wrote {out_path}")
    return out_path


# --------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    built = build_scene(args)
    configure_render(args, built["scene"])

    if not args.static and not args.no_sim:
        simulate_rings(args, built)

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(args.save_blend))
        print(f"[ringtoy] saved {args.save_blend}")

    if args.no_render:
        return

    render_loop(args, built["scene"])
    blend_seam(args)
    if args.encode:
        encode(args)


if __name__ == "__main__":
    main()
