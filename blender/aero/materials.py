"""
Materials for the aqua tiles.

The rule the app runs on — code draws geometry, the model draws material —
inverts here, and on purpose. In 3D the material is the one thing a diffusion
model cannot supply: it has to respond to the scene's light from any angle and
stay identical between frame 1 and frame 300. So the glass is built from nodes
and the model's output is used for what it is genuinely good at, the glyph
plate on the face of the tile.

Socket names on the Principled BSDF moved in Blender 4.0 (`Transmission` became
`Transmission Weight`, and the emission sockets were renamed). `_set` tries
each known spelling so a .blend built here opens on 4.x and 5.x alike.
"""

from __future__ import annotations

from pathlib import Path

import bpy

# The palette the icon set already uses: deep teal in the volume, bright cyan
# at the rim, near-white where the light gets through.
AQUA_DEEP = (0.031, 0.286, 0.451, 1.0)
AQUA_MID = (0.204, 0.678, 0.878, 1.0)
AQUA_BRIGHT = (0.639, 0.925, 1.0, 1.0)


def _set(node, names, value) -> bool:
    """Set the first socket that exists out of `names`. Returns whether it did."""
    if isinstance(names, str):
        names = (names,)
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def _new(nodes, kind: str, location: tuple[float, float]):
    node = nodes.new(kind)
    node.location = location
    return node


def aero_glass(
    name: str = "AeroGlass",
    tint: tuple[float, float, float, float] = AQUA_MID,
    volume_tint: tuple[float, float, float, float] = AQUA_DEEP,
    rim: tuple[float, float, float, float] = AQUA_BRIGHT,
    roughness: float = 0.06,
    density: float = 1.6,
) -> bpy.types.Material:
    """
    Thick aqua glass with a Fresnel rim glow.

    Three things together make the Frutiger Aero read, and dropping any one of
    them turns the tile into ordinary window glass:

      - transmission with a *volume* tint, so the colour deepens with thickness
        and the tile looks filled rather than coated;
      - a clearcoat, which is where the hard white specular hit comes from;
      - emission driven by facing ratio, which lights the silhouette edge even
        when no lamp is behind it. This is the single most recognisable part of
        the look and it is not physical — it is the 2005 icon convention.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.blend_method = "BLEND" if hasattr(material, "blend_method") else material.blend_method
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    principled = _new(nodes, "ShaderNodeBsdfPrincipled", (260, 0))

    _set(principled, "Base Color", tint)
    _set(principled, "Roughness", roughness)
    _set(principled, ("Transmission Weight", "Transmission"), 1.0)
    _set(principled, "IOR", 1.45)
    _set(principled, ("Coat Weight", "Clearcoat"), 1.0)
    _set(principled, ("Coat Roughness", "Clearcoat Roughness"), 0.02)
    _set(principled, ("Emission Color", "Emission"), rim)

    # Facing ratio -> emission strength. Map Range rather than a ColorRamp so
    # the falloff is a number in the file that can be tuned from a script.
    fresnel = _new(nodes, "ShaderNodeLayerWeight", (-320, -180))
    fresnel.inputs["Blend"].default_value = 0.35
    ramp = _new(nodes, "ShaderNodeMapRange", (-80, -180))
    ramp.inputs["From Min"].default_value = 0.25
    ramp.inputs["From Max"].default_value = 1.0
    ramp.inputs["To Min"].default_value = 0.0
    ramp.inputs["To Max"].default_value = 2.5
    ramp.clamp = True
    links.new(fresnel.outputs["Facing"], ramp.inputs["Value"])

    emission_socket = principled.inputs.get("Emission Strength")
    if emission_socket is not None:
        links.new(ramp.outputs["Result"], emission_socket)

    absorption = _new(nodes, "ShaderNodeVolumeAbsorption", (260, -320))
    absorption.inputs["Color"].default_value = volume_tint
    absorption.inputs["Density"].default_value = density

    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    links.new(absorption.outputs["Volume"], output.inputs["Volume"])
    return material


def icon_face(name: str, image_path: str | Path | None) -> bpy.types.Material:
    """
    The glyph plate: an emissive image with its own alpha as the cutout.

    Emission rather than diffuse because that is what the 2D icons do — the
    white glyph in the reference set is brighter than any light in the scene
    would make it, and matching that is what keeps the 3D tile recognisable as
    the same icon rather than a photograph of one.

    With no image, the plate is a clear pass-through: the tile is still valid
    geometry and still renders, it just has no symbol on it yet.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (400, 0))
    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (100, -160))

    if image_path is None:
        links.new(transparent.outputs["BSDF"], output.inputs["Surface"])
        return material

    texture = _new(nodes, "ShaderNodeTexImage", (-320, 0))
    texture.image = bpy.data.images.load(str(image_path), check_existing=True)
    texture.interpolation = "Cubic"
    texture.extension = "CLIP"

    emission = _new(nodes, "ShaderNodeEmission", (100, 60))
    emission.inputs["Strength"].default_value = 1.8
    links.new(texture.outputs["Color"], emission.inputs["Color"])

    mix = _new(nodes, "ShaderNodeMixShader", (260, 0))
    links.new(texture.outputs["Alpha"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def caustic_backdrop(
    name: str = "Caustics",
    shallow: tuple[float, float, float, float] = AQUA_BRIGHT,
    deep: tuple[float, float, float, float] = AQUA_DEEP,
    scale: float = 2.4,
    strength: float = 3.0,
) -> bpy.types.Material:
    """
    An emissive plane of moving caustic light, to sit behind the tiles.

    Two jobs, and the second one is the reason it exists. It is the light
    pattern on the pool floor, which is Frutiger Aero shorthand nothing else
    replaces. But it is also the only way transmissive glass reads as glass at
    all: refraction can only show what is behind it, and a tile in front of a
    flat colour refracts flat colour and looks like a painted card. The
    backdrop is what turns the tile transparent.

    Built from the ridged output of two offset Voronoi fields rather than a
    noise texture, because caustics are a network of thin bright filaments and
    band-limited noise cannot make a thin bright filament at any threshold.

    Looping it needs one non-obvious step. Sweeping the 4D field along W is the
    usual way to evolve a pattern in place, but Voronoi is not periodic in W,
    so a linear sweep never returns to where it started and the loop point
    snaps. Instead time is walked around a *circle* through two of the four
    dimensions — Z = r·cos(2πt), W = r·sin(2πt) — which comes back to its own
    starting coordinates exactly. The plane is flat, so its Z is free to be
    spent this way.

    That leaves a single scalar to animate: the `CausticPhase` value node,
    keyframed 0 -> 1 across the loop.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    emission = _new(nodes, "ShaderNodeEmission", (420, 0))
    emission.inputs["Strength"].default_value = strength

    coords = _new(nodes, "ShaderNodeTexCoord", (-1100, 0))
    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-940, 60))
    links.new(coords.outputs["Object"], separate.inputs["Vector"])

    # The loop's single animated scalar: 0 -> 1 across the frame range.
    phase = _new(nodes, "ShaderNodeValue", (-1100, -260))
    phase.name = "CausticPhase"
    phase.label = "CausticPhase"

    angle = _new(nodes, "ShaderNodeMath", (-940, -260))
    angle.operation = "MULTIPLY"
    angle.inputs[1].default_value = 6.283185307179586
    links.new(phase.outputs["Value"], angle.inputs[0])

    cosine = _new(nodes, "ShaderNodeMath", (-780, -180))
    cosine.operation = "COSINE"
    links.new(angle.outputs["Value"], cosine.inputs[0])
    sine = _new(nodes, "ShaderNodeMath", (-780, -340))
    sine.operation = "SINE"
    links.new(angle.outputs["Value"], sine.inputs[0])

    # Radius of the circle walked through Z/W. Larger churns faster.
    radius_z = _new(nodes, "ShaderNodeMath", (-620, -180))
    radius_z.operation = "MULTIPLY"
    radius_z.inputs[1].default_value = 0.9
    links.new(cosine.outputs["Value"], radius_z.inputs[0])
    radius_w = _new(nodes, "ShaderNodeMath", (-620, -340))
    radius_w.operation = "MULTIPLY"
    radius_w.inputs[1].default_value = 0.9
    links.new(sine.outputs["Value"], radius_w.inputs[0])

    combine = _new(nodes, "ShaderNodeCombineXYZ", (-620, 60))
    links.new(separate.outputs["X"], combine.inputs["X"])
    links.new(separate.outputs["Y"], combine.inputs["Y"])
    links.new(radius_z.outputs["Value"], combine.inputs["Z"])

    voronoi = _new(nodes, "ShaderNodeTexVoronoi", (-480, 0))
    voronoi.voronoi_dimensions = "4D"
    voronoi.feature = "SMOOTH_F1"
    voronoi.inputs["Scale"].default_value = scale
    if "Smoothness" in voronoi.inputs:
        voronoi.inputs["Smoothness"].default_value = 0.35
    links.new(combine.outputs["Vector"], voronoi.inputs["Vector"])
    links.new(radius_w.outputs["Value"], voronoi.inputs["W"])

    # Ridge the distance field: 1 - |2d - 1| turns the smooth basin into a
    # bright filament along the cell boundaries.
    ridge = _new(nodes, "ShaderNodeMath", (-280, 0))
    ridge.operation = "MULTIPLY_ADD"
    ridge.inputs[1].default_value = 2.0
    ridge.inputs[2].default_value = -1.0
    links.new(voronoi.outputs["Distance"], ridge.inputs[0])

    absolute = _new(nodes, "ShaderNodeMath", (-120, 0))
    absolute.operation = "ABSOLUTE"
    links.new(ridge.outputs["Value"], absolute.inputs[0])

    invert = _new(nodes, "ShaderNodeMath", (40, 0))
    invert.operation = "SUBTRACT"
    invert.inputs[0].default_value = 1.0
    links.new(absolute.outputs["Value"], invert.inputs[1])

    # Gamma sharpens the filaments without moving where they are.
    sharpen = _new(nodes, "ShaderNodeMath", (200, 0))
    sharpen.operation = "POWER"
    sharpen.inputs[1].default_value = 4.0
    links.new(invert.outputs["Value"], sharpen.inputs[0])

    ramp = _new(nodes, "ShaderNodeValToRGB", (200, -220))
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = deep
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = shallow
    links.new(sharpen.outputs["Value"], ramp.inputs["Fac"])

    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])

    return material


def caustic_phase(material: bpy.types.Material):
    """The 0..1 phase output socket driving the caustics. Keyframe this."""
    node = material.node_tree.nodes.get("CausticPhase")
    return None if node is None else node.outputs["Value"]


def aqua_world(
    horizon: tuple[float, float, float] = (0.42, 0.80, 0.95),
    zenith: tuple[float, float, float] = (0.02, 0.16, 0.34),
    strength: float = 1.0,
) -> bpy.types.World:
    """
    A vertical gradient world: bright near the horizon, deep overhead.

    Submerged scenes want the opposite of a sky HDRI. Light in water comes from
    one direction and falls off fast, and a gradient world gives that for free
    while staying cheap enough to render a 300-frame loop.
    """
    world = bpy.data.worlds.new("AquaWorld")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputWorld", (400, 0))
    background = _new(nodes, "ShaderNodeBackground", (200, 0))
    background.inputs["Strength"].default_value = strength

    coords = _new(nodes, "ShaderNodeTexCoord", (-500, 0))
    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-320, 0))
    ramp = _new(nodes, "ShaderNodeValToRGB", (-140, 0))
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*horizon, 1.0)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (*zenith, 1.0)

    links.new(coords.outputs["Generated"], separate.inputs["Vector"])
    links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])
    return world
