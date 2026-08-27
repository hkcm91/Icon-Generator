"""
Deep Field — the wallpaper scene.

A column of water. The surface is overhead and bright, seen from below and
rippling; the bottom of frame falls away into blue-black. Shafts of light rake
down through it. Bubbles rise. And drifting in the middle distance, far enough
back that the fog has taken them apart, are tiles from the icon set — colour
rather than shape, unreadable as icons and unmistakably the same material.

The composition is doing one job, and everything here serves it: **the icon
grid sits in the darkest, quietest band of the frame**. That is not an
aesthetic preference. Bright aqua icons on a bright aqua background stop being
objects and become texture, so the wallpaper has to be the same world seen from
somewhere darker. Being underwater is the cheapest honest way to get a bright
top and a dark middle, which is why this concept won.

One scene, two cameras. The phone framing is portrait with the light overhead;
the desktop framing is landscape and rolled so the brightness gathers to the
right, because desktop icons cluster on the left and the quiet zone has to move
with them.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy

from . import materials
from .loop import LoopClock, bake, bake_socket
from .spec import ContainerSpec
from .tile import build_tile

# --- placement ---------------------------------------------------------------
#
# Everything scattered in this scene is placed by an explicit little generator
# rather than by `random`. It is not that `random` is unseeded — it is that the
# scene is a build artifact, and a build artifact that depends on an
# implementation detail of the standard library is one Python upgrade away from
# quietly recomposing itself. Sixteen lines of LCG is cheaper than that risk.

_MASK = (1 << 48) - 1


class Scatter:
    """A tiny linear congruential generator. Same seed, same scene, forever."""

    def __init__(self, seed: int) -> None:
        self.state = (seed ^ 0x5DEECE66D) & _MASK

    def next(self) -> float:
        """The next value in 0..1."""
        self.state = (self.state * 0x5DEECE66D + 0xB) & _MASK
        return (self.state >> 16) / float(1 << 32)

    def between(self, low: float, high: float) -> float:
        return low + (high - low) * self.next()

    def pick(self, items):
        return items[int(self.next() * len(items)) % len(items)]


# --- primitives --------------------------------------------------------------


def quad(name: str, width: float, height: float) -> bpy.types.Object:
    """
    A quad standing in XZ, facing -Y, with UVs running (0,0) bottom-left.

    The camera looks along +Y and never rolls far from upright, so a quad built
    this way is camera-facing without a track-to constraint. That matters at a
    hundred instances: constraints are evaluated per frame, geometry is not.
    """
    half_w, half_h = width / 2.0, height / 2.0
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(
        [(-half_w, 0.0, -half_h), (half_w, 0.0, -half_h), (half_w, 0.0, half_h), (-half_w, 0.0, half_h)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()

    uv = mesh.uv_layers.new(name="UVMap")
    for i, coord in enumerate([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]):
        uv.data[i].uv = coord

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def horizontal_plane(name: str, size: float, height: float) -> bpy.types.Object:
    """
    A large flat plane at a given Z, built in its own XY so object coordinates
    vary across both axes — which is what the caustic material reads.
    """
    half = size / 2.0
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(
        [(-half, -half, 0.0), (half, -half, 0.0), (half, half, 0.0), (-half, half, 0.0)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()

    uv = mesh.uv_layers.new(name="UVMap")
    for i, coord in enumerate([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]):
        uv.data[i].uv = coord

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (0.0, 0.0, height)
    return obj


def volume_box(name: str, size: tuple[float, float, float]) -> bpy.types.Object:
    """A box enclosing the whole scene, camera included, to hold the medium."""
    x, y, z = (v / 2.0 for v in size)
    verts = [
        (-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
        (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z),
    ]
    faces = [
        (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
        (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# --- the scene ---------------------------------------------------------------

SURFACE_HEIGHT = 9.0
FLOOR_DEPTH = -11.0


def build(
    spec: ContainerSpec,
    clock: LoopClock,
    icons: list[Path],
    framing: str = "phone",
    bubbles: int = 55,
    rays: int = 6,
    far_tiles: int = 11,
    seed: int = 20260826,
) -> None:
    """Assemble the whole scene into the current (empty) scene."""
    scene = bpy.context.scene
    scatter = Scatter(seed)

    _add_medium(scene)
    _add_surface(scene, clock)
    _add_bleed(scene)
    _add_rays(scene, clock, scatter, count=rays)
    _add_bubbles(scene, clock, scatter, count=bubbles)
    _add_far_tiles(scene, clock, scatter, spec, icons, count=far_tiles)
    _add_light(scene)
    _add_cameras(scene, framing)


def _add_medium(scene: bpy.types.Scene) -> None:
    """
    The water itself, and the reason the far field reads as colour.

    The world behind it is nearly black rather than blue. All the blue in this
    scene comes from light scattering in the medium on its way to the camera,
    which is both how water actually works and the only version that keeps
    getting darker the further down the frame you look.
    """
    box = volume_box("WaterColumn", (140.0, 140.0, 90.0))
    box.data.materials.append(materials.water_volume(density=0.045, surface_height=SURFACE_HEIGHT, floor_depth=FLOOR_DEPTH - 8.0))

    world = bpy.data.worlds.new("Deep")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.004, 0.024, 0.043, 1.0)
    background.inputs["Strength"].default_value = 1.0
    scene.world = world


def _add_surface(scene: bpy.types.Scene, clock: LoopClock) -> None:
    """
    The waterline overhead — the brightest thing in the frame, and the anchor
    the clock sits against.
    """
    # Far wider than the frame needs. The medium is dense enough that the
    # plane's own far edge would otherwise appear as a horizon line across the
    # upper third — a hard horizontal rule exactly where the clock sits.
    plane = horizontal_plane("Surface", size=600.0, height=SURFACE_HEIGHT)
    material = materials.water_surface(scale=0.085, strength=3.2)
    plane.data.materials.append(material)

    socket = material.node_tree.nodes["CausticPhase"].outputs["Value"]
    bake_socket(socket, lambda frame: clock.phase(frame, cycles=1), clock.frames, step=clock.sample_step(120))

    # The sun, seen through the surface: a radial glow rather than a bright
    # patch of the same caustic material, because a patch has corners and the
    # aperture only softens them, never removes them.
    sun_patch = horizontal_plane("SunPatch", size=30.0, height=SURFACE_HEIGHT - 0.2)
    sun_patch.location = (3.5, 17.0, SURFACE_HEIGHT - 0.2)
    sun_patch.data.materials.append(materials.radial_glow("SunPatch", strength=11.0))


def _add_bleed(scene: bpy.types.Scene) -> None:
    """The wash of light below the waterline, softening Snell's hard edge."""
    # Short, and hung directly off the waterline. The first version was
    # twenty-six units tall and washed the whole upper frame to white — the
    # bleed is meant to soften one edge, not to light the scene.
    height = 8.0
    card = quad("LightBleed", 150.0, height)
    card.location = (0.0, 26.0, SURFACE_HEIGHT - height / 2.0)
    card.data.materials.append(materials.light_bleed(strength=0.55))


