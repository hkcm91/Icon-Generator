"""
The Frutiger Aero material library.

The aesthetic is not a colour palette, it is a set of *surface* claims: that
everything is wet, that everything has a clear coat over a coloured body, that
light entering a surface comes back out somewhere else. Get those three right
and almost any subject reads as Frutiger Aero. Get them wrong and no amount of
cyan saves it.

Concretely, every material here obeys the same three rules:

  1. **Two-layer surfaces.** A coloured, slightly soft body under a hard clear
     coat. Never one glossy layer — a single-layer shiny surface reads as
     plastic-cheap. The coat is what makes it look poured.
  2. **Light goes through things.** Transmission on the glass, subsurface on
     the gel. The era's icons all glow slightly from within because they were
     drawn as if lit from behind.
  3. **Thin-film iridescence, sparingly.** The soap-bubble rainbow at grazing
     angles. It is the single most period-correct detail available, and the
     fastest way to look cheap if overdone, so it lives at the rim.

Every function returns a material and is idempotent by name, so scenes can ask
for `water()` freely without accumulating duplicates.
"""

from __future__ import annotations

from typing import Optional

import bpy

# The palette. Sampled to sit where the era actually sat: cyans that stay blue
# in shadow, a green that is grass rather than emerald, and a horizon white
# that is faintly warm so the blues read cold against it.
AQUA = (0.16, 0.72, 0.94, 1.0)
DEEP_AQUA = (0.03, 0.28, 0.52, 1.0)
SKY = (0.35, 0.72, 0.98, 1.0)
HORIZON = (0.94, 0.98, 1.0, 1.0)
GRASS = (0.28, 0.66, 0.18, 1.0)
AURORA_A = (0.20, 0.95, 0.80, 1.0)
AURORA_B = (0.45, 0.35, 0.95, 1.0)
GLOSS_WHITE = (1.0, 1.0, 1.0, 1.0)


def _material(name: str) -> tuple[bpy.types.Material, bpy.types.ShaderNodeTree, bool]:
    """Fetch-or-create. Returns (material, node_tree, was_already_there)."""
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing, existing.node_tree, True

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    return mat, tree, False


def _output(tree: bpy.types.ShaderNodeTree, x: float = 400.0):
    node = tree.nodes.new("ShaderNodeOutputMaterial")
    node.location = (x, 0)
    return node


# ---------------------------------------------------------------------------
# The icon tile
# ---------------------------------------------------------------------------


def icon_gel(
    name: str,
    image: Optional[bpy.types.Image] = None,
    tint=AQUA,
) -> bpy.types.Material:
    """The material for one icon tile.

    The icons arriving from the app are already painted with their own
    highlights and internal bubbles — they are finished artwork, not albedo
    maps. So this material must not re-light them into mud. It treats the PNG
    as a *lit body* (fed to base colour and given a little emission so the
    painted highlights stay bright in shadow) and adds only what a flat image
    cannot have: a real clear coat that catches the scene's own lights, and
    real subsurface so the tile glows where light passes through its edge.

    Alpha comes from the PNG, which is what lets an open-frame export keep its
    transparent centre in 3D instead of arriving as a black square.

    With no image, falls back to a procedural aqua body so a scene can be
    built and framed before any icons have been exported.
    """
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)

    if image is not None:
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.location = (-450, 0)
        tex.image = image
        tex.interpolation = "Cubic"
        # Icons are artwork, not data: sRGB, and no extension past the border
        # so a tile never smears its edge pixels around the rim.
        tex.extension = "CLIP"
        tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
        tree.links.new(bsdf.inputs["Alpha"], tex.outputs["Alpha"])

        # Keep the painted highlights alive under scene lighting. Emission is
        # driven by the texture itself so bright parts of the art self-light
        # and dark parts stay grounded.
        emit = tree.nodes.new("ShaderNodeMixRGB")
        emit.location = (-150, -260)
        emit.blend_type = "MULTIPLY"
        emit.inputs["Fac"].default_value = 1.0
        emit.inputs["Color2"].default_value = (0.55, 0.85, 1.0, 1.0)
        tree.links.new(emit.inputs["Color1"], tex.outputs["Color"])
        tree.links.new(bsdf.inputs["Emission Color"], emit.outputs["Color"])
        bsdf.inputs["Emission Strength"].default_value = 0.22
    else:
        bsdf.inputs["Base Color"].default_value = tint
        bsdf.inputs["Emission Color"].default_value = tint
        bsdf.inputs["Emission Strength"].default_value = 0.15

    bsdf.inputs["Roughness"].default_value = 0.18
    bsdf.inputs["IOR"].default_value = 1.46
    bsdf.inputs["Specular IOR Level"].default_value = 0.6

    # Light through the body. Radius is deliberately tinted blue-heavy so the
    # bleed cools as it spreads, the way water does.
    bsdf.inputs["Subsurface Weight"].default_value = 0.22
    bsdf.inputs["Subsurface Scale"].default_value = 0.06
    bsdf.inputs["Subsurface Radius"].default_value = (0.4, 0.8, 1.0)

    # The poured clear coat. Near-zero roughness: this layer is the wet look.
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.02
    bsdf.inputs["Coat IOR"].default_value = 1.6

    # Iridescence at the rim only — driven by facing angle so the film shows
    # where the tile turns away and stays out of the readable face.
    fresnel = tree.nodes.new("ShaderNodeFresnel")
    fresnel.location = (-150, 220)
    fresnel.inputs["IOR"].default_value = 1.45
    film = tree.nodes.new("ShaderNodeMapRange")
    film.location = (-10, 220)
    film.inputs["From Min"].default_value = 0.0
    film.inputs["From Max"].default_value = 1.0
    film.inputs["To Min"].default_value = 0.0
    film.inputs["To Max"].default_value = 480.0
    tree.links.new(film.inputs["Value"], fresnel.outputs["Fac"])
    tree.links.new(bsdf.inputs["Thin Film Thickness"], film.outputs["Result"])
    bsdf.inputs["Thin Film IOR"].default_value = 1.33

    tree.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])

    # Alpha blending, so an open-frame icon's transparent centre stays
    # transparent. Cycles ignores this entirely — it always traces true alpha —
    # but it is what makes EEVEE look-development match the final render
    # instead of showing every tile as an opaque square. The attribute was
    # renamed in the EEVEE Next rework, so set whichever spelling exists.
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED"
    elif hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    return mat


