"""Squircle liquid-shaker wallpaper — procedural Blender scene builder.

Builds, bakes and renders a phone-portrait loop of a clear squircle pouch
filled with a blue/teal gradient liquid, holographic star confetti and rising
bubbles. Every parameter is a CLI flag; nothing is hand-placed in the .blend.

Run headless:

    blender -b -P blender/liquid_shaker.py -- --out renders/shaker

Or against the `bpy` pip module:

    python blender/liquid_shaker.py --out renders/shaker

See blender/README.md for the flag reference and suggested quality presets.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------

# Sampled off the reference render: deep cornflower at the top of the pour,
# turning to a green-leaning teal where the liquid pools.
LIQUID_TOP = (0.106, 0.478, 0.949)
LIQUID_BOTTOM = (0.106, 0.831, 0.741)

# Holographic confetti hues. Object Info → Random picks one per flake.
CONFETTI_HUES = [
    (0.98, 0.93, 0.42),  # butter yellow
    (0.45, 0.93, 0.55),  # mint green
    (0.62, 0.86, 0.99),  # ice blue
    (0.99, 0.78, 0.92),  # candy pink
    (0.85, 0.99, 0.72),  # lime
]


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse our flags whether we are run through Blender or through `bpy`.

    `blender -b -P script.py -- --out x` puts our flags after a `--`; running
    the same file with a Python that has the `bpy` module installed puts them
    straight on argv. Anything before a `--` belongs to Blender, not us.
    """
    if argv is None:
        if "--" in sys.argv:
            argv = sys.argv[sys.argv.index("--") + 1:]
        elif os.path.basename(sys.argv[0]).startswith("blender"):
            argv = []  # launched by Blender with no flags of our own
        else:
            argv = sys.argv[1:]

    p = argparse.ArgumentParser(prog="liquid_shaker", description=__doc__)

    shape = p.add_argument_group("container")
    shape.add_argument("--shape", choices=["fullbleed", "pouch"],
                       default="fullbleed",
                       help="fullbleed: the pouch fills the frame with "
                            "squircle corners, so the render is a wallpaper. "
                            "pouch: a discrete squircle floating on the "
                            "backdrop, the product-shot framing")
    shape.add_argument("--corner", type=float, default=0.12,
                       help="fullbleed only: corner radius as a fraction of "
                            "the pouch's short side")
    shape.add_argument("--width", type=float, default=2.0,
                       help="pouch width in metres (X)")
    shape.add_argument("--height", type=float, default=0.0,
                       help="pouch height in metres (Z); 0 derives it from "
                            "the render aspect so the pouch fills the frame")
    shape.add_argument("--thickness", type=float, default=0.52,
                       help="pouch depth in metres (Y)")
    shape.add_argument("--squircle-n", type=float, default=4.0,
                       help="plan-view superellipse exponent; 2=circle, "
                            "4=squircle, 8=near-square")
    shape.add_argument("--profile-n", type=float, default=0.0,
                       help="edge profile exponent; higher = flatter faces "
                            "and a tighter rim. 0 picks a default for "
                            "--shape: 8 for fullbleed, where a fat rim "
                            "refracts long dark bands down both sides of the "
                            "frame, and 2.6 for the rounder pouch")
    shape.add_argument("--segments", type=int, default=96,
                       help="mesh resolution around the plan curve")
    shape.add_argument("--wall", type=float, default=0.045,
                       help="shell wall thickness in metres")
    shape.add_argument("--fill", type=float, default=0.86,
                       help="liquid fill level as a fraction of interior "
                            "height (0-1)")
    shape.add_argument("--density", type=float, default=5.0,
                       help="liquid absorption density; drives how saturated "
                            "the blue/teal reads through the pouch depth")

    payload = p.add_argument_group("payload")
    payload.add_argument("--confetti", type=int, default=900,
                         help="number of glitter flakes")
    payload.add_argument("--confetti-size", type=float, default=0.045)
    payload.add_argument("--bubbles", type=int, default=85)
    payload.add_argument("--bubble-size", type=float, default=0.042)

    motion = p.add_argument_group("motion")
    motion.add_argument("--loop", type=int, default=240,
                        help="frames in the finished loop")
    motion.add_argument("--preroll", type=int, default=60,
                        help="settle frames simulated before the loop starts; "
                             "never rendered")
    motion.add_argument("--shake", type=float, default=1.0,
                        help="shake intensity multiplier")
    motion.add_argument("--tilt", type=float, default=14.0,
                        help="peak tilt in degrees for the slow sway")
    motion.add_argument("--fps", type=int, default=30)

    sim = p.add_argument_group("simulation")
    sim.add_argument("--res", type=int, default=128,
                     help="fluid domain resolution (128 preview, 256+ final)")
    sim.add_argument("--cache", default="//cache/shaker",
                     help="fluid cache directory")
    sim.add_argument("--no-bake", action="store_true",
                     help="build the scene but skip the fluid bake")
    sim.add_argument("--static", action="store_true",
                     help="look-dev mode: no simulation at all. The pour "
                          "volume is rendered directly as the liquid, so "
                          "materials and lighting can be judged in seconds "
                          "instead of after a bake")

    out = p.add_argument_group("output")
    out.add_argument("--out", default="//renders/shaker",
                     help="output directory for the frame sequence")
    out.add_argument("--res-x", type=int, default=1080)
    out.add_argument("--res-y", type=int, default=2400)
    out.add_argument("--samples", type=int, default=192)
    out.add_argument("--percent", type=int, default=100,
                     help="resolution percentage; 25 for fast look-dev")
    out.add_argument("--margin", type=float, default=0.0,
                     help="framing headroom around the pouch; 1.0 touches "
                          "the frame edges. 0 picks a default for --shape: "
                          "edge to edge for fullbleed, headroom for pouch")
    out.add_argument("--transparent", action="store_true",
                     help="render with a transparent film instead of the "
                          "white studio backdrop")
    out.add_argument("--backdrop", default="0.97,0.97,0.98",
                     help="backdrop colour as r,g,b in 0-1")
    out.add_argument("--env", type=float, default=2.4,
                     help="world lighting strength; drives how bright the "
                          "pouch's refracting rim reads")
    out.add_argument("--blend-frames", type=int, default=18,
                     help="frames crossfaded across the loop seam; 0 disables")
    out.add_argument("--encode", action="store_true",
                     help="encode an mp4 next to the frame sequence")
    out.add_argument("--no-render", action="store_true",
                     help="build (and optionally bake) but do not render")
    out.add_argument("--save-blend", default="",
                     help="write the built scene to this .blend path")
    out.add_argument("--device", choices=["CPU", "GPU"], default="CPU")
    out.add_argument("--view-transform", default="Khronos PBR Neutral",
                     choices=["Khronos PBR Neutral", "Standard", "AgX",
                              "Filmic"])
    out.add_argument("--exposure", type=float, default=0.0)

    args = p.parse_args(argv)
    if args.profile_n <= 0.0:
        args.profile_n = 8.0 if args.shape == "fullbleed" else 2.6
    return args


