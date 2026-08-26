"""
Scene 01 — "Aquarium Dock".

The icons hang suspended in still, sunlit water. Caustics from the surface
overhead crawl across their faces, bubbles rise past them, and an aurora sky
shows through the waterline at the top of frame.

Why this one first, of the concepts in BRAINSTORM.md: the icons the generator
produces are *already* painted as wet glass with internal bubbles. Putting
them anywhere dry means the artwork and the environment argue about what
material the icon is made of. Submerging them makes the painted highlights
literal, so the 2D art and the 3D lighting agree — and every technique the
other concepts need (loop-safe drift, caustics, thin-film glass, volumetrics,
icon tiles) gets exercised here, which is what makes this the reference scene
rather than merely the first one.

Composition: a shallow arc of tiles rather than a flat grid. An arc gives
every tile a slightly different angle to the key light, so the specular
highlight walks along the row instead of appearing on all of them at once —
the difference between a rendered image and a contact sheet.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy

from .. import environment, geometry, icons, loop as fa_loop, materials


def build(
    icon_dir: Path,
    spec: fa_loop.Loop,
    tile_count: int = 9,
    bubble_count: int = 28,
    seed: int = 11,
) -> dict:
    """Populate the current scene. Returns the handles a caller may want."""
    rng = random.Random(seed)
    scene = bpy.context.scene
    spec.apply_to_scene(scene)

    # Deep water below, sky above. The default world is a sky gradient that
    # runs to near-white at the horizon, which is right for a scene shot in
    # air and wrong here: it fills everything behind the tiles with bright
    # haze and there is no amount of volume tinting that recovers contrast
    # from a white backdrop. Below the waterline the background *is* the
    # water, so it has to start dark.
    environment.build_world(
        top=materials.SKY,
        bottom=materials.DEEP_AQUA,
        strength=1.2,
        aurora=True,
    )
    rig = environment.build_light_rig()

    # Below the water plane, deliberately. Aimed from above it, every caustic
    # ray would have to refract through a transmissive surface to reach the
    # tiles — which is both the slowest thing Cycles can be asked to do and,
    # with refractive caustics off for noise reasons, nearly invisible anyway.
    # Hanging the projector just under the surface gets the same look for
    # nothing.
    caustics = environment.add_caustic_projector(location=(0.0, 1.0, 6.0), size=18.0)

    # Densities are set by the distance they act over, not by taste. The tiles
    # sit 10-14m out and an effect only reads around an optical depth of 1, so
    # absorption wants ~1/12. Scattering is held an order of magnitude lower:
    # enough for the key light to show as beams, little enough that the tiles
    # keep their contrast.
    environment.add_atmosphere(
        size=52.0,
        scatter_density=0.008,
        absorption_density=0.075,
        scatter=(0.55, 0.86, 1.0, 1.0),
        absorption=(0.22, 0.72, 0.92, 1.0),
    )

    camera = environment.add_camera(
        location=(0.0, -11.5, 2.2),
        look_at=(0.0, 1.0, 1.5),
        lens=50.0,
        f_stop=2.0,
    )

    surface = _build_water_surface(z=6.8, size=44.0)
    tiles = _build_arc(icon_dir, tile_count, spec, rng)
    bubbles = _build_bubbles(bubble_count, spec, rng)
    motes = _build_bokeh(spec, rng)

    _animate_shaders(spec, surface)

    return {
        "camera": camera,
        "rig": rig,
        "caustics": caustics,
        "surface": surface,
        "tiles": tiles,
        "bubbles": bubbles,
        "bokeh": motes,
    }


# ---------------------------------------------------------------------------


def _build_water_surface(z: float, size: float) -> bpy.types.Object:
    """The underside of the water, seen from below.

    Subdivided rather than a single quad because the material displaces its
    normal from a noise field, and a flat quad's four vertices give the shader
    nothing to interpolate between — the ripples would shade as if the surface
    were a mirror with a pattern painted on it.
    """
    import bmesh

    mesh = bpy.data.meshes.new("FA_WaterSurface_mesh")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=64, y_segments=64, size=size / 2)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True

    obj = bpy.data.objects.new("FA_WaterSurface", mesh)
    obj.location = (0.0, 0.0, z)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(materials.water())
    return obj


def _build_arc(
    icon_dir: Path,
    count: int,
    spec: fa_loop.Loop,
    rng: random.Random,
) -> list[bpy.types.Object]:
    """Lay the tiles on a shallow arc and give each its own drift."""
    tiles = icons.build_tiles(
        icon_dir,
        count,
        size=0.62,
        thickness=0.14,
        dome=0.18,
        shuffle_seed=None,
    )

    radius = 8.5
    spread = math.radians(40)

    for i, tile in enumerate(tiles):
        # Centre the arc on the camera axis, hero icon in the middle.
        f = 0.0 if count == 1 else (i / (count - 1)) * 2.0 - 1.0
        angle = f * spread / 2

        # Depth jitter on top of the arc. Without it every tile sits at the
        # same distance and the shallow focus plane either has all of them
        # sharp or none — which throws away the one cue that separates a
        # volume of water from a flat wall of stickers.
        home = (
            math.sin(angle) * radius,
            math.cos(angle) * radius - radius + 1.0 + rng.uniform(-1.1, 1.4),
            1.5 + rng.uniform(-0.7, 0.7),
        )

        # Each tile gets its own phase so the row breathes raggedly. Phases
        # from a golden-ratio walk rather than rng: an even spread around the
        # cycle guarantees no two neighbours ever peak together, which random
        # offsets routinely do at these counts.
        phase = (i * 0.618034) % 1.0
        drift = rng.uniform(0.85, 1.25)

        _animate_tile(tile, home, phase, drift, spec, angle)
        tiles[i] = tile

    return tiles


def _animate_tile(
    tile: bpy.types.Object,
    home: tuple[float, float, float],
    phase: float,
    drift: float,
    spec: fa_loop.Loop,
    angle: float,
) -> None:
    """Buoyant bob, lateral sway and a slow tilt — all periodic over the loop.

    The sway runs at one cycle and the tilt at two. Whole-number ratios keep
    the loop exact; the 2:1 relationship also stops the motion reading as a
    single pendulum, because the tile is turning twice for every drift across.
    """
    x, y, z = home

    fa_loop.bake_vector(
        tile,
        "location",
        lambda t: (
            x + fa_loop.wave(t, 0.07 * drift, phase),
            y + fa_loop.wave2(t, 0.05 * drift, phase + 0.25),
            z + fa_loop.bob(t, 0.16 * drift, phase),
        ),
        spec,
    )

    # Face the camera, then rock around that rest pose.
    fa_loop.bake_vector(
        tile,
        "rotation_euler",
        lambda t: (
            math.radians(90) + fa_loop.wave(t, math.radians(3.5), phase + 0.1, cycles=2),
            fa_loop.wave(t, math.radians(4.5), phase + 0.4),
            -angle + fa_loop.wave2(t, math.radians(3.0), phase, cycles=2),
        ),
        spec,
    )


def _build_bubbles(
    count: int,
    spec: fa_loop.Loop,
    rng: random.Random,
) -> list[bpy.types.Object]:
    """Bubbles rising through the frame on wrapping paths.

    Each bubble travels its whole span over exactly one loop and is faded out
    at both ends, so the teleport back to the bottom happens at zero alpha.
    That is why this needs no particle system and no cache: the .blend opens
    and plays correctly with nothing to bake.
    """
    material = materials.bubble()
    bubbles: list[bpy.types.Object] = []
    span = 9.0

    for i in range(count):
        radius = rng.uniform(0.035, 0.14)
        obj = geometry.create_bubble(f"FA_Bubble_{i:03d}", radius=radius, subdivisions=2)
        obj.data.materials.append(material)
        obj.visible_shadow = False

        x = rng.uniform(-5.0, 5.0)
        y = rng.uniform(-1.5, 6.5)
        base = -3.2
        phase = rng.random()
        wobble = rng.uniform(0.06, 0.16)

        # Bigger bubbles rise faster, as they do in water — if size and speed
        # disagree the shot loses its sense of scale and the tank reads as a
        # flat backdrop. Speed is quantised to whole traversals per loop
        # because `travel` requires it; two values are plenty, since the
        # continuous spread of radii and wobbles hides the quantisation.
        cycles = 2 if radius >= 0.09 else 1

        fa_loop.bake_vector(
            obj,
            "location",
            lambda t, x=x, y=y, base=base, phase=phase, cycles=cycles, wobble=wobble: (
                x + fa_loop.wave(t, wobble, phase, cycles=3),
                y + fa_loop.wave2(t, wobble * 0.6, phase, cycles=2),
                base + fa_loop.rise(t, span, phase, cycles=cycles),
            ),
            spec,
        )

        _fade_bubble(obj, phase, cycles, spec)
        bubbles.append(obj)

    return bubbles


def _fade_bubble(
    obj: bpy.types.Object,
    phase: float,
    cycles: int,
    spec: fa_loop.Loop,
) -> None:
    """Scale the bubble to nothing at the ends of its travel.

    Scale, not alpha: the bubbles share one material, so per-object alpha
    would need a material copy each and 28 extra shader compiles. Shrinking to
    zero reads identically at these sizes and keeps the scene to one glass
    shader.

    The `phase` and `cycles` here must match the ones given to `rise` exactly
    — that is what puts the vanishing point on the same frame as the wrap.
    """
    base = obj.scale[0]
    dead = spec.dead_zone(cycles)
    ramp = max(0.18, dead * 2.5)

    fa_loop.bake_vector(
        obj,
        "scale",
        lambda t: tuple(
            [base * fa_loop.fade_at_ends(t, phase, ramp=ramp, cycles=cycles, dead=dead)] * 3
        ),
        spec,
    )


def _build_bokeh(spec: fa_loop.Loop, rng: random.Random) -> list[bpy.types.Object]:
    """Out-of-focus motes drifting in front of the lens."""
    # Kept well in front of the focus plane at ~12m, so they blur into discs
    # rather than reading as small bright spheres.
    motes = environment.scatter_bokeh(
        count=34,
        bounds=(-7.0, 7.0, -8.5, -3.5, -1.5, 5.0),
        radius_range=(0.02, 0.07),
        seed=rng.randrange(10_000),
    )

    for i, mote in enumerate(motes):
        home = tuple(mote.location)
        phase = (i * 0.618034) % 1.0
        amp = rng.uniform(0.12, 0.4)
        fa_loop.bake_vector(
            mote,
            "location",
            lambda t, home=home, phase=phase, amp=amp: (
                home[0] + fa_loop.wave(t, amp, phase),
                home[1] + fa_loop.wave2(t, amp * 0.5, phase + 0.3),
                home[2] + fa_loop.wave(t, amp * 0.7, phase + 0.6),
            ),
            spec,
        )
    return motes


def _animate_shaders(spec: fa_loop.Loop, surface: bpy.types.Object) -> None:
    """Walk every drift-mapping node around its circle in noise space.

    Nodes are found by name (`WaterDrift`, `CausticDrift`, `AuroraDrift`)
    rather than by position in the tree, so a shader can be rebuilt or
    rewired by hand in Blender without breaking the animation — as long as the
    node keeps its name.
    """
    targets = [
        (surface.data.materials[0].node_tree, "WaterDrift", 0.42, 0.0),
        (bpy.data.worlds["FA_World"].node_tree, "AuroraDrift", 0.18, 0.35),
    ]

    for light in bpy.data.lights:
        if light.use_nodes and light.node_tree.nodes.get("CausticDrift"):
            targets.append((light.node_tree, "CausticDrift", 0.55, 0.6))

    for tree, name, radius, offset in targets:
        node = tree.nodes.get(name)
        if node is None:
            continue
        socket = node.inputs["Location"]
        fa_loop.bake_vector(
            socket,
            "default_value",
            lambda t, r=radius, o=offset: fa_loop.circular_noise_offset(t, r, o),
            spec,
        )