# ---------------------------------------------------------------------------
# Water, glass, bubbles
# ---------------------------------------------------------------------------


def water(name: str = "FA_Water", loop_radius: float = 0.35) -> bpy.types.Material:
    """An animated water surface.

    Two noise fields at different scales and drift rates, summed into a bump.
    One field alone reads as a repeating pattern the moment the camera holds
    still, which on a wallpaper it always does.

    The Mapping node named `WaterDrift` is the animation hook: `fa.loop`
    walks its Location around a circle of radius `loop_radius` so the surface
    evolves continuously and still returns exactly to its starting state.
    """
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)
    bsdf.inputs["Base Color"].default_value = DEEP_AQUA
    bsdf.inputs["Roughness"].default_value = 0.02
    bsdf.inputs["IOR"].default_value = 1.333
    bsdf.inputs["Transmission Weight"].default_value = 1.0

    coords = tree.nodes.new("ShaderNodeTexCoord")
    coords.location = (-900, 0)
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.name = "WaterDrift"
    mapping.label = "WaterDrift"
    mapping.location = (-720, 0)
    tree.links.new(mapping.inputs["Vector"], coords.outputs["Object"])

    swell = tree.nodes.new("ShaderNodeTexNoise")
    swell.location = (-520, 140)
    swell.inputs["Scale"].default_value = 2.4
    swell.inputs["Detail"].default_value = 4.0
    swell.inputs["Roughness"].default_value = 0.45
    tree.links.new(swell.inputs["Vector"], mapping.outputs["Vector"])

    ripple = tree.nodes.new("ShaderNodeTexNoise")
    ripple.location = (-520, -140)
    ripple.inputs["Scale"].default_value = 11.0
    ripple.inputs["Detail"].default_value = 6.0
    ripple.inputs["Roughness"].default_value = 0.6
    tree.links.new(ripple.inputs["Vector"], mapping.outputs["Vector"])

    blend = tree.nodes.new("ShaderNodeMix")
    blend.location = (-320, 0)
    blend.data_type = "FLOAT"
    blend.inputs["Factor"].default_value = 0.35
    tree.links.new(blend.inputs[2], swell.outputs["Fac"])
    tree.links.new(blend.inputs[3], ripple.outputs["Fac"])

    bump = tree.nodes.new("ShaderNodeBump")
    bump.location = (-120, -120)
    bump.inputs["Strength"].default_value = 0.28
    bump.inputs["Distance"].default_value = 0.06
    tree.links.new(bump.inputs["Height"], blend.outputs[0])
    tree.links.new(bsdf.inputs["Normal"], bump.outputs["Normal"])

    tree.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def bubble(name: str = "FA_Bubble") -> bpy.types.Material:
    """A soap bubble: a film, not a bead of glass.

    This is the one place iridescence runs at full strength, because on a
    bubble it is not a stylistic flourish — it is the physically correct
    appearance of a film a few hundred nanometres thick, and it is the motif
    the whole aesthetic is built around.

    **IOR is ~1, and that is the entire point.** The obvious setting is 1.33,
    water — but that describes a *solid drop* of water, and Cycles renders it
    as one: a ball lens that concentrates whatever is behind it into a hard
    bright core. On screen they come out as opaque white beads.

    A real bubble is two air-water interfaces a fraction of a wavelength
    apart. Light crossing the first is bent back by the second, so the net
    bulk refraction is nothing at all; what is left is the thin-film
    interference between them and a faint edge reflection. Setting IOR to
    unity models exactly that, and the bubble becomes what it should be —
    almost invisible except for its rainbow and its rim.
    """
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)
    bsdf.inputs["Base Color"].default_value = GLOSS_WHITE
    bsdf.inputs["Roughness"].default_value = 0.0
    # Just above 1: enough Fresnel for the rim to catch light, far too little
    # to lens. Exactly 1.0 removes the edge entirely and the bubble vanishes.
    bsdf.inputs["IOR"].default_value = 1.04
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Thin Film IOR"].default_value = 1.45

    # Film thickness varies over the sphere: real bubbles drain downward and
    # band. A gradient in object space gives that banding for free.
    coords = tree.nodes.new("ShaderNodeTexCoord")
    coords.location = (-700, 0)
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-520, 0)
    tree.links.new(sep.inputs["Vector"], coords.outputs["Object"])

    thickness = tree.nodes.new("ShaderNodeMapRange")
    thickness.location = (-320, 0)
    thickness.inputs["From Min"].default_value = -1.0
    thickness.inputs["From Max"].default_value = 1.0
    thickness.inputs["To Min"].default_value = 220.0
    thickness.inputs["To Max"].default_value = 640.0
    tree.links.new(thickness.inputs["Value"], sep.outputs["Z"])
    tree.links.new(bsdf.inputs["Thin Film Thickness"], thickness.outputs["Result"])

    tree.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def clear_glass(name: str = "FA_Glass", tint=(0.85, 0.96, 1.0, 1.0)) -> bpy.types.Material:
    """Structural glass: panels, slabs, the Aero shelf. Barely tinted."""
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["IOR"].default_value = 1.45
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Coat Weight"].default_value = 0.4
    bsdf.inputs["Coat Roughness"].default_value = 0.02
    tree.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def frosted_glass(name: str = "FA_Frosted", tint=(0.80, 0.92, 1.0, 1.0)) -> bpy.types.Material:
    """The Windows Aero panel: blurred transmission behind a sharp coat.

    Roughness on the transmission with a *smooth* coat over it is the whole
    trick — the body scatters what is behind it while the surface still throws
    a crisp reflection of the light. Roughening both instead just looks dusty.
    """
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Roughness"].default_value = 0.42
    bsdf.inputs["IOR"].default_value = 1.45
    bsdf.inputs["Transmission Weight"].default_value = 0.92
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.03
    tree.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def caustic_light(name: str = "FA_Caustics", loop_radius: float = 0.3) -> bpy.types.Material:
    """A light-gobo material: dancing water caustics projected into the scene.

    Real caustics from a transmissive surface need punishing sample counts and
    still come out noisy at wallpaper resolutions. Projecting an animated
    Voronoi through an area light is the standard cheat, costs nothing, and at
    the scale caustics appear on screen is genuinely indistinguishable.

    The `CausticDrift` Mapping node is the animation hook.
    """
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.location = (150, 0)
    emission.inputs["Strength"].default_value = 6.0

    coords = tree.nodes.new("ShaderNodeTexCoord")
    coords.location = (-800, 0)
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.name = "CausticDrift"
    mapping.label = "CausticDrift"
    mapping.location = (-620, 0)
    tree.links.new(mapping.inputs["Vector"], coords.outputs["Object"])

    cells = tree.nodes.new("ShaderNodeTexVoronoi")
    cells.location = (-420, 0)
    cells.feature = "SMOOTH_F1"
    cells.inputs["Scale"].default_value = 6.0
    tree.links.new(cells.inputs["Vector"], mapping.outputs["Vector"])

    # Invert and crush: caustics are thin bright filaments between dark cells,
    # so the useful signal is the *edges* of the Voronoi, not its interiors.
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-220, 0)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
    ramp.color_ramp.elements[1].position = 0.28
    ramp.color_ramp.elements[1].color = (0.0, 0.05, 0.15, 1.0)
    tree.links.new(ramp.inputs["Fac"], cells.outputs["Distance"])
    tree.links.new(emission.inputs["Color"], ramp.outputs["Color"])

    tree.links.new(out.inputs["Surface"], emission.outputs["Emission"])
    return mat


def glossy_grass(name: str = "FA_Grass") -> bpy.types.Material:
    """Hyper-real grass green, wet enough to specular. The Bliss-hill green."""
    mat, tree, existed = _material(name)
    if existed:
        return mat

    out = _output(tree)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (150, 0)
    bsdf.inputs["Base Color"].default_value = GRASS
    bsdf.inputs["Roughness"].default_value = 0.35
    bsdf.inputs["Subsurface Weight"].default_value = 0.35
    bsdf.inputs["Subsurface Radius"].default_value = (0.3, 1.0, 0.2)
    bsdf.inputs["Subsurface Scale"].default_value = 0.02
    bsdf.inputs["Sheen Weight"].default_value = 0.4
    tree.links.new(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat
