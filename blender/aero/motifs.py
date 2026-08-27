"""
The Frutiger Aero vocabulary.

The scene in `deepfield.py` had the right structure and no personality. It was
a legible, tasteful, correctly-graded body of water, and legible tasteful water
is not the aesthetic — it is what the aesthetic looks like with everything
characteristic removed.

Frutiger Aero is maximalist. Its whole vocabulary is a short list of motifs
that appear together, loudly, in almost every image anyone remembers:

    iridescent bubbles, big and overlapping
    lens flare — anamorphic streak, hexagonal ghosts, a hard star
    swept glass ribbons with chromatic edges
    tropical fish
    green: leaves, grass, weed, the shallow end of the water
    gloss on everything

This module builds them. The composition rule from `deepfield.py` still holds —
the icon band stays low in value — but "low in value" was never the same
instruction as "empty", and the first build confused the two.
"""

from __future__ import annotations

import math

import bmesh
import bpy

from .materials import _new, _set


def _typed(sockets, name: str, kind: str):
    """
    Pick a socket by name *and* type.

    The Mix node carries one set of sockets per data type and gives them all
    the same names, so `node.inputs["A"]` silently returns the float A even
    when the node is set to RGBA. Looking the type up as well is the only way
    to address the one that is actually wired.
    """
    for socket in sockets:
        if socket.name == name and socket.type == kind:
            return socket
    raise KeyError(f"no {kind} socket named {name!r}")


def _smoothstep(nodes, links, value_socket, low: float, high: float, location):
    """
    A clamped 0 -> 1 smoothstep node, wired to `value_socket`.

    Always low-to-high with clamping on, because the alternative — inverted
    ranges and B-spline colour ramps — is where this material's two worst bugs
    came from, and neither was visible until a bubble was rendered on its own
    at three hundred pixels.
    """
    node = _new(nodes, "ShaderNodeMapRange", location)
    node.interpolation_type = "SMOOTHSTEP"
    node.inputs["From Min"].default_value = low
    node.inputs["From Max"].default_value = high
    node.inputs["To Min"].default_value = 0.0
    node.inputs["To Max"].default_value = 1.0
    node.clamp = True
    links.new(value_socket, node.inputs["Value"])
    return node


# --- materials ---------------------------------------------------------------


