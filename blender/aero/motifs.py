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


# --- materials ---------------------------------------------------------------


def iridescent_bubble(
    name: str = "AeroBubble",
    strength: float = 2.6,
    hue_spread: float = 0.42,
    hue_base: float = 0.48,
) -> bpy.types.Material:
    """
    A bubble with a hue that travels around its rim and a hard specular dot.

    The plain white ring this replaces was correct and characterless. What
    makes a bubble read as *this* aesthetic rather than as a physics diagram is
    two things, and neither is subtle:

    Iridescence. A soap film is a thin-film interferometer, so its rim runs
    through hue as the film thickness varies around it. Sampling the angle
    around the centre and driving hue with it is a cheap stand-in for that, and
    at the size these render it is indistinguishable from the real thing.

    A specular dot. One small hard highlight, up and to the left, where the key
    light reflects off the sphere. It costs four nodes and it is the single
    strongest cue that the thing is a sphere and not a printed circle — every
    glossy icon of the era has the same dot in the same place, which is not a
    coincidence.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (900, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-900, 0))

    centred = _new(nodes, "ShaderNodeVectorMath", (-740, 0))
    centred.operation = "SUBTRACT"
    centred.inputs[1].default_value = (0.5, 0.5, 0.0)
    links.new(coords.outputs["UV"], centred.inputs[0])

    radius = _new(nodes, "ShaderNodeVectorMath", (-580, 80))
    radius.operation = "LENGTH"
    links.new(centred.outputs["Vector"], radius.inputs[0])

    # The rim: a bright annulus just inside the edge.
    ring = _new(nodes, "ShaderNodeValToRGB", (-400, 80))
    ring.color_ramp.interpolation = "EASE"
    elements = ring.color_ramp.elements
    elements[0].position = 0.0
    elements[0].color = (0.0, 0.0, 0.0, 1.0)
    elements[1].position = 0.5
    elements[1].color = (0.0, 0.0, 0.0, 1.0)
    inner = elements.new(0.28)
    inner.color = (0.06, 0.06, 0.06, 1.0)
    crest = elements.new(0.43)
    crest.color = (1.0, 1.0, 1.0, 1.0)
    links.new(radius.outputs["Value"], ring.inputs["Fac"])

    # Hue from the angle around the centre.
    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-580, -180))
    links.new(centred.outputs["Vector"], separate.inputs["Vector"])

    angle = _new(nodes, "ShaderNodeMath", (-400, -180))
    angle.operation = "ARCTAN2"
    links.new(separate.outputs["Y"], angle.inputs[0])
    links.new(separate.outputs["X"], angle.inputs[1])

    to_hue = _new(nodes, "ShaderNodeMapRange", (-220, -180))
    to_hue.inputs["From Min"].default_value = -math.pi
    to_hue.inputs["From Max"].default_value = math.pi
    to_hue.inputs["To Min"].default_value = hue_base - hue_spread / 2
    to_hue.inputs["To Max"].default_value = hue_base + hue_spread / 2
    links.new(angle.outputs["Value"], to_hue.inputs["Value"])

    tint = _new(nodes, "ShaderNodeCombineColor", (-40, -180))
    tint.mode = "HSV"
    tint.inputs["Green"].default_value = 0.55  # saturation
    tint.inputs["Blue"].default_value = 1.0  # value
    links.new(to_hue.outputs["Result"], tint.inputs["Red"])

    # The specular dot, up and left of centre.
    dot_offset = _new(nodes, "ShaderNodeVectorMath", (-740, -420))
    dot_offset.operation = "SUBTRACT"
    dot_offset.inputs[1].default_value = (0.34, 0.66, 0.0)
    links.new(coords.outputs["UV"], dot_offset.inputs[0])

    dot_radius = _new(nodes, "ShaderNodeVectorMath", (-580, -420))
    dot_radius.operation = "LENGTH"
    links.new(dot_offset.outputs["Vector"], dot_radius.inputs[0])

    dot = _new(nodes, "ShaderNodeMapRange", (-400, -420))
    dot.interpolation_type = "SMOOTHSTEP"
    dot.inputs["From Min"].default_value = 0.11
    dot.inputs["From Max"].default_value = 0.02
    dot.inputs["To Min"].default_value = 0.0
    dot.inputs["To Max"].default_value = 1.0
    dot.clamp = True
    links.new(dot_radius.outputs["Value"], dot.inputs["Value"])

    mask = _new(nodes, "ShaderNodeMath", (-40, 80))
    mask.operation = "MAXIMUM"
    links.new(ring.outputs["Color"], mask.inputs[0])
    links.new(dot.outputs["Result"], mask.inputs[1])

    # The dot is white; the rim carries the hue.
    colour = _new(nodes, "ShaderNodeMix", (180, -80))
    colour.data_type = "RGBA"
    _typed(colour.inputs, "B", "RGBA").default_value = (1.0, 1.0, 1.0, 1.0)
    links.new(dot.outputs["Result"], _typed(colour.inputs, "Factor", "VALUE"))
    links.new(tint.outputs["Color"], _typed(colour.inputs, "A", "RGBA"))

    emission = _new(nodes, "ShaderNodeEmission", (420, 60))
    emission.inputs["Strength"].default_value = strength
    links.new(_typed(colour.outputs, "Result", "RGBA"), emission.inputs["Color"])

    fade = _new(nodes, "ShaderNodeValue", (180, -320))
    fade.name = "BubbleFade"
    fade.label = "BubbleFade"
    fade.outputs["Value"].default_value = 1.0

    gate = _new(nodes, "ShaderNodeMath", (420, -220))
    gate.operation = "MULTIPLY"
    links.new(mask.outputs["Value"], gate.inputs[0])
    links.new(fade.outputs["Value"], gate.inputs[1])

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (420, -400))
    mix = _new(nodes, "ShaderNodeMixShader", (700, 0))
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