def _add_rays(scene: bpy.types.Scene, clock: LoopClock, scatter: Scatter, count: int) -> None:
    """
    Light shafts, fanning down and out from the sun patch.

    They sway rather than travel. A shaft that slides across the frame reads as
    a searchlight; a shaft that leans a degree or two either side reads as the
    surface moving above it, which is the thing actually being depicted.
    """
    material = materials.god_ray(colour=(0.125, 0.596, 1.000, 1.0), strength=1.15)
    for index in range(count):
        width = scatter.between(2.8, 6.5)
        height = SURFACE_HEIGHT - FLOOR_DEPTH
        card = quad(f"Ray_{index}", width, height)
        card.data.materials.append(material)

        depth = scatter.between(6.0, 34.0)
        spread = scatter.between(-1.0, 1.0)
        card.location = (3.0 + spread * depth * 0.45, depth, (SURFACE_HEIGHT + FLOOR_DEPTH) / 2.0)

        # Leaning the card away from vertical is what makes the shafts appear
        # to converge on the sun rather than run parallel down the frame.
        lean = math.radians(spread * 13.0)
        phase = index / count
        bake(
            card,
            "rotation_euler",
            lambda frame, lean=lean, phase=phase: lean
            + math.radians(1.6) * clock.sine(frame, cycles=1, offset=phase),
            clock.frames,
            index=1,
        )


def _add_bubbles(scene: bpy.types.Scene, clock: LoopClock, scatter: Scatter, count: int) -> None:
    """
    Rising bubbles, each on its own phase offset.

    One bubble rising and vanishing is a loop with a visible seam. Fifty of
    them, evenly spread across the phase so that at any instant some are
    starting while others are ending, is a continuous field — the loop point
    stops existing because there is no moment when the whole population resets
    together.

    Position and opacity must be driven by *the same* phase, and getting that
    wrong is subtle enough to survive review. An earlier version travelled on
    a plain two-keyframe ramp while the fade ran off `rise(frame, offset)`:
    both closed the loop on their own, but they closed it at different
    moments, so a bubble that was halfway up at full opacity teleported back
    to the bottom in plain sight. It measured as a wrap 3.1x an ordinary step
    (`tools/loop_check.py`) and it was invisible in the phase unit tests,
    because the phase maths was never what was wrong.

    So both come off one `rise`. Where it wraps, the bubble does jump — and
    the fade is exactly zero there, which is what makes the jump unobservable
    rather than merely fast.
    """
    material = materials.bubble(strength=1.1)
    for index in range(count):
        size = scatter.between(0.04, 0.17)
        card = quad(f"Bubble_{index}", size, size)

        # Each bubble owns a copy of the material, because each one keyframes
        # its own fade. Sharing would make the whole field blink in unison.
        own = material.copy()
        own.name = f"Bubble_{index}"
        card.data.materials.append(own)

        x = scatter.between(-18.0, 18.0)
        y = scatter.between(2.0, 42.0)
        offset = scatter.next()
        # Bigger bubbles rise faster, which is true and also keeps the field
        # from moving like a single sheet.
        travel = (SURFACE_HEIGHT - FLOOR_DEPTH) * scatter.between(0.45, 0.9)

        def height(frame: int, offset: float = offset, travel: float = travel) -> float:
            return FLOOR_DEPTH + travel * clock.rise(frame, offset=offset)

        card.location = (x, y, height(1))
        bake(card, "location", height, clock.frames, index=2)
        bake_socket(
            own.node_tree.nodes["BubbleFade"].outputs["Value"],
            lambda frame, offset=offset: LoopClock.fade(clock.rise(frame, offset=offset), edge=0.2),
            clock.frames,
            step=clock.sample_step(),
        )


def _add_far_tiles(
    scene: bpy.types.Scene,
    clock: LoopClock,
    scatter: Scatter,
    spec: ContainerSpec,
    icons: list[Path],
    count: int,
) -> None:
    """
    The icon set, in the far field.

    This is the part that makes the wallpaper belong to *this* icon pack, and
    the part with the most obvious way to fail. If a tile back here ever
    resolves as a tile, the home screen is squircles on a background of
    squircles and every icon disappears into it.

    Four things keep that from happening, and all four are needed: the tiles
    sit far enough away that the medium has eaten most of their contrast, the
    camera's aperture throws them well past recognition, none of them are ever
    at the size or spacing of the real grid, and they are held *above* the
    grid entirely — up under the surface, where a launcher puts nothing but a
    clock. That last one was learned from `tools/mock_homescreen.py`: with a
    real grid composited on top, tiles at the same height as the first row
    were the one thing that genuinely looked tappable.

    They drift on a sine rather than rising. A one-way rise needs an opacity
    envelope to hide its reset, and glass has no opacity to fade — a sine
    returns to where it started on its own, which is the only kind of motion
    that closes a loop without help.
    """
    glass = materials.aero_glass(
        "FarGlass", density=2.1, rim_strength=6.5, tint=(0.157, 0.647, 0.878, 1.0)
    )
    for index in range(count):
        icon = scatter.pick(icons) if icons else None
        obj = build_tile(spec, name=f"Far_{index}", glass=glass, icon=icon)

        depth = scatter.between(12.0, 34.0)
        # Held to a narrow angular size band, deliberately unlike the grid's.
        size = depth * scatter.between(0.014, 0.028)
        obj.scale = (size, size, size)

        x = scatter.between(-0.85, 0.85) * depth * 0.5
        offset = scatter.next()
        drift = scatter.between(0.5, 1.4)
        base = scatter.between(4.5, SURFACE_HEIGHT - 0.9)

        obj.location = (x, depth, base)
        bake(
            obj,
            "location",
            lambda frame, base=base, drift=drift, offset=offset: base
            + drift * clock.sine(frame, cycles=1, offset=offset),
            clock.frames,
            index=2,
        )

        tumble = math.radians(scatter.between(9.0, 26.0))
        bake(
            obj,
            "rotation_euler",
            lambda frame, tumble=tumble, offset=offset: tumble
            * clock.sine(frame, cycles=1, offset=offset),
            clock.frames,
            index=1,
        )
        bake(
            obj,
            "rotation_euler",
            lambda frame, tumble=tumble, offset=offset: tumble
            * 0.6
            * clock.sine(frame, cycles=1, offset=offset + 0.25),
            clock.frames,
            index=0,
        )


def _add_light(scene: bpy.types.Scene) -> None:
    """
    A single sun, angled the way light enters water: steep, and from the same
    side as the bright patch on the surface.

    A wide angular diameter softens the shadows to nearly nothing, which is
    correct — under a few metres of water there are no hard shadows, and hard
    shadows across an icon grid would be a disaster anyway.
    """
    data = bpy.data.lights.new("Sun", "SUN")
    data.energy = 9.0
    data.angle = math.radians(11.0)
    data.color = (1.0, 0.97, 0.9)
    sun = bpy.data.objects.new("Sun", data)
    scene.collection.objects.link(sun)
    sun.location = (6.0, 16.0, 24.0)
    sun.rotation_euler = (math.radians(22.0), math.radians(-8.0), math.radians(14.0))


def _add_cameras(scene: bpy.types.Scene, framing: str) -> bpy.types.Object:
    """
    Both framings, built into the same scene; `framing` picks which is active.

    Rendering one master and cropping it is the usual advice and it is wrong
    here. The composition is a *vertical* value gradient tuned so the middle
    band is dark, and a 16:9 crop out of a portrait frame either throws away
    the bright surface or drags it down into the icon band. Two cameras on one
    scene costs a second render and keeps both compositions correct.
    """
    cameras = {}

    # Portrait: the surface overhead, the grid in the dark middle, the deep at
    # the bottom of frame behind the dock.
    phone_data = bpy.data.cameras.new("PhoneCam")
    phone_data.lens = 32.0
    phone_data.dof.use_dof = True
    phone_data.dof.focus_distance = 5.0
    phone_data.dof.aperture_fstop = 1.4
    phone = bpy.data.objects.new("PhoneCam", phone_data)
    scene.collection.objects.link(phone)
    phone.location = (0.0, -7.0, 0.6)
    phone.rotation_euler = (math.radians(72.0), 0.0, 0.0)
    cameras["phone"] = phone

    # Landscape: desktop icons live down the left edge, so the frame is rolled
    # and shifted to gather the light to the right and leave that column dark.
    desk_data = bpy.data.cameras.new("DesktopCam")
    desk_data.lens = 38.0
    desk_data.dof.use_dof = True
    desk_data.dof.focus_distance = 9.0
    desk_data.dof.aperture_fstop = 1.8
    desk_data.shift_x = 0.06
    desktop = bpy.data.objects.new("DesktopCam", desk_data)
    scene.collection.objects.link(desktop)
    desktop.location = (-1.4, -9.0, 1.2)
    desktop.rotation_euler = (math.radians(84.0), math.radians(-2.0), math.radians(9.0))
    cameras["desktop"] = desktop

    chosen = cameras.get(framing, phone)
    scene.camera = chosen
    return chosen
