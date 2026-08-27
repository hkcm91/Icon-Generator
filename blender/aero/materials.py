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
    rim_strength: float = 2.5,
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
    ramp.inputs["To Max"].default_value = rim_strength
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


def water_volume(
    name: str = "WaterColumn",
    shallow: tuple[float, float, float, float] = (0.451, 0.925, 1.0, 1.0),
    mid: tuple[float, float, float, float] = (0.063, 0.553, 0.784, 1.0),
    deep: tuple[float, float, float, float] = (0.004, 0.055, 0.161, 1.0),
    density: float = 0.032,
    anisotropy: float = 0.55,
    surface_height: float = 9.0,
    floor_depth: float = -16.0,
) -> bpy.types.Material:
    """
    The medium everything else is seen through, graded by depth.

    This is the most important material in the scene twice over. It does the
    compositional work — distance fog is what turns the far field into colour
    rather than shape, so the tiles drifting at the back become unreadable *by
    physics* rather than by being blurred in post — and it supplies essentially
    all of the colour in the frame.

    A single flat tint was the first version and it was the reason the whole
    thing read as a grey slab. Water is not one colour: it absorbs red almost
    immediately and blue last, so the scattered light shifts from bright cyan
    near the surface to a deep saturated blue-black further down, and it is
    that vertical shift — not the objects in it — that makes a body of water
    look deep. Grading the scatter colour by world Z gives it back.

    It also does the job a vignette would otherwise be asked to do. The frame
    naturally darkens toward the bottom, which is precisely where a home
    screen's dock sits and where contrast is least wanted.

    Forward anisotropy matters more than it sounds. Water scatters light
    forward, so shafts brighten as they point toward the camera, which is the
    difference between beams that look lit and beams that look painted on.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (400, 0))
    volume = _new(nodes, "ShaderNodeVolumePrincipled", (150, 0))
    _set(volume, "Density", density)
    _set(volume, "Anisotropy", anisotropy)
    _set(volume, ("Emission Strength",), 0.0)

    # World Z, normalised so 1.0 is the surface and 0.0 is the deep. Geometry
    # rather than a texture coordinate: the box this is applied to is huge, and
    # its object space would put the gradient somewhere unrelated to where the
    # water actually is.
    geometry = _new(nodes, "ShaderNodeNewGeometry", (-720, 0))
    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-560, 0))
    links.new(geometry.outputs["Position"], separate.inputs["Vector"])

    depth = _new(nodes, "ShaderNodeMapRange", (-400, 0))
    depth.inputs["From Min"].default_value = floor_depth
    depth.inputs["From Max"].default_value = surface_height
    depth.inputs["To Min"].default_value = 0.0
    depth.inputs["To Max"].default_value = 1.0
    depth.clamp = True
    links.new(separate.outputs["Z"], depth.inputs["Value"])

    ramp = _new(nodes, "ShaderNodeValToRGB", (-220, 0))
    elements = ramp.color_ramp.elements
    elements[0].position = 0.0
    elements[0].color = deep
    elements[1].position = 1.0
    elements[1].color = shallow
    middle = elements.new(0.46)
    middle.color = mid
    links.new(depth.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], volume.inputs["Color"])

    # Density rises a little toward the surface too. Real water carries more
    # suspended matter in the lit layer, and it strengthens the shafts exactly
    # where they should be strongest without touching the deep.
    thickness = _new(nodes, "ShaderNodeMapRange", (-220, -260))
    thickness.interpolation_type = "SMOOTHSTEP"
    thickness.inputs["From Min"].default_value = 0.0
    thickness.inputs["From Max"].default_value = 1.0
    thickness.inputs["To Min"].default_value = density * 0.75
    thickness.inputs["To Max"].default_value = density * 1.35
    thickness.clamp = True
    links.new(depth.outputs["Result"], thickness.inputs["Value"])
    links.new(thickness.outputs["Result"], volume.inputs["Density"])

    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def god_ray(
    name: str = "GodRay",
    colour: tuple[float, float, float, float] = (0.706, 0.910, 1.0, 1.0),
    strength: float = 1.1,
) -> bpy.types.Material:
    """
    A light shaft, as a card rather than as light.

    Real volumetric shafts need a textured light shining through a medium, and
    they cost accordingly — the volume has to be marched for every sample of
    every frame. At the scale a wallpaper is viewed, nobody can tell the
    difference between that and an emissive card with the right falloff, and
    the card renders in both engines, has no noise, and loops by animating one
    number.

    The falloff is the whole trick: bright at the top where the shaft leaves
    the surface, gone before it reaches the bottom of frame, and feathered to
    nothing at both vertical edges so the card never shows its own silhouette.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-600, 0))
    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-440, 0))
    links.new(coords.outputs["UV"], separate.inputs["Vector"])

    # Vertical: full where the shaft leaves the surface, gone well before the
    # bottom of frame. Smoothstepped so the top of the card doesn't show a line
    # either.
    vertical = _new(nodes, "ShaderNodeMapRange", (-280, 90))
    vertical.interpolation_type = "SMOOTHSTEP"
    vertical.inputs["From Min"].default_value = 0.18
    vertical.inputs["From Max"].default_value = 1.0
    vertical.inputs["To Min"].default_value = 0.0
    vertical.inputs["To Max"].default_value = 1.0
    vertical.clamp = True
    links.new(separate.outputs["Y"], vertical.inputs["Value"])

    # Horizontal: a smooth hump, so the card has no visible left or right edge.
    centred = _new(nodes, "ShaderNodeMath", (-280, -140))
    centred.operation = "SUBTRACT"
    centred.inputs[1].default_value = 0.5
    links.new(separate.outputs["X"], centred.inputs[0])

    absolute = _new(nodes, "ShaderNodeMath", (-120, -140))
    absolute.operation = "ABSOLUTE"
    links.new(centred.outputs["Value"], absolute.inputs[0])

    hump = _new(nodes, "ShaderNodeMath", (40, -140))
    hump.operation = "SUBTRACT"
    hump.inputs[0].default_value = 0.5
    links.new(absolute.outputs["Value"], hump.inputs[1])

    # Smoothstep, not a power curve. A power curve still has a finite slope
    # where it reaches zero, and a finite slope at the edge of an emissive card
    # is a visible straight line down the frame — precisely the tell that gives
    # away a fake light shaft. Smoothstep leaves at zero gradient, so the card
    # has no findable edge. (Map Range carries the interpolation modes; the
    # Math node has no smoothstep.)
    feather = _new(nodes, "ShaderNodeMapRange", (200, -220))
    feather.interpolation_type = "SMOOTHSTEP"
    feather.inputs["From Min"].default_value = 0.0
    feather.inputs["From Max"].default_value = 0.5
    feather.inputs["To Min"].default_value = 0.0
    feather.inputs["To Max"].default_value = 1.0
    feather.clamp = True
    links.new(hump.outputs["Value"], feather.inputs["Value"])

    shape = _new(nodes, "ShaderNodeMath", (200, 60))
    shape.operation = "MULTIPLY"
    links.new(vertical.outputs["Result"], shape.inputs[0])
    links.new(feather.outputs["Result"], shape.inputs[1])

    # Break the shaft up along its length. Without this each card reads as a
    # bar of even fog; the ripple that cast the shaft in the first place is
    # what gives a real one its uneven, banded interior.
    noise = _new(nodes, "ShaderNodeTexNoise", (40, 220))
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 1.0
    links.new(coords.outputs["Object"], noise.inputs["Vector"])

    modulate = _new(nodes, "ShaderNodeMapRange", (200, 220))
    modulate.inputs["From Min"].default_value = 0.3
    modulate.inputs["From Max"].default_value = 0.7
    modulate.inputs["To Min"].default_value = 0.82
    modulate.inputs["To Max"].default_value = 1.0
    modulate.clamp = True
    links.new(noise.outputs["Fac"], modulate.inputs["Value"])

    combined = _new(nodes, "ShaderNodeMath", (280, 120))
    combined.operation = "MULTIPLY"
    links.new(shape.outputs["Value"], combined.inputs[0])
    links.new(modulate.outputs["Result"], combined.inputs[1])

    # Kept at or below 1. A Mix Shader clamps its Fac, so scaling past 1 does
    # not brighten the shaft — it flattens the falloff into a solid slab with
    # hard edges, which is what a light shaft must never have.
    scaled = _new(nodes, "ShaderNodeMath", (360, 60))
    scaled.operation = "MULTIPLY"
    scaled.inputs[1].default_value = 0.85
    links.new(combined.outputs["Value"], scaled.inputs[0])

    emission = _new(nodes, "ShaderNodeEmission", (360, -60))
    emission.inputs["Color"].default_value = colour
    emission.inputs["Strength"].default_value = strength

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (360, -220))
    mix = _new(nodes, "ShaderNodeMixShader", (480, 0))
    links.new(scaled.outputs["Value"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def bubble(
    name: str = "Bubble",
    colour: tuple[float, float, float, float] = (0.827, 0.969, 1.0, 1.0),
    strength: float = 2.2,
) -> bpy.types.Material:
    """
    A bubble as a camera-facing disc: bright rim, near-empty middle.

    Modelling bubbles as glass spheres is the obvious approach and the wrong
    one here. Every one of them would need transmission rays, and at the depth
    of field this scene runs they resolve to a soft ring of light regardless —
    so the ring is what gets built. A hundred of these cost less than one
    sphere.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-600, 0))

    # Radial distance from the centre of the quad.
    centre = _new(nodes, "ShaderNodeVectorMath", (-440, 0))
    centre.operation = "SUBTRACT"
    centre.inputs[1].default_value = (0.5, 0.5, 0.0)
    links.new(coords.outputs["UV"], centre.inputs[0])

    length = _new(nodes, "ShaderNodeVectorMath", (-280, 0))
    length.operation = "LENGTH"
    links.new(centre.outputs["Vector"], length.inputs[0])

    # A true annulus: dark centre, a bright band near the rim, nothing beyond
    # it. The first version ramped from a dark centre straight up to white at
    # 42% radius, which is a filled gradient disc, not a ring — and filled
    # discs are exactly the white blobs that make fake bokeh look fake. The
    # dark hole in the middle is the whole read.
    ring = _new(nodes, "ShaderNodeValToRGB", (-120, 0))
    ring.color_ramp.interpolation = "EASE"
    elements = ring.color_ramp.elements
    elements[0].position = 0.0
    elements[0].color = (0.0, 0.0, 0.0, 1.0)
    elements[1].position = 0.5
    elements[1].color = (0.0, 0.0, 0.0, 1.0)
    inner = elements.new(0.30)
    inner.color = (0.10, 0.10, 0.10, 1.0)
    crest = elements.new(0.42)
    crest.color = (1.0, 1.0, 1.0, 1.0)
    links.new(length.outputs["Value"], ring.inputs["Fac"])

    emission = _new(nodes, "ShaderNodeEmission", (200, 60))
    emission.inputs["Color"].default_value = colour
    emission.inputs["Strength"].default_value = strength

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (200, -140))

    # The fade handle, keyframed per bubble so the restart happens at zero
    # opacity and cannot be seen. It gates the ring rather than the emission
    # strength: fading strength alone would leave a black disc behind.
    opacity = _new(nodes, "ShaderNodeValue", (200, -280))
    opacity.name = "BubbleFade"
    opacity.label = "BubbleFade"
    opacity.outputs["Value"].default_value = 1.0

    gate = _new(nodes, "ShaderNodeMath", (400, -200))
    gate.operation = "MULTIPLY"
    links.new(ring.outputs["Color"], gate.inputs[0])
    links.new(opacity.outputs["Value"], gate.inputs[1])

    mix = _new(nodes, "ShaderNodeMixShader", (560, 0))
    links.new(gate.outputs["Value"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def light_bleed(
    name: str = "LightBleed",
    colour: tuple[float, float, float, float] = (0.588, 0.902, 1.0, 1.0),
    strength: float = 1.6,
    falloff: float = 2.2,
) -> bpy.types.Material:
    """
    A vertical wash of light hanging below the waterline.

    Looking up from underwater, the surface ends at a hard line — that is
    Snell's window and it is real. But a *hard* line straight across the frame
    is still the most artificial thing in this composition, because in real
    water the light does not stop there: it keeps bleeding downward through the
    suspended matter for several metres before the depth takes it.

    Getting that from the medium alone would mean cranking density until the
    whole scene fogs over. This is the same effect painted where it is wanted:
    an additive card, bright along its top edge, gone by its bottom, spanning
    the frame. It contributes light and nothing else — no silhouette, no
    occlusion, nothing to focus on.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-600, 0))
    separate = _new(nodes, "ShaderNodeSeparateXYZ", (-440, 0))
    links.new(coords.outputs["UV"], separate.inputs["Vector"])

    fade = _new(nodes, "ShaderNodeMapRange", (-280, 0))
    fade.interpolation_type = "SMOOTHSTEP"
    fade.inputs["From Min"].default_value = 0.0
    fade.inputs["From Max"].default_value = 1.0
    fade.inputs["To Min"].default_value = 0.0
    fade.inputs["To Max"].default_value = 1.0
    fade.clamp = True
    links.new(separate.outputs["Y"], fade.inputs["Value"])

    concentrate = _new(nodes, "ShaderNodeMath", (-100, 0))
    concentrate.operation = "POWER"
    concentrate.inputs[1].default_value = falloff
    links.new(fade.outputs["Result"], concentrate.inputs[0])

    # Feathered at the left and right edges as well, so the card cannot show a
    # vertical seam where it ends.
    centred = _new(nodes, "ShaderNodeMath", (-280, -220))
    centred.operation = "SUBTRACT"
    centred.inputs[1].default_value = 0.5
    links.new(separate.outputs["X"], centred.inputs[0])

    absolute = _new(nodes, "ShaderNodeMath", (-140, -220))
    absolute.operation = "ABSOLUTE"
    links.new(centred.outputs["Value"], absolute.inputs[0])

    sides = _new(nodes, "ShaderNodeMapRange", (20, -220))
    sides.interpolation_type = "SMOOTHSTEP"
    sides.inputs["From Min"].default_value = 0.5
    sides.inputs["From Max"].default_value = 0.32
    sides.inputs["To Min"].default_value = 0.0
    sides.inputs["To Max"].default_value = 1.0
    sides.clamp = True
    links.new(absolute.outputs["Value"], sides.inputs["Value"])

    combined = _new(nodes, "ShaderNodeMath", (200, 0))
    combined.operation = "MULTIPLY"
    links.new(concentrate.outputs["Value"], combined.inputs[0])
    links.new(sides.outputs["Result"], combined.inputs[1])

    emission = _new(nodes, "ShaderNodeEmission", (380, 80))
    emission.inputs["Color"].default_value = colour
    emission.inputs["Strength"].default_value = strength

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (380, -120))
    mix = _new(nodes, "ShaderNodeMixShader", (460, 0))
    links.new(combined.outputs["Value"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def radial_glow(
    name: str = "Glow",
    colour: tuple[float, float, float, float] = (1.0, 0.988, 0.937, 1.0),
    strength: float = 24.0,
    falloff: float = 2.6,
) -> bpy.types.Material:
    """
    A soft round light source on a quad — the sun seen through the surface.

    The obvious version of this is a bright plane, and a bright plane has four
    corners. Depth of field blurs them but does not remove them: a rectangle
    thrown out of focus is still a rectangle, just a soft one, and it reads
    instantly as a mistake. The brightness has to fall off radially *in the
    material* so there is no edge to blur in the first place.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = _new(nodes, "ShaderNodeOutputMaterial", (600, 0))
    coords = _new(nodes, "ShaderNodeTexCoord", (-600, 0))

    centre = _new(nodes, "ShaderNodeVectorMath", (-440, 0))
    centre.operation = "SUBTRACT"
    centre.inputs[1].default_value = (0.5, 0.5, 0.0)
    links.new(coords.outputs["UV"], centre.inputs[0])

    length = _new(nodes, "ShaderNodeVectorMath", (-280, 0))
    length.operation = "LENGTH"
    links.new(centre.outputs["Vector"], length.inputs[0])

    # 1 at the centre, 0 at radius 0.5 — the inscribed circle, so the quad's
    # corners are already dark before its edge is reached.
    fade = _new(nodes, "ShaderNodeMapRange", (-120, 0))
    fade.interpolation_type = "SMOOTHSTEP"
    fade.inputs["From Min"].default_value = 0.5
    fade.inputs["From Max"].default_value = 0.0
    fade.inputs["To Min"].default_value = 0.0
    fade.inputs["To Max"].default_value = 1.0
    fade.clamp = True
    links.new(length.outputs["Value"], fade.inputs["Value"])

    concentrate = _new(nodes, "ShaderNodeMath", (60, 0))
    concentrate.operation = "POWER"
    concentrate.inputs[1].default_value = falloff
    links.new(fade.outputs["Result"], concentrate.inputs[0])

    emission = _new(nodes, "ShaderNodeEmission", (260, 80))
    emission.inputs["Color"].default_value = colour
    emission.inputs["Strength"].default_value = strength

    transparent = _new(nodes, "ShaderNodeBsdfTransparent", (260, -120))
    mix = _new(nodes, "ShaderNodeMixShader", (440, 0))
    links.new(concentrate.outputs["Value"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def water_surface(
    name: str = "Surface",
    scale: float = 0.6,
    strength: float = 6.0,
) -> bpy.types.Material:
    """
    The underside of the water, which is the brightest thing in the frame.

    Built on the same caustic network as the backdrop — seen from below, the
    surface *is* a caustic pattern, just a much brighter one. The difference is
    the range: the dark end goes to near-black rather than deep teal, because
    what is being looked at between the bright filaments is the sky refracting
    at a shallow angle, which is dark, not blue.
    """
    material = caustic_backdrop(
        name=name,
        shallow=(0.855, 0.980, 1.0, 1.0),
        deep=(0.031, 0.278, 0.451, 1.0),
        scale=scale,
        strength=strength,
    )
    return material


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