def iridescent_bubble(
    name: str = "AeroBubble",
    strength: float = 2.6,
    hue_spread: float = 0.30,
    hue_base: float = 0.50,
    light_angle: float = 2.36,  # up and to the left, matching the key
) -> bpy.types.Material:
    """
    A soap bubble: a bright rim, a specular arc *on* that rim, and a faint
    interior so it is not a hole.

    The previous version made eyeballs. Not approximately — exactly. It had a
    transparent centre, which against dark water reads as a black disc; a
    saturated coloured annulus around it; and a small round white highlight
    floating at 0.23 of the radius, well inside the ring. Pupil, iris,
    catchlight. Every element was individually defensible and together they
    spelled something nobody wanted on their home screen.

    What actually distinguishes a bubble from an eye is where the highlight
    sits. A sphere's specular reflection lies *on the surface*, so at this
    viewing angle it appears as a short bright arc riding the rim — not as a
    disc in the middle, which is what a wet cornea does and a soap film never
    does. So the highlight here is the rim masked to a narrow angular window.

    Three further changes keep it from drifting back:

      - the rim is asymmetric, brightest opposite the key, because a thin
        transparent shell lenses light toward its far edge;
      - a faint wash across the whole disc, so the interior is a pale film
        rather than a void with a ring drawn round it;
      - much less saturation in the hue sweep. A strongly coloured annulus is
        an iris; real iridescence is a subtle shift across part of the rim.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (1100, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-1100, 0))

    centred = _new(nodes, "ShaderNodeVectorMath", (-940, 0))
    centred.operation = "SUBTRACT"
    centred.inputs[1].default_value = (0.5, 0.5, 0.0)
    links.new(coords.outputs["UV"], centred.inputs[0])

    radius = _new(nodes, "ShaderNodeVectorMath", (-780, 120))
    radius.operation = "LENGTH"
    links.new(centred.outputs["Vector"], radius.inputs[0])

    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-780, -200))
    links.new(centred.outputs["Vector"], separate.inputs["Vector"])

    angle = _new(nodes, "ShaderNodeMath", (-620, -200))
    angle.operation = "ARCTAN2"
    links.new(separate.outputs["Y"], angle.inputs[0])
    links.new(separate.outputs["X"], angle.inputs[1])

    # --- the mask ------------------------------------------------------------
    #
    # Built from clamped Map Range ramps rather than colour ramps. A B-spline
    # colour ramp does not pass through its own control points and does not
    # settle to the end stop's value outside them, so the "black at 0.30, white
    # at 0.44, black at 0.50" spline was leaking about 0.2 of grey across the
    # entire quad — which rendered as a pale square box around every bubble.
    # Every ramp below runs low-to-high with clamping on, so what happens
    # outside its range is not a matter of opinion.

    inner = _smoothstep(nodes, links, radius.outputs["Value"], 0.395, 0.455, (-600, 300))
    outer = _smoothstep(nodes, links, radius.outputs["Value"], 0.468, 0.500, (-600, 160))

    outer_flip = _new(nodes, "ShaderNodeMath", (-430, 160))
    outer_flip.operation = "SUBTRACT"
    outer_flip.inputs[0].default_value = 1.0
    links.new(outer.outputs["Result"], outer_flip.inputs[1])

    rim = _new(nodes, "ShaderNodeMath", (-270, 230))
    rim.operation = "MULTIPLY"
    links.new(inner.outputs["Result"], rim.inputs[0])
    links.new(outer_flip.outputs["Value"], rim.inputs[1])

    # Brighter opposite the key: a thin shell lenses light to its far edge.
    lean = _new(nodes, "ShaderNodeMath", (-440, -200))
    lean.operation = "SUBTRACT"
    lean.inputs[1].default_value = light_angle + 3.14159265
    links.new(angle.outputs["Value"], lean.inputs[0])

    lean_cos = _new(nodes, "ShaderNodeMath", (-280, -200))
    lean_cos.operation = "COSINE"
    links.new(lean.outputs["Value"], lean_cos.inputs[0])

    lean_mix = _new(nodes, "ShaderNodeMapRange", (-120, -200))
    lean_mix.inputs["From Min"].default_value = -1.0
    lean_mix.inputs["From Max"].default_value = 1.0
    lean_mix.inputs["To Min"].default_value = 0.12
    lean_mix.inputs["To Max"].default_value = 1.0
    lean_mix.clamp = True
    links.new(lean_cos.outputs["Value"], lean_mix.inputs["Value"])

    rim_shaded = _new(nodes, "ShaderNodeMath", (60, 230))
    rim_shaded.operation = "MULTIPLY"
    links.new(rim.outputs["Value"], rim_shaded.inputs[0])
    links.new(lean_mix.outputs["Result"], rim_shaded.inputs[1])

    # The specular arc: the same rim, masked to the sector facing the light.
    # On the rim rather than inside it — that placement is the whole difference
    # between a bubble and an eye.
    spec_angle = _new(nodes, "ShaderNodeMath", (-440, -420))
    spec_angle.operation = "SUBTRACT"
    spec_angle.inputs[1].default_value = light_angle
    links.new(angle.outputs["Value"], spec_angle.inputs[0])

    spec_cos = _new(nodes, "ShaderNodeMath", (-280, -420))
    spec_cos.operation = "COSINE"
    links.new(spec_angle.outputs["Value"], spec_cos.inputs[0])

    spec_window = _smoothstep(nodes, links, spec_cos.outputs["Value"], 0.55, 0.97, (-120, -420))

    arc = _new(nodes, "ShaderNodeMath", (60, -420))
    arc.operation = "MULTIPLY"
    links.new(rim.outputs["Value"], arc.inputs[0])
    links.new(spec_window.outputs["Result"], arc.inputs[1])

    arc_hot = _new(nodes, "ShaderNodeMath", (220, -420))
    arc_hot.operation = "MULTIPLY"
    arc_hot.inputs[1].default_value = 1.35
    links.new(arc.outputs["Value"], arc_hot.inputs[0])

    # A faint film across the disc, so the interior is glass and not a hole.
    disc = _smoothstep(nodes, links, radius.outputs["Value"], 0.44, 0.50, (-600, 430))
    fill = _new(nodes, "ShaderNodeMath", (-430, 430))
    fill.operation = "MULTIPLY_ADD"
    fill.inputs[1].default_value = -0.022
    fill.inputs[2].default_value = 0.022
    links.new(disc.outputs["Result"], fill.inputs[0])

    body = _new(nodes, "ShaderNodeMath", (240, 330))
    body.operation = "ADD"
    links.new(rim_shaded.outputs["Value"], body.inputs[0])
    links.new(fill.outputs["Value"], body.inputs[1])

    mask = _new(nodes, "ShaderNodeMath", (400, 230))
    mask.operation = "ADD"
    links.new(body.outputs["Value"], mask.inputs[0])
    links.new(arc_hot.outputs["Value"], mask.inputs[1])

    clamped = _new(nodes, "ShaderNodeMath", (560, 230))
    clamped.operation = "MINIMUM"
    clamped.inputs[1].default_value = 1.0
    links.new(mask.outputs["Value"], clamped.inputs[0])

    # --- colour --------------------------------------------------------------
    # Hue driven by the cosine of the angle, not the angle itself. Mapping raw
    # atan2 output onto a hue range puts a discontinuity along the negative x
    # axis — hue jumps from one end of the range to the other — and it showed
    # as a hard line running out of the centre of every bubble. A cosine is
    # periodic, so the sweep closes on itself and there is no seam to find.
    hue_wave = _new(nodes, "ShaderNodeMath", (-440, -60))
    hue_wave.operation = "COSINE"
    links.new(angle.outputs["Value"], hue_wave.inputs[0])

    to_hue = _new(nodes, "ShaderNodeMapRange", (-280, -60))
    to_hue.inputs["From Min"].default_value = -1.0
    to_hue.inputs["From Max"].default_value = 1.0
    to_hue.inputs["To Min"].default_value = hue_base - hue_spread / 2
    to_hue.inputs["To Max"].default_value = hue_base + hue_spread / 2
    to_hue.clamp = True
    links.new(hue_wave.outputs["Value"], to_hue.inputs["Value"])

    tint = _new(nodes, "ShaderNodeCombineColor", (-100, -60))
    tint.mode = "HSV"
    tint.inputs["Green"].default_value = 0.22
    tint.inputs["Blue"].default_value = 1.0
    links.new(to_hue.outputs["Result"], tint.inputs["Red"])

    # The arc is white; the rest carries the faint hue.
    colour = _new(nodes, "ShaderNodeMix", (240, -60))
    colour.data_type = "RGBA"
    _typed(colour.inputs, "B", "RGBA").default_value = (1.0, 1.0, 1.0, 1.0)
    links.new(arc_hot.outputs["Value"], _typed(colour.inputs, "Factor", "VALUE"))
    links.new(tint.outputs["Color"], _typed(colour.inputs, "A", "RGBA"))

    emission = _new(nodes, "ShaderNodeEmission", (620, -60))
    emission.inputs["Strength"].default_value = strength
    links.new(_typed(colour.outputs, "Result", "RGBA"), emission.inputs["Color"])

    fade = _new(nodes, "ShaderNodeValue", (560, -300))
    fade.name = "BubbleFade"
    fade.label = "BubbleFade"
    fade.outputs["Value"].default_value = 1.0

    gate = _new(nodes, "ShaderNodeMath", (760, -200))
    gate.operation = "MULTIPLY"
    links.new(clamped.outputs["Value"], gate.inputs[0])
    links.new(fade.outputs["Value"], gate.inputs[1])

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (760, -400))
    mix = _new(nodes, "ShaderNodeMixShader", (940, 0))
    links.new(gate.outputs["Value"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def flare_element(
    name: str,
    colour: tuple[float, float, float, float],
    strength: float,
    aspect: float = 1.0,
    falloff: float = 2.0,
) -> bpy.types.Material:
    """
    One piece of a lens flare: a soft elliptical glow.

    `aspect` stretches it horizontally, which is the only difference between a
    ghost and an anamorphic streak — a streak is a ghost at aspect 40.

    Doing this with geometry rather than in the compositor is not a compromise
    here. The compositor is unavailable without a GPU context, and a flare made
    of objects sits *in* the scene: it is occluded by things in front of it and
    it moves correctly with the camera, which a screen-space flare never does.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-700, 0))

    centred = _new(nodes, "ShaderNodeVectorMath", (-540, 0))
    centred.operation = "SUBTRACT"
    centred.inputs[1].default_value = (0.5, 0.5, 0.0)
    links.new(coords.outputs["UV"], centred.inputs[0])

    squash = _new(nodes, "ShaderNodeVectorMath", (-380, 0))
    squash.operation = "MULTIPLY"
    squash.inputs[1].default_value = (1.0 / aspect, 1.0, 0.0)
    links.new(centred.outputs["Vector"], squash.inputs[0])

    radius = _new(nodes, "ShaderNodeVectorMath", (-220, 0))
    radius.operation = "LENGTH"
    links.new(squash.outputs["Vector"], radius.inputs[0])

    fade = _new(nodes, "ShaderNodeMapRange", (-60, 0))
    fade.interpolation_type = "SMOOTHSTEP"
    fade.inputs["From Min"].default_value = 0.5
    fade.inputs["From Max"].default_value = 0.0
    fade.inputs["To Min"].default_value = 0.0
    fade.inputs["To Max"].default_value = 1.0
    fade.clamp = True
    links.new(radius.outputs["Value"], fade.inputs["Value"])

    shape = _new(nodes, "ShaderNodeMath", (120, 0))
    shape.operation = "POWER"
    shape.inputs[1].default_value = falloff
    links.new(fade.outputs["Result"], shape.inputs[0])

    emission = _new(nodes, "ShaderNodeEmission", (320, 80))
    emission.inputs["Color"].default_value = colour
    emission.inputs["Strength"].default_value = strength

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (320, -120))
    mix = _new(nodes, "ShaderNodeMixShader", (460, 0))
    links.new(shape.outputs["Value"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def ribbon_glass(name: str = "RibbonGlass") -> bpy.types.Material:
    """
    The swept glass ribbon — the Aero motif proper.

    Not the icons' glass. The tiles are filled lozenges of coloured water; this
    is a thin sheet, almost colourless in the middle, whose entire presence is
    in the chromatic fringe along its edges. Driving hue from facing ratio gets
    that: face-on the sheet nearly disappears, and at grazing angles it flares
    green through cyan into violet, which is what a dispersive edge does and
    what every Vista-era wallpaper put at the centre of the frame.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (700, 0))
    principled = _new(nodes, "ShaderNodeBsdfPrincipled", (420, 0))
    _set(principled, "Base Color", (0.78, 0.94, 1.0, 1.0))
    _set(principled, "Roughness", 0.03)
    _set(principled, ("Transmission Weight", "Transmission"), 1.0)
    _set(principled, "IOR", 1.34)
    _set(principled, ("Coat Weight", "Clearcoat"), 1.0)

    facing = _new(nodes, "ShaderNodeLayerWeight", (-400, -140))
    facing.inputs["Blend"].default_value = 0.42

    hue = _new(nodes, "ShaderNodeMapRange", (-220, -140))
    hue.inputs["From Min"].default_value = 0.15
    hue.inputs["From Max"].default_value = 1.0
    hue.inputs["To Min"].default_value = 0.30  # green
    hue.inputs["To Max"].default_value = 0.78  # violet
    hue.clamp = True
    links.new(facing.outputs["Facing"], hue.inputs["Value"])

    fringe = _new(nodes, "ShaderNodeCombineColor", (-40, -140))
    fringe.mode = "HSV"
    fringe.inputs["Green"].default_value = 0.7
    fringe.inputs["Blue"].default_value = 1.0
    links.new(hue.outputs["Result"], fringe.inputs["Red"])

    glow = _new(nodes, "ShaderNodeMapRange", (-220, -360))
    glow.inputs["From Min"].default_value = 0.35
    glow.inputs["From Max"].default_value = 1.0
    glow.inputs["To Min"].default_value = 0.0
    glow.inputs["To Max"].default_value = 3.4
    glow.clamp = True
    links.new(facing.outputs["Facing"], glow.inputs["Value"])

    emission_colour = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
    if emission_colour is not None:
        links.new(fringe.outputs["Color"], emission_colour)
    emission_strength = principled.inputs.get("Emission Strength")
    if emission_strength is not None:
        links.new(glow.outputs["Result"], emission_strength)

    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def silhouette(
    name: str,
    colour: tuple[float, float, float, float] = (0.016, 0.098, 0.157, 1.0),
    rim: tuple[float, float, float, float] = (0.235, 0.741, 0.702, 1.0),
    rim_strength: float = 1.1,
) -> bpy.types.Material:
    """
    A dark shape with a lit edge — weed, fronds, fish.

    Nearly black through the body so it never competes with the icons, and
    rim-lit in a green-teal so it still reads as a living thing rather than as
    a hole in the picture. The green matters: Frutiger Aero is blue *and*
    green, and a purely blue scene is missing half the palette.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    principled = _new(nodes, "ShaderNodeBsdfPrincipled", (360, 0))
    _set(principled, "Base Color", colour)
    _set(principled, "Roughness", 0.42)
    _set(principled, ("Emission Color", "Emission"), rim)

    facing = _new(nodes, "ShaderNodeLayerWeight", (-100, -180))
    facing.inputs["Blend"].default_value = 0.28
    edge = _new(nodes, "ShaderNodeMapRange", (120, -180))
    edge.inputs["From Min"].default_value = 0.4
    edge.inputs["From Max"].default_value = 1.0
    edge.inputs["To Min"].default_value = 0.0
    edge.inputs["To Max"].default_value = rim_strength
    edge.clamp = True
    links.new(facing.outputs["Facing"], edge.inputs["Value"])

    strength = principled.inputs.get("Emission Strength")
    if strength is not None:
        links.new(edge.outputs["Result"], strength)

    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


# --- geometry ----------------------------------------------------------------


def ribbon(
    name: str,
    length: float = 34.0,
    width: float = 2.6,
    segments: int = 96,
    amplitude: float = 3.2,
    twist: float = 2.4,
    waves: float = 1.6,
) -> bpy.types.Object:
    """
    A long strip of glass, swept along a sine and twisted as it goes.

    Built as an explicit strip rather than a curve with a bevel, because the
    twist has to be a known function of position along the ribbon: the whole
    look depends on the sheet turning through face-on and edge-on repeatedly,
    which is what makes the chromatic fringe come and go along its length.
    """
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    rows = []
    for i in range(segments + 1):
        t = i / segments
        x = (t - 0.5) * length
        z = amplitude * math.sin(t * math.tau * waves)
        y = amplitude * 0.35 * math.cos(t * math.tau * waves * 0.5)

        roll = t * math.tau * twist
        half = width / 2.0
        # The strip's cross-section, rotated about the sweep direction.
        dz = math.cos(roll) * half
        dy = math.sin(roll) * half
        rows.append(
            (
                bm.verts.new((x, y - dy, z - dz)),
                bm.verts.new((x, y + dy, z + dz)),
            )
        )

    for i in range(segments):
        a, b = rows[i]
        c, d = rows[i + 1]
        bm.faces.new((a, b, d, c))

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def fish(name: str, length: float = 0.6) -> bpy.types.Object:
    """
    A fish, as a flat profile.

    Seen from the side at distance and thrown out of focus, a tropical fish is
    a silhouette with a forked tail — the body is an ellipse and the tail is
    two triangles, and nothing further survives the blur. Modelling more of one
    would be work that the aperture immediately throws away.
    """
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    body = []
    steps = 22
    for i in range(steps):
        t = i / steps * math.tau
        # A teardrop: wider at the head, tapering toward the tail.
        taper = 0.5 + 0.5 * math.cos(t)
        x = math.cos(t) * 0.5
        y = math.sin(t) * 0.26 * (0.45 + 0.55 * taper)
        body.append(bm.verts.new((x * length, 0.0, y * length)))
    bm.faces.new(body)

    # The tail has to clear the body's own outline or the two read as one
    # teardrop and the fish becomes a leaf. It starts behind where the body
    # ends, and the fork is deep enough to survive being a few pixels wide.
    tail = [
        bm.verts.new((-0.34 * length, 0.0, 0.0)),
        bm.verts.new((-0.86 * length, 0.0, 0.38 * length)),
        bm.verts.new((-0.62 * length, 0.0, 0.0)),
        bm.verts.new((-0.86 * length, 0.0, -0.38 * length)),
    ]
    bm.faces.new(tail)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def frond(name: str, height: float = 5.0, width: float = 0.5, segments: int = 14) -> bpy.types.Object:
    """
    One blade of weed, tapering from base to tip with a lean in it.

    Rooted below the bottom of frame so the base is never seen: what appears is
    a shape growing in from the edge, which is what fills the dead strip behind
    a dock without putting anything there to look at.
    """
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm = bmesh.new()

    rows = []
    for i in range(segments + 1):
        t = i / segments
        taper = (1.0 - t) ** 0.7
        lean = math.sin(t * math.pi * 0.75) * height * 0.22
        z = t * height
        half = width * taper / 2.0
        rows.append(
            (
                bm.verts.new((lean - half, 0.0, z)),
                bm.verts.new((lean + half, 0.0, z)),
            )
        )

    for i in range(segments):
        a, b = rows[i]
        c, d = rows[i + 1]
        bm.faces.new((a, b, d, c))

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj
