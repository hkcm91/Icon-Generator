"""
World, light and atmosphere.

The era's imagery is almost always lit the same way: a strong sun somewhere
behind and above the subject, a bright sky filling every shadow so nothing is
ever truly dark, and enough haze in the air to make the light itself visible.
That last part is what people are actually responding to when they call an
image "Frutiger Aero" — you can see the beams. It is a wallpaper aesthetic in
the literal sense; it was designed to look good with icons sitting on top.

This module builds that setup: a graduated sky world, a three-light rig, a
volume for god rays, and the bokeh sprites the era used constantly.
"""

from __future__ import annotations

import math
import random

import bpy

from . import materials


def build_world(
    top=materials.SKY,
    bottom=materials.HORIZON,
    strength: float = 1.6,
    aurora: bool = True,
) -> bpy.types.World:
    """A vertical sky gradient, optionally with an aurora band above.

    Deliberately not a Sky Texture node: a physical sky model gives a
    physically plausible horizon, and the era's skies are not plausible. They
    are saturated to the top of the gamut and blown out at the horizon, which
    is exactly what a hand-built gradient can do and a sun model will fight.

    The `AuroraDrift` Mapping node is the animation hook for `fa.loop`.
    """
    world = bpy.data.worlds.get("FA_World") or bpy.data.worlds.new("FA_World")
    # Creating a world datablock does not put it in the scene; without this
    # assignment the scene keeps whatever world it had (under a cleared
    # startup file, none at all) and renders against black.
    bpy.context.scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()

    out = tree.nodes.new("ShaderNodeOutputWorld")
    out.location = (600, 0)
    background = tree.nodes.new("ShaderNodeBackground")
    background.location = (400, 0)
    background.inputs["Strength"].default_value = strength

    coords = tree.nodes.new("ShaderNodeTexCoord")
    coords.location = (-900, 0)

    # Gradient driven by the view vector's Z, remapped so the horizon sits at
    # eye level and the bright band is generous — a thin horizon reads modern,
    # a wide one reads 2007.
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-720, 0)
    tree.links.new(sep.inputs["Vector"], coords.outputs["Generated"])

    # In a world shader, Generated is the ray direction, so Z runs -1 (straight
    # down) to +1 (straight up), not the 0..1 a mesh's Generated coordinates
    # give. Feeding it a 0..1 range clamps the whole sky to one end of the
    # ramp and renders a flat wash. The horizon sits just below zero because
    # the camera looks slightly downward.
    height = tree.nodes.new("ShaderNodeMapRange")
    height.location = (-540, 0)
    height.inputs["From Min"].default_value = -0.15
    height.inputs["From Max"].default_value = 0.55
    height.inputs["To Min"].default_value = 0.0
    height.inputs["To Max"].default_value = 1.0
    height.clamp = True
    tree.links.new(height.inputs["Value"], sep.outputs["Z"])

    gradient = tree.nodes.new("ShaderNodeValToRGB")
    gradient.location = (-340, 0)
    gradient.color_ramp.interpolation = "EASE"
    gradient.color_ramp.elements[0].position = 0.0
    gradient.color_ramp.elements[0].color = bottom
    gradient.color_ramp.elements[1].position = 1.0
    gradient.color_ramp.elements[1].color = top
    tree.links.new(gradient.inputs["Fac"], height.outputs["Result"])

    if not aurora:
        tree.links.new(background.inputs["Color"], gradient.outputs["Color"])
        tree.links.new(out.inputs["Surface"], background.outputs["Background"])
        return world

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.name = "AuroraDrift"
    mapping.label = "AuroraDrift"
    mapping.location = (-720, -320)
    tree.links.new(mapping.inputs["Vector"], coords.outputs["Generated"])

    curtain = tree.nodes.new("ShaderNodeTexNoise")
    curtain.location = (-540, -320)
    curtain.inputs["Scale"].default_value = 2.2
    curtain.inputs["Detail"].default_value = 6.0
    curtain.inputs["Roughness"].default_value = 0.65
    # Stretching the noise vertically is what turns a blob field into
    # curtains; an unstretched noise gives clouds, not aurora.
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 0.22)
    tree.links.new(curtain.inputs["Vector"], mapping.outputs["Vector"])

    band = tree.nodes.new("ShaderNodeValToRGB")
    band.location = (-340, -320)
    band.color_ramp.elements[0].position = 0.42
    band.color_ramp.elements[0].color = (0, 0, 0, 1)
    band.color_ramp.elements[1].position = 0.62
    band.color_ramp.elements[1].color = (1, 1, 1, 1)
    tree.links.new(band.inputs["Fac"], curtain.outputs["Fac"])

    # Confine the aurora to the upper sky. Without this mask it wraps under
    # the horizon and lights the scene from below, which instantly reads wrong.
    mask = tree.nodes.new("ShaderNodeMapRange")
    mask.location = (-340, -520)
    mask.inputs["From Min"].default_value = 0.25
    mask.inputs["From Max"].default_value = 0.85
    mask.inputs["To Min"].default_value = 0.0
    mask.inputs["To Max"].default_value = 1.0
    mask.clamp = True
    tree.links.new(mask.inputs["Value"], sep.outputs["Z"])

    strengthen = tree.nodes.new("ShaderNodeMath")
    strengthen.location = (-160, -420)
    strengthen.operation = "MULTIPLY"
    tree.links.new(strengthen.inputs[0], band.outputs["Color"])
    tree.links.new(strengthen.inputs[1], mask.outputs["Result"])

    colour = tree.nodes.new("ShaderNodeValToRGB")
    colour.location = (0, -520)
    colour.color_ramp.elements[0].color = materials.AURORA_A
    colour.color_ramp.elements[1].color = materials.AURORA_B
    tree.links.new(colour.inputs["Fac"], curtain.outputs["Fac"])

    mix = tree.nodes.new("ShaderNodeMix")
    mix.location = (200, 0)
    mix.data_type = "RGBA"
    mix.blend_type = "SCREEN"
    tree.links.new(mix.inputs["Factor"], strengthen.outputs["Value"])
    tree.links.new(mix.inputs["A"], gradient.outputs["Color"])
    tree.links.new(mix.inputs["B"], colour.outputs["Color"])

    tree.links.new(background.inputs["Color"], mix.outputs["Result"])
    tree.links.new(out.inputs["Surface"], background.outputs["Background"])
    return world


def build_light_rig(
    key_energy: float = 4.0,
    key_angle: float = 0.9,
    fill_energy: float = 40.0,
    rim_energy: float = 90.0,
) -> dict[str, bpy.types.Object]:
    """Sun key, broad area fill, hard rim.

    `key_angle` in degrees controls how soft the sun's shadows are. A hard
    0.5-degree sun is physically correct and looks wrong here; the reference
    imagery is all shot through haze, so the key is widened until shadow edges
    go soft over a few centimetres.
    """
    rig: dict[str, bpy.types.Object] = {}

    sun_data = bpy.data.lights.new("FA_Key", type="SUN")
    sun_data.energy = key_energy
    sun_data.angle = math.radians(key_angle)
    sun_data.color = (1.0, 0.97, 0.92)
    sun = bpy.data.objects.new("FA_Key", sun_data)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    bpy.context.scene.collection.objects.link(sun)
    rig["key"] = sun

    fill_data = bpy.data.lights.new("FA_Fill", type="AREA")
    fill_data.energy = fill_energy
    fill_data.size = 12.0
    fill_data.color = (0.62, 0.85, 1.0)
    fill = bpy.data.objects.new("FA_Fill", fill_data)
    fill.location = (-6.0, -5.0, 3.0)
    fill.rotation_euler = (math.radians(70), 0.0, math.radians(-45))
    bpy.context.scene.collection.objects.link(fill)
    rig["fill"] = fill

    # The rim is the era's signature: a hard white edge that separates a glossy
    # object from a bright background. Without it, glass on sky disappears.
    rim_data = bpy.data.lights.new("FA_Rim", type="AREA")
    rim_data.energy = rim_energy
    rim_data.size = 3.0
    rim_data.color = (1.0, 1.0, 1.0)
    rim = bpy.data.objects.new("FA_Rim", rim_data)
    rim.location = (4.5, 6.0, 4.0)
    rim.rotation_euler = (math.radians(115), 0.0, math.radians(35))
    bpy.context.scene.collection.objects.link(rim)
    rig["rim"] = rim

    return rig


def add_caustic_projector(
    location=(0.0, 0.0, 6.0),
    size: float = 14.0,
    energy: float = 220.0,
) -> bpy.types.Object:
    """An area light textured with the caustics gobo, aimed straight down."""
    data = bpy.data.lights.new("FA_Caustics", type="AREA")
    data.energy = energy
    data.size = size
    data.use_nodes = True

    tree = data.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputLight")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0

    coords = tree.nodes.new("ShaderNodeTexCoord")
    coords.location = (-800, 0)
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.name = "CausticDrift"
    mapping.label = "CausticDrift"
    mapping.location = (-620, 0)
    tree.links.new(mapping.inputs["Vector"], coords.outputs["Normal"])

    cells = tree.nodes.new("ShaderNodeTexVoronoi")
    cells.location = (-420, 0)
    cells.feature = "SMOOTH_F1"
    cells.inputs["Scale"].default_value = 5.0
    tree.links.new(cells.inputs["Vector"], mapping.outputs["Vector"])

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-220, 0)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
    ramp.color_ramp.elements[1].position = 0.3
    ramp.color_ramp.elements[1].color = (0.05, 0.2, 0.4, 1.0)
    tree.links.new(ramp.inputs["Fac"], cells.outputs["Distance"])
    tree.links.new(emission.inputs["Color"], ramp.outputs["Color"])
    tree.links.new(out.inputs["Surface"], emission.outputs["Emission"])

    obj = bpy.data.objects.new("FA_Caustics", data)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_atmosphere(
    size: float = 40.0,
    scatter_density: float = 0.012,
    absorption_density: float = 0.0,
    anisotropy: float = 0.55,
    scatter=(0.75, 0.92, 1.0, 1.0),
    absorption=(0.35, 0.75, 0.95, 1.0),
) -> bpy.types.Object:
    """A volume box: visible light beams, and depth you can read as colour.

    Scattering and absorption get **separate densities**, which is the whole
    reason this builds two nodes instead of using Principled Volume. They are
    doing opposite jobs and want opposite amounts:

    *Absorption* is what makes a scene read as underwater. Water eats red
    first, so distant things go blue-green while near things stay neutral, and
    that gradient is the depth cue. It needs to be **strong** — visible
    tinting starts around an optical depth of 1, so over a 12m shot the
    density wants to be near 1/12, not the 0.01 that suits a room. `absorption`
    names the colour that *survives*, so a cyan value is what removes red.

    *Scattering* puts light in the air so beams are visible, and it needs to
    stay **weak**. Every unit of scattering also adds a veil of ambient light
    between camera and subject, so cranking it to get colour bleaches the
    contrast right back out. Anisotropy keeps what scattering there is pooled
    around the light rather than spread flatly over the frame.

    Tying them to one density forces a choice between a colourless scene and a
    foggy one. Separating them gives deep blue distance *and* crisp tiles.

    Scatter density is the main render-cost dial in the project. Tune it first
    if renders are slow; absorption is comparatively cheap.
    """
    mesh = bpy.data.meshes.new("FA_Atmosphere_mesh")
    obj = bpy.data.objects.new("FA_Atmosphere", mesh)
    bpy.context.scene.collection.objects.link(obj)

    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=size)
    bm.to_mesh(mesh)
    bm.free()

    mat = bpy.data.materials.new("FA_Atmosphere")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")

    scatter_node = tree.nodes.new("ShaderNodeVolumeScatter")
    scatter_node.location = (-300, 120)
    scatter_node.inputs["Density"].default_value = scatter_density
    scatter_node.inputs["Anisotropy"].default_value = anisotropy
    scatter_node.inputs["Color"].default_value = scatter

    absorb_node = tree.nodes.new("ShaderNodeVolumeAbsorption")
    absorb_node.location = (-300, -120)
    absorb_node.inputs["Density"].default_value = absorption_density
    absorb_node.inputs["Color"].default_value = absorption

    combine = tree.nodes.new("ShaderNodeAddShader")
    combine.location = (-100, 0)
    tree.links.new(combine.inputs[0], scatter_node.outputs["Volume"])
    tree.links.new(combine.inputs[1], absorb_node.outputs["Volume"])
    tree.links.new(out.inputs["Volume"], combine.outputs["Shader"])
    mesh.materials.append(mat)

    # Camera visibility stays ON, unintuitively. The box must be hit by camera
    # rays for them to enter the volume and pick up any scattering at all —
    # hiding it from the camera renders the god rays away entirely. It does
    # not wash out the frame, because the material has only a Volume output
    # and no Surface, so the box itself is never drawn.
    obj.visible_shadow = False
    return obj