def clear_scene() -> None:
    """Empty the file so repeated runs in one session stay deterministic."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.collection.objects.link(obj)
    return obj


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def put(node: bpy.types.Node, names: tuple[str, ...], value) -> None:
    """Set the first socket that exists, so the script survives the socket
    renames between Blender 3.x and 4.x (Transmission → Transmission Weight)."""
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def rgba(colour: tuple[float, float, float], alpha: float = 1.0):
    return (colour[0], colour[1], colour[2], alpha)


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------


def _signed_pow(value: float, exponent: float) -> float:
    return math.copysign(abs(value) ** exponent, value)


def plan_curve(width: float, height: float, plan_n: float, corner: float,
               segments: int) -> list[tuple[float, float]]:
    """The pouch silhouette in the screen plane, centred on the origin.

    With `corner` at zero this is a plain superellipse — right for a squarish
    product-shot pouch. For a full-bleed wallpaper it is wrong: the exponent
    acts on coordinates normalised by the half-extents, so on a 1080×2400
    frame the rounding scales with each axis and the silhouette balloons into
    a lozenge. A fixed corner radius with straight edges between keeps the
    squircle read in the corners, where it is actually visible, at any aspect.
    """
    hw, hh = width * 0.5, height * 0.5
    e = 2.0 / plan_n

    if corner <= 0.0:
        pts = []
        for i in range(segments):
            u = 2 * math.pi * i / segments
            pts.append((hw * _signed_pow(math.cos(u), e),
                        hh * _signed_pow(math.sin(u), e)))
        return pts

    r = min(corner, hw * 0.999, hh * 0.999)
    per = max(4, segments // 4)
    pts = []

    # Four quarter-squircle corners, chained so the straight edges fall out
    # of the gaps between them.
    for cx, cz, sx, sz, swap in (
        (hw - r, hh - r, 1.0, 1.0, False),      # top-right
        (-(hw - r), hh - r, -1.0, 1.0, True),   # top-left
        (-(hw - r), -(hh - r), -1.0, -1.0, False),
        (hw - r, -(hh - r), 1.0, -1.0, True),
    ):
        for i in range(per + 1):
            t = (i / per) * math.pi / 2
            a = math.cos(t) ** e
            b = math.sin(t) ** e
            if swap:
                pts.append((cx + sx * r * b, cz + sz * r * a))
            else:
                pts.append((cx + sx * r * a, cz + sz * r * b))
    return pts


def pillow(name: str, plan: list[tuple[float, float]], thickness: float,
           profile_n: float, v_steps: int) -> bpy.types.Object:
    """Loft a plan curve into a pouch by bulging it through Y.

    The plan sits in the screen plane (XZ) and the depth runs along Y, so the
    camera looks at a flat face. Each ring scales the whole plan curve toward
    its centre by the profile term, which is what rolls the rim over;
    `profile_n` sets how flat the faces stay before that roll begins.
    """
    er = 2.0 / profile_n
    u_steps = len(plan)

    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []

    # v runs -pi/2..pi/2 (back face → rim → front face)
    for j in range(v_steps + 1):
        v = -math.pi / 2 + math.pi * j / v_steps
        cv = _signed_pow(math.cos(v), er)
        sv = _signed_pow(math.sin(v), er)
        for x, z in plan:
            verts.append(Vector((x * cv, thickness * 0.5 * sv, z * cv)))

    for j in range(v_steps):
        for i in range(u_steps):
            a = j * u_steps + i
            b = j * u_steps + (i + 1) % u_steps
            c = (j + 1) * u_steps + (i + 1) % u_steps
            d = (j + 1) * u_steps + i
            faces.append((a, b, c, d))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    # Poles collapse to a point; merging kills the resulting zero-area fans.
    obj = link(bpy.data.objects.new(name, mesh))
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    return obj


def cut_above(obj: bpy.types.Object, z: float, size: Vector) -> None:
    """Boolean the object down to everything below `z`, keeping it closed."""
    span = max(size.x, size.y, size.z) * 3.0
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    cutter = bpy.context.active_object
    cutter.name = f"{obj.name}_cutter"
    cutter.scale = (span, span, span)
    cutter.location = (0.0, 0.0, z - span * 0.5)

    activate(obj)
    mod = obj.modifiers.new("fill_level", "BOOLEAN")
    mod.operation = "INTERSECT"
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def _flake(name: str, rim: list[tuple[float, float]], thickness: float,
           spin: float, tilt: float) -> bpy.types.Object:
    """A flat flake in the YZ plane, facing local +X, with rotation baked in.

    Particle instancing aligns an instance's local +X with the particle
    direction, which for this rig is the camera axis — so a flake authored in
    the YZ plane renders face-on, and one authored in any other plane renders
    as an edge-on scratch.

    The catch is that `rotation_mode='NONE'` then applies *no* per-particle
    rotation at all: `phase_factor_random` and `rotation_factor_random` are
    both inert, and 900 identical stars all point the same way. The rotation
    modes that do randomise (GLOB_Y and friends) lose the camera-facing
    alignment. So the variation is baked into the geometry instead — several
    pre-rotated variants that the particle system picks between at random.
    """
    rot = Matrix.Rotation(spin, 3, "X") @ Matrix.Rotation(tilt, 3, "Z")
    verts = [rot @ Vector((0.0, y, z)) for y, z in rim]
    centre = rot @ Vector((0.0, 0.0, 0.0))
    verts.insert(0, centre)
    faces = [(0, i + 1, (i + 1) % len(rim) + 1) for i in range(len(rim))]

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = link(bpy.data.objects.new(name, mesh))
    activate(obj)
    solid = obj.modifiers.new("thickness", "SOLIDIFY")
    solid.thickness = thickness
    return obj


def confetti_star(name: str, radius: float, spin: float = 0.0,
                  tilt: float = 0.0) -> bpy.types.Object:
    """Flat five-point star — the dominant flake in the reference."""
    points = 5
    inner = radius * 0.44
    rim = []
    for i in range(points * 2):
        r = radius if i % 2 == 0 else inner
        a = math.pi / 2 + i * math.pi / points
        rim.append((r * math.cos(a), r * math.sin(a)))
    return _flake(name, rim, radius * 0.06, spin, tilt)


def confetti_shard(name: str, radius: float, spin: float = 0.0,
                   tilt: float = 0.0) -> bpy.types.Object:
    """Irregular flake — the reference mixes these in with the stars."""
    sides = 6
    rim = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        r = radius * (0.55 + 0.45 * ((i * 7) % 5) / 4.0)
        rim.append((r * math.cos(a), r * math.sin(a)))
    return _flake(name, rim, radius * 0.06, spin, tilt)


def flake_variants(radius: float) -> list[bpy.types.Object]:
    """The pick-list the confetti system instances from.

    Stars are five-fold symmetric, so spins only need to span 72° to cover
    every distinct orientation. A couple of variants carry a tilt as well, so
    a minority of flakes catch the light edge-on and the field reads as a
    volume rather than a decal sheet.
    """
    variants = []
    star_spins = 5
    for i in range(star_spins):
        spin = math.radians(72.0 * i / star_spins)
        tilt = math.radians(38.0) if i % 3 == 2 else 0.0
        variants.append(confetti_star(f"Confetti_Star_{i}", radius,
                                      spin, tilt))
    for i in range(2):
        variants.append(confetti_shard(
            f"Confetti_Shard_{i}", radius * 0.62,
            math.radians(37.0 * i), math.radians(24.0 * i)))
    return variants


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------


def new_material(name: str) -> tuple[bpy.types.Material, bpy.types.NodeTree]:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    return mat, tree


def shell_material() -> bpy.types.Material:
    """Thick optically clear casing — the moulded plastic of the pouch."""
    mat, tree = new_material("shaker_shell")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    out.location = (300, 0)

    put(bsdf, ("Base Color",), rgba((1.0, 1.0, 1.0)))
    put(bsdf, ("Roughness",), 0.015)
    put(bsdf, ("IOR",), 1.46)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    put(bsdf, ("Coat Weight", "Clearcoat"), 1.0)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.02)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def liquid_material(reference: bpy.types.Object, size: Vector,
                    density: float) -> bpy.types.Material:
    """Clear surface plus a graded volume — the blue-to-teal pour.

    The gradient lives in the volume rather than the surface so it reads as
    depth of liquid rather than as a painted-on ramp, and it stays correct
    when the fluid mesh deforms.

    Coordinates come from `reference` (the shell) rather than from whatever
    object carries the material. The fluid mesh and the static look-dev stand-
    in have completely different local spaces; anchoring both to the shell
    means `--static` previews the same gradient the baked sim will render.
    """
    mat, tree = new_material("shaker_liquid")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 200)
    put(bsdf, ("Base Color",), rgba((1.0, 1.0, 1.0)))
    put(bsdf, ("Roughness",), 0.02)
    put(bsdf, ("IOR",), 1.333)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-600, -200)
    coord.object = reference

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-400, -200)
    # Normalise the pouch to a unit box, then tilt the ramp so the teal
    # gathers toward the lower-left as in the reference, instead of banding
    # dead horizontally. Mapping scales before it rotates.
    mapping.inputs["Scale"].default_value = (1.0 / size.x, 1.0, 1.0 / size.z)
    mapping.inputs["Rotation"].default_value = (0.0, math.radians(-28.0), 0.0)
    mapping.inputs["Location"].default_value = (0.0, 0.0, 0.5)

    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-200, -420)

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (0, -200)
    ramp.color_ramp.elements[0].position = 0.15
    ramp.color_ramp.elements[0].color = rgba(LIQUID_BOTTOM)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = rgba(LIQUID_TOP)

    absorb = tree.nodes.new("ShaderNodeVolumeAbsorption")
    absorb.location = (300, -200)
    # The pouch is shallow, so the light path through the liquid is short.
    # Density has to be high for the tint to survive that thin a crossing.
    absorb.inputs["Density"].default_value = density

    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    tree.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], absorb.inputs["Color"])
    tree.links.new(absorb.outputs["Volume"], out.inputs["Volume"])
    return mat


def confetti_material() -> bpy.types.Material:
    """Holographic flakes — hue picked per particle, hard specular."""
    mat, tree = new_material("shaker_confetti")
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
    elements[0].color = rgba(CONFETTI_HUES[0])
    for i, hue in enumerate(CONFETTI_HUES[1:], start=1):
        element = elements.new(i / len(CONFETTI_HUES))
        element.color = rgba(hue)

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (200, 0)
    # Fully metallic flakes just mirror the backdrop and go white behind the
    # liquid. Backing metallic off keeps the picked hue visible, and the
    # emission carries it through the absorbing volume.
    put(bsdf, ("Metallic",), 0.35)
    put(bsdf, ("Roughness",), 0.1)
    put(bsdf, ("Coat Weight", "Clearcoat"), 1.0)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.05)
    put(bsdf, ("Emission Strength",), 0.9)

    tree.links.new(info.outputs["Random"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    emission = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    if emission is not None:
        tree.links.new(ramp.outputs["Color"], emission)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def bubble_material() -> bpy.types.Material:
    """Air pocket inside the pour.

    Cycles does not track nested dielectrics, so a bubble modelled with air's
    own IOR of 1.0 sitting inside liquid refracts as if the surrounding water
    were not there. The relative IOR — air over water, 1.0/1.333 — is what
    makes it bend light like a real bubble and pick up the bright rim.
    """
    mat, tree = new_material("shaker_bubble")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)

    fresnel = tree.nodes.new("ShaderNodeLayerWeight")
    fresnel.location = (-300, 0)
    fresnel.inputs["Blend"].default_value = 0.35

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-100, 0)
    ramp.color_ramp.elements[0].color = rgba((0.75, 0.95, 1.0))
    ramp.color_ramp.elements[1].color = rgba((0.95, 0.99, 1.0))

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)
    put(bsdf, ("Roughness",), 0.0)
    put(bsdf, ("IOR",), 1.0 / 1.333)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)

    tree.links.new(fresnel.outputs["Fresnel"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def backdrop_material(colour: tuple[float, float, float]) -> bpy.types.Material:
    """Emissive sweep.

    A diffuse plane only reaches white if it is blasted with light, which
    then blows out the pouch. Emitting the backdrop decouples the two: the
    background sits at a clean value and doubles as the soft source the
    glass refracts.
    """
    mat, tree = new_material("shaker_backdrop")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    emit = tree.nodes.new("ShaderNodeEmission")
    emit.location = (-200, 0)
    emit.inputs["Color"].default_value = rgba(colour)
    emit.inputs["Strength"].default_value = 1.6
    tree.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------------------
# simulation
# --------------------------------------------------------------------------


def add_fluid(obj: bpy.types.Object, fluid_type: str):
    activate(obj)
    mod = obj.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = fluid_type
    return mod


def build_domain(args, size: Vector) -> bpy.types.Object:
    """Liquid domain sized to the pouch with a little headroom."""
    margin = 1.18
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    domain = bpy.context.active_object
    domain.name = "Shaker_Domain"
    domain.scale = (size.x * margin, size.y * margin, size.z * margin)
    # Wire in the viewport, but it must stay renderable: once baked, the
    # domain object *is* the liquid mesh.
    domain.display_type = "WIRE"

    mod = add_fluid(domain, "DOMAIN")
    settings = mod.domain_settings
    settings.domain_type = "LIQUID"
    settings.resolution_max = args.res
    settings.use_adaptive_timesteps = True
    settings.cfl_condition = 3.0
    settings.timesteps_min = 1
    settings.timesteps_max = 6
    settings.use_flip_particles = True
    settings.simulation_method = "FLIP"
    settings.flip_ratio = 0.97
    settings.particle_radius = 1.6
    settings.use_mesh = True
    settings.mesh_scale = 2
    settings.mesh_particle_radius = 2.0
    settings.use_diffusion = True
    settings.surface_tension = 0.28
    settings.viscosity_base = 1.2
    settings.viscosity_exponent = 4
    settings.cache_directory = args.cache
    settings.cache_type = "MODULAR"
    settings.cache_frame_start = 1
    settings.cache_frame_end = args.preroll + args.loop
    return domain


def build_scene(args) -> dict:
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = args.preroll + args.loop

    # A wallpaper fills the screen, so unless a height is given outright the
    # full-bleed pouch takes the render's aspect and the camera frames it edge
    # to edge. A product-shot pouch is squarish and sits in its own headroom,
    # so stretching it to the frame aspect would just make a capsule.
    if args.height > 0:
        height = args.height
    elif args.shape == "fullbleed":
        height = args.width * (args.res_y / max(1, args.res_x))
    else:
        height = args.width
    size = Vector((args.width, args.thickness, height))

    corner = 0.0 if args.shape == "pouch" else \
        args.corner * min(size.x, size.z)

    def build(name: str, w: float, h: float, t: float, rad: float,
              segments: int) -> bpy.types.Object:
        return pillow(name,
                      plan_curve(w, h, args.squircle_n, rad, segments),
                      t, args.profile_n, max(8, segments // 3))

    shell = build("Shaker_Shell", size.x, size.z, size.y, corner,
                  args.segments)
    shell.data.materials.append(shell_material())

    wall2 = args.wall * 2.0
    interior = Vector((size.x - wall2, size.y - wall2, size.z - wall2))
    # The cavity's corners tighten by exactly the wall thickness; scaling the
    # radius with the box instead would thin the corners of the casing.
    inner_corner = max(0.0, corner - args.wall) if corner > 0 else 0.0
    half_seg = max(32, args.segments // 2)

    liquid = liquid_material(shell, size, args.density)

    # Initial pour: the interior volume clipped to the fill line.
    #
    # For the sim it must sit just inside the effector or the two surfaces
    # interpenetrate on frame one. In static mode there is no effector, and
    # that same gap becomes an air pocket wrapping the pour — at grazing
    # angles down the sides it refracts to near-black, so the stand-in fills
    # the cavity outright.
    pour_scale = 1.0 if args.static else 0.985
    pour = build("Shaker_Pour", interior.x * pour_scale,
                 interior.z * pour_scale, interior.y * pour_scale,
                 inner_corner * pour_scale, half_seg)
    fill_z = -interior.z * 0.5 + interior.z * args.fill
    cut_above(pour, fill_z, interior)

    domain = None
    if args.static:
        # No sim: the pour volume *is* the liquid. Smooth normals so the
        # stand-in refracts like the fluid mesh will.
        pour.data.materials.append(liquid)
        activate(pour)
        bpy.ops.object.shade_smooth()
    else:
        pour.hide_render = True
        pour.display_type = "WIRE"
        flow_mod = add_fluid(pour, "FLOW")
        flow_mod.flow_settings.flow_type = "LIQUID"
        flow_mod.flow_settings.flow_behavior = "GEOMETRY"
        flow_mod.flow_settings.use_plane_init = False

        # The shell drives collisions from the inside; a shell-shaped effector
        # keeps the fluid off the flat faces the way a real pouch does.
        effector = build("Shaker_Effector", interior.x, interior.z,
                         interior.y, inner_corner, half_seg)
        effector.hide_render = True
        effector.display_type = "WIRE"
        eff_mod = add_fluid(effector, "EFFECTOR")
        eff_mod.effector_settings.effector_type = "COLLISION"
        eff_mod.effector_settings.use_plane_init = True
        eff_mod.effector_settings.surface_distance = 0.4

        domain = build_domain(args, size)
        domain.data.materials.append(liquid)

    payload = build_payload(args, interior, fill_z, inner_corner, build)
    build_camera(args, size)
    build_lighting(args, size)

    animate_gravity(args, scene)

    return {"scene": scene, "shell": shell, "domain": domain, "size": size,
            "interior": interior, **payload}


def build_payload(args, interior: Vector, fill_z: float, inner_corner: float,
                  build) -> dict:
    """Confetti and bubbles suspended in the liquid.

    Both emit from a static copy of the pour volume rather than from the
    simulated fluid mesh: Mantaflow's liquid mesh is rebuilt every frame, so
    particles emitted from it re-seed and flicker. Turbulence plus drag gives
    the suspended-in-gel drift the reference has, and the confetti reads as
    carried by the liquid without being bound to it.
    """
    emitter = build("Shaker_Payload_Volume", interior.x * 0.94,
                    interior.z * 0.94, interior.y * 0.94,
                    inner_corner * 0.94, 48)
    cut_above(emitter, fill_z, interior)
    emitter.display_type = "WIRE"
    # Hide the emitter shell itself without hiding what it emits. Setting
    # hide_render here instead would take the particles with it.
    emitter.show_instancer_for_render = False
    emitter.show_instancer_for_viewport = False

    variants = flake_variants(args.confetti_size)
    holo = confetti_material()
    for obj in variants:
        obj.data.materials.append(holo)

    # Instance sources live in a collection that is never linked to the
    # scene. Leaving them linked and setting hide_render would suppress the
    # instances as well as the originals; unlinking keeps the originals out
    # of frame while the particle system still renders them.
    assets = bpy.data.collections.new("Shaker_Assets")
    flakes = bpy.data.collections.new("Confetti_Flakes")
    assets.children.link(flakes)
    for obj in variants:
        bpy.context.collection.objects.unlink(obj)
        flakes.objects.link(obj)

    total = args.preroll + args.loop

    activate(emitter)
    emitter.modifiers.new("confetti", "PARTICLE_SYSTEM")
    confetti = emitter.particle_systems[-1].settings
    confetti.name = "confetti"
    confetti.type = "EMITTER"
    confetti.count = args.confetti
    confetti.frame_start = 1
    confetti.frame_end = 1          # all flakes exist from the first frame
    confetti.lifetime = total * 4
    confetti.emit_from = "VOLUME"
    confetti.distribution = "RAND"
    confetti.physics_type = "NEWTON"
    confetti.mass = 0.02
    confetti.particle_size = 1.0
    confetti.size_random = 0.55
    # NONE is what keeps every flake square to camera. Orientation variety
    # comes from the pre-rotated variants in `flakes`, not from here.
    confetti.use_rotations = True
    confetti.rotation_mode = "NONE"
    confetti.brownian_factor = 0.22
    confetti.drag_factor = 0.85
    confetti.damping = 0.55
    confetti.render_type = "COLLECTION"
    confetti.instance_collection = flakes
    confetti.use_collection_pick_random = True
    confetti.effector_weights.gravity = 0.06

    emitter.modifiers.new("bubbles", "PARTICLE_SYSTEM")
    bubbles = emitter.particle_systems[-1].settings
    bubbles.name = "bubbles"
    bubbles.type = "EMITTER"
    bubbles.count = args.bubbles
    bubbles.frame_start = 1
    bubbles.frame_end = 1
    bubbles.lifetime = total * 4
    bubbles.emit_from = "VOLUME"
    bubbles.distribution = "RAND"
    bubbles.physics_type = "NEWTON"
    bubbles.mass = 0.005
    bubbles.particle_size = 1.0
    bubbles.size_random = 0.7
    bubbles.brownian_factor = 0.12
    bubbles.drag_factor = 0.95
    bubbles.damping = 0.7
    bubbles.render_type = "OBJECT"
    # Negative gravity weight is the buoyancy: air rises through the pour.
    bubbles.effector_weights.gravity = -0.22

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,
                                          radius=args.bubble_size)
    bubble_obj = bpy.context.active_object
    bubble_obj.name = "Bubble"
    bubble_obj.data.materials.append(bubble_material())
    bpy.ops.object.shade_smooth()
    bpy.context.collection.objects.unlink(bubble_obj)
    assets.objects.link(bubble_obj)
    bubbles.instance_object = bubble_obj

    # Turbulence keeps the payload swirling instead of settling into a heap.
    bpy.ops.object.effector_add(type="TURBULENCE", location=(0, 0, 0))
    turbulence = bpy.context.active_object
    turbulence.name = "Payload_Turbulence"
    turbulence.field.strength = 2.4 * args.shake
    turbulence.field.size = 0.7
    turbulence.field.noise = 1.4
    turbulence.field.flow = 0.4

    bpy.ops.object.effector_add(type="DRAG", location=(0, 0, 0))
    drag = bpy.context.active_object
    drag.name = "Payload_Drag"
    drag.field.strength = 1.6
    drag.field.linear_drag = 1.2

    return {"emitter": emitter, "assets": assets, "flakes": flakes,
            "bubble": bubble_obj, "turbulence": turbulence, "drag": drag}


def build_camera(args, size: Vector) -> bpy.types.Object:
    """Orthographic front-on view. Portrait framing, pouch centred."""
    cam_data = bpy.data.cameras.new("Shaker_Cam")
    cam_data.type = "ORTHO"
    # ortho_scale always maps to the *longer* edge of the render. On a
    # portrait phone frame that is the height, so framing on height alone
    # crops the pouch sideways; solve for whichever axis is tighter.
    aspect = args.res_y / max(1, args.res_x)
    margin = args.margin if args.margin > 0 else (
        1.0 if args.shape == "fullbleed" else 1.28)
    cam_data.ortho_scale = max(size.z * margin, size.x * margin * aspect)
    cam = link(bpy.data.objects.new("Shaker_Cam", cam_data))
    cam.location = (0.0, -8.0, 0.0)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def build_lighting(args, size: Vector) -> None:
    """Three-point studio rig plus an optional white sweep behind."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Shaker_World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Bright, near-white environment. The pouch's rim rolls away from camera
    # and total-internal-reflects down the sides; whatever those rays end up
    # sampling is what the silhouette looks like. Against a dim world they
    # sample near-nothing and the edges read as black bands.
    bg.inputs["Color"].default_value = rgba((0.95, 0.97, 1.0))
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

    # Key: high and camera-left, the source of the big rim specular.
    area("Key", (-3.2, -4.2, 3.6),
         (math.radians(52), 0.0, math.radians(-38)), 4.0, 900)
    # Fill: soft, camera-right, opens up the teal side.
    area("Fill", (3.6, -3.4, -1.2),
         (math.radians(104), 0.0, math.radians(46)), 5.0, 320)
    # Back: drives light through the pouch so the liquid glows.
    area("Rim", (0.0, 5.5, 1.6),
         (math.radians(-108), 0.0, 0.0), 6.0, 1400)

    if args.transparent:
        scene.render.film_transparent = True
        return

    colour = tuple(float(c) for c in args.backdrop.split(","))
    backdrop = backdrop_material(colour)

    # Edge to edge, the pouch's rim curves away from camera and refracts
    # whatever sits beside and in front of it. A single plane behind leaves
    # that as unlit void — the dark bands down both sides. Boxing the pouch
    # in emissive panels gives the rim something bright to bend, which is
    # what a real product shot does with a light tent.
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
        panel.data.materials.append(backdrop)
        # Only the backdrop should be seen directly; the side panels exist to
        # be refracted and reflected, not to wash out the frame.
        if name != "Backdrop":
            panel.visible_camera = False


def animate_gravity(args, scene: bpy.types.Scene) -> None:
    """Keyframe world gravity into a shake that loops exactly.

    Every term is an integer harmonic of the loop length, so the gravity
    vector at the first rendered frame equals the vector one loop later. That
    makes the *forcing* perfectly periodic; the fluid state is only near
    periodic, which is what --blend-frames cleans up at the seam.
    """
    scene.use_gravity = True
    g = 9.81
    loop = float(args.loop)
    tilt = math.radians(args.tilt)

    for frame in range(1, args.preroll + args.loop + 2):
        # Pre-roll ramps the shake in from stillness so the liquid settles
        # before the loop window starts.
        if frame <= args.preroll:
            ramp = 0.0
        else:
            ramp = 1.0
        t = (frame - args.preroll - 1) / loop

        # Slow sway (1 cycle/loop) + a faster rattle (4 cycles/loop), with a
        # burst envelope that is zero at both ends of the loop.
        envelope = (0.5 - 0.5 * math.cos(2 * math.pi * t)) ** 1.5
        sway = tilt * math.sin(2 * math.pi * t)
        rattle = tilt * 0.75 * args.shake * envelope * math.sin(
            2 * math.pi * 4 * t)
        angle = (sway + rattle) * ramp

        # A little depth shove so the payload moves toward and away from the
        # camera rather than staying on a plane.
        depth = 2.2 * args.shake * envelope * ramp * math.sin(
            2 * math.pi * 3 * t)

        scene.gravity = (g * math.sin(angle), depth, -g * math.cos(angle))
        scene.keyframe_insert(data_path="gravity", frame=frame)

    if scene.animation_data and scene.animation_data.action:
        for fcurve in scene.animation_data.action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"


# --------------------------------------------------------------------------
# bake / render
# --------------------------------------------------------------------------


def bake(built: dict) -> None:
    domain = built["domain"]
    activate(domain)
    with bpy.context.temp_override(scene=bpy.context.scene, object=domain,
                                   active_object=domain,
                                   selected_objects=[domain]):
        bpy.ops.fluid.bake_all()


def configure_render(args, scene: bpy.types.Scene) -> None:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 24
    scene.cycles.transmission_bounces = 20
    scene.cycles.transparent_max_bounces = 24
    scene.cycles.volume_bounces = 4
    scene.cycles.blur_glossy = 0.5
    scene.cycles.device = args.device
    scene.render.resolution_x = args.res_x
    scene.render.resolution_y = args.res_y
    scene.render.resolution_percentage = args.percent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if args.transparent \
        else "RGB"
    scene.render.filepath = os.path.join(args.out, "frame_")
    # AgX rolls highlights off so hard that a white sweep lands mid-grey.
    # Khronos PBR Neutral is built for product renders: it holds saturated
    # transmission colour and still resolves the backdrop to white.
    try:
        scene.view_settings.view_transform = args.view_transform
    except TypeError:
        scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = args.exposure

    if args.device == "GPU":
        prefs = bpy.context.preferences.addons.get("cycles")
        if prefs is not None:
            cprefs = prefs.preferences
            for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                try:
                    cprefs.compute_device_type = backend
                except TypeError:
                    continue
                cprefs.get_devices()
                if any(d.type == backend for d in cprefs.devices):
                    for device in cprefs.devices:
                        device.use = device.type != "CPU"
                    break


def render_loop(args, scene: bpy.types.Scene) -> None:
    """Render only the loop window; the pre-roll is simulated, never shown."""
    scene.frame_start = args.preroll + 1
    scene.frame_end = args.preroll + args.loop
    bpy.ops.render.render(animation=True)


def frame_paths(args) -> list[str]:
    directory = bpy.path.abspath(args.out)
    if not os.path.isdir(directory):
        return []
    names = sorted(n for n in os.listdir(directory)
                   if n.startswith("frame_") and n.endswith(".png"))
    return [os.path.join(directory, n) for n in names]


def blend_seam(args) -> None:
    """Crossfade the loop seam.

    The last `n` rendered frames are dissolved into the first `n` and then
    discarded, so the sequence wraps without the small discontinuity a fluid
    sim leaves behind. Done with image pixel buffers rather than the VSE so it
    works the same headless.
    """
    n = args.blend_frames
    if n <= 0:
        return
    paths = frame_paths(args)
    if len(paths) < n * 2 + 1:
        print(f"[shaker] too few frames ({len(paths)}) to blend {n}; skipping")
        return

    import numpy as np

    head, tail = paths[:n], paths[-n:]
    for i, (head_path, tail_path) in enumerate(zip(head, tail)):
        # i=0 is almost entirely tail; i=n-1 is almost entirely head.
        alpha = (i + 1) / (n + 1)
        a = bpy.data.images.load(head_path)
        b = bpy.data.images.load(tail_path)
        pa = np.empty(len(a.pixels), dtype=np.float32)
        pb = np.empty(len(b.pixels), dtype=np.float32)
        a.pixels.foreach_get(pa)
        b.pixels.foreach_get(pb)
        a.pixels.foreach_set(pa * alpha + pb * (1.0 - alpha))
        a.filepath_raw = head_path
        a.file_format = "PNG"
        a.save()
        bpy.data.images.remove(a)
        bpy.data.images.remove(b)

    for path in tail:
        os.remove(path)
    print(f"[shaker] blended {n} seam frames; loop is {len(paths) - n} frames")


def encode(args) -> str | None:
    """Encode the sequence to mp4 through Blender's bundled FFmpeg."""
    paths = frame_paths(args)
    if not paths:
        print("[shaker] nothing to encode")
        return None

    scene = bpy.data.scenes.new("shaker_encode")
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
    out_path = os.path.join(bpy.path.abspath(args.out), "shaker_loop.mp4")
    scene.render.filepath = out_path

    editor = scene.sequence_editor_create()
    directory = os.path.dirname(paths[0])
    strip = editor.sequences.new_image(
        name="frames", filepath=paths[0], channel=1, frame_start=1)
    for path in paths[1:]:
        strip.elements.append(os.path.basename(path))
    strip.directory = directory + os.sep

    with bpy.context.temp_override(scene=scene):
        bpy.ops.render.render(animation=True, scene=scene.name)

    print(f"[shaker] wrote {out_path}")
    return out_path


# --------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    built = build_scene(args)
    configure_render(args, built["scene"])

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(args.save_blend))
        print(f"[shaker] saved {args.save_blend}")

    if args.static:
        print("[shaker] static look-dev mode: no simulation")
    elif not args.no_bake:
        print(f"[shaker] baking {args.preroll + args.loop} frames "
              f"at resolution {args.res}")
        bake(built)

    if args.no_render:
        return

    render_loop(args, built["scene"])
    blend_seam(args)
    if args.encode:
        encode(args)


if __name__ == "__main__":
    main()