def scatter_bokeh(
    count: int = 40,
    bounds=(-8.0, 8.0, -2.0, 10.0, -3.0, 6.0),
    radius_range=(0.04, 0.16),
    seed: int = 7,
) -> list[bpy.types.Object]:
    """Emissive motes in front of the camera, to be thrown out of focus.

    These are not decoration you could paint in post. Real bokeh comes from
    real points of light passing through a real aperture, so they occlude each
    other, brighten as they cross a bright background, and drift with true
    parallax. Compositing circles on top gets none of that.

    Their brightness is deliberately far above 1.0: a mote only blooms into a
    proper bokeh disc if it survives the tonemap after being blurred across a
    few hundred pixels.
    """
    rng = random.Random(seed)
    mat = bpy.data.materials.new("FA_Bokeh")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0.75, 0.95, 1.0, 1.0)
    emission.inputs["Strength"].default_value = 24.0
    tree.links.new(out.inputs["Surface"], emission.outputs["Emission"])

    import bmesh

    motes: list[bpy.types.Object] = []
    x0, x1, y0, y1, z0, z1 = bounds
    for i in range(count):
        mesh = bpy.data.meshes.new(f"FA_Bokeh_{i:03d}_mesh")
        bm = bmesh.new()
        # Subdivision 2, not 1: a mote sits close to the lens and gets
        # magnified hard by the defocus, so an icosahedron's flat faces show
        # up as visible hexagonal edges on the bokeh disc.
        bmesh.ops.create_icosphere(
            bm, subdivisions=2, radius=rng.uniform(*radius_range)
        )
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)

        obj = bpy.data.objects.new(f"FA_Bokeh_{i:03d}", mesh)
        obj.location = (
            rng.uniform(x0, x1),
            rng.uniform(y0, y1),
            rng.uniform(z0, z1),
        )
        obj.visible_shadow = False
        bpy.context.scene.collection.objects.link(obj)
        motes.append(obj)
    return motes


def add_camera(
    location=(0.0, -9.0, 2.4),
    look_at=(0.0, 0.0, 1.2),
    lens: float = 55.0,
    f_stop: float = 2.2,
) -> bpy.types.Object:
    """Camera with depth of field focused on `look_at`.

    Focus is set as a distance rather than a focus object so that animating
    the subject does not drag focus with it — the shallow plane is a fixed
    part of the composition here, not a tracking shot.
    """
    data = bpy.data.cameras.new("FA_Camera")
    data.lens = lens
    data.dof.use_dof = True
    data.dof.aperture_fstop = f_stop

    obj = bpy.data.objects.new("FA_Camera", data)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)

    direction = tuple(l - c for l, c in zip(look_at, location))
    data.dof.focus_distance = math.sqrt(sum(d * d for d in direction))
    obj.rotation_euler = _look_rotation(direction)

    bpy.context.scene.camera = obj
    return obj


def _look_rotation(direction) -> tuple[float, float, float]:
    """Euler angles aiming a Blender camera's -Z axis down `direction`.

    An unrotated camera looks along -Z. Pitching by the polar angle swings
    that onto the horizon, then the Z rotation spins it to the right bearing.

    The -pi/2 is the part worth stating: after the pitch the camera points
    along +Y, not +X, so the yaw has to be measured from +Y. Using +pi/2
    instead aims it exactly backwards — which renders as a perfectly clean,
    entirely black frame, with nothing in the scene to suggest why.
    """
    dx, dy, dz = direction
    horizontal = math.hypot(dx, dy)
    return (
        math.atan2(horizontal, dz),
        0.0,
        math.atan2(dy, dx) - math.pi / 2,
    )
