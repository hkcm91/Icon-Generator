#!/usr/bin/env python3
"""
Build the aqua scene from a container spec.

Runs either way:

    python3 build_scene.py --target contact --still          # bpy as a module
    blender --background --python build_scene.py -- --still   # installed Blender

The second form is what you want on a machine with a GPU. The first is what
runs in a container, and is why the preview path uses Cycles on CPU: EEVEE
needs a real GL context and there isn't one.

Nothing here is a finished wallpaper yet. `studio` is the look-dev scene — the
tiles, the glass, the light, the loop clock — which is the part every candidate
concept needs regardless of which one gets built on top.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aero import deepfield, materials, render, spec as spec_mod, tile as tile_mod  # noqa: E402
from aero.loop import LoopClock, bake, bake_socket  # noqa: E402

HERE = Path(__file__).resolve().parent


def parse_args(argv: list[str]) -> argparse.Namespace:
    # Blender hands the script everything after a bare '--'.
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    elif Path(argv[0] if argv else "").name in ("blender", "build_scene.py"):
        argv = argv[1:]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", default=str(HERE / "specs" / "aqua-default.json"))
    parser.add_argument("--icons", default=None, help="directory of exported icon PNGs")
    parser.add_argument("--scene", default="deepfield", choices=["deepfield", "studio"])
    parser.add_argument(
        "--framing",
        default=None,
        choices=["phone", "desktop"],
        help="which camera to render deepfield from; inferred from --target if omitted",
    )
    parser.add_argument("--target", default="contact", choices=sorted(render.TARGETS))
    parser.add_argument("--engine", default="cycles", choices=["cycles", "eevee"])
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--percent", type=int, default=100)
    parser.add_argument("--frames", type=int, default=300, help="loop length in frames")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--columns", type=int, default=3, help="tiles across in studio")
    parser.add_argument("--rows", type=int, default=1)
    parser.add_argument("--bubbles", type=int, default=55)
    parser.add_argument("--rays", type=int, default=6)
    parser.add_argument("--far-tiles", type=int, default=11)
    parser.add_argument("--seed", type=int, default=20260826)
    parser.add_argument("--view", default="Standard")
    parser.add_argument("--look", default="None")
    parser.add_argument("--exposure", type=float, default=0.0)
    parser.add_argument("--still", action="store_true", help="render one frame")
    parser.add_argument("--animation", action="store_true", help="render the whole loop")
    parser.add_argument("--video", action="store_true", help="encode to MP4 instead of PNGs")
    parser.add_argument("--out", default=str(HERE / "out" / "render"))
    parser.add_argument("--save-blend", default=None)
    return parser.parse_args(argv)


def reset_scene() -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = materials.aqua_world()
    return scene


def add_camera(scene: bpy.types.Scene, distance: float, height: float = 0.0):
    data = bpy.data.cameras.new("Camera")
    data.lens = 60
    data.dof.use_dof = True
    data.dof.focus_distance = distance
    data.dof.aperture_fstop = 2.4
    camera = bpy.data.objects.new("Camera", data)
    scene.collection.objects.link(camera)
    camera.location = (0.0, -distance, height)
    camera.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.camera = camera
    return camera


def add_key_light(scene: bpy.types.Scene):
    """
    One hard key from high and behind-left, plus a cool fill from below.

    Backlighting is the whole game with transmissive material: a key placed in
    front lights the *surface* and the tile goes opaque and plasticky, while a
    key placed behind pushes light through the volume and the tint reads. The
    fill from below is the water bounce — the cheapest single cue that says
    "submerged" rather than "on a desk".
    """
    key_data = bpy.data.lights.new("Key", "AREA")
    key_data.energy = 320.0
    key_data.size = 4.0
    key_data.color = (1.0, 0.98, 0.92)
    key = bpy.data.objects.new("Key", key_data)
    scene.collection.objects.link(key)
    key.location = (-2.6, 3.4, 3.6)
    key.rotation_euler = (math.radians(52), 0.0, math.radians(216))

    fill_data = bpy.data.lights.new("Fill", "AREA")
    fill_data.energy = 90.0
    fill_data.size = 8.0
    fill_data.color = (0.42, 0.78, 1.0)
    fill = bpy.data.objects.new("Fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (1.8, -2.4, -2.6)
    fill.rotation_euler = (math.radians(-40), 0.0, math.radians(40))
    return key, fill


def add_caustic_backdrop(scene: bpy.types.Scene, clock: LoopClock, distance: float, size: float):
    """
    The lit wall behind everything, and the loop's first moving part.

    Placed far enough back that it is out of focus at the camera's f-stop, so
    it contributes light and colour without reading as a surface.
    """
    # Built flat in its own XY and then stood up, rather than authored directly
    # in world space. The caustic material reads object coordinates, and a
    # plane authored edge-on has a constant local Y — which collapses a 2D
    # pattern into 1D stripes. Keeping the geometry in XY means the same
    # material works on a wall, a floor or a ceiling without editing nodes.
    mesh = bpy.data.meshes.new("BackdropMesh")
    half = size / 2.0
    mesh.from_pydata(
        [(-half, -half, 0.0), (half, -half, 0.0), (half, half, 0.0), (-half, half, 0.0)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()

    obj = bpy.data.objects.new("Backdrop", mesh)
    scene.collection.objects.link(obj)
    obj.location = (0.0, distance, 0.0)
    obj.rotation_euler = (math.pi / 2, 0.0, 0.0)

    # Voronoi scale is in cells per unit, so it has to be derived from the
    # plane's size or the pattern's density changes every time the camera
    # distance does. Roughly ten cells across the visible width.
    material = materials.caustic_backdrop(scale=10.0 / size)
    obj.data.materials.append(material)

    socket = material.node_tree.nodes["CausticPhase"].outputs["Value"]
    bake_socket(socket, lambda frame: clock.phase(frame, cycles=1), clock.frames)
    return obj


def build_studio(args: argparse.Namespace, container, clock: LoopClock) -> None:
    """
    A short row of tiles, lit, bobbing on a loop.

    The bob is the smallest honest test of the loop discipline: if the phase
    maths is wrong anywhere, a tile visibly jumps at the wrap and you find out
    in a 3-second preview instead of after a 300-frame render.
    """
    icons = tile_mod.find_icons(args.icons) if args.icons else []
    glass = materials.aero_glass("AeroGlass")

    spacing = 1.18
    columns, rows = max(1, args.columns), max(1, args.rows)
    origin_x = -(columns - 1) * spacing / 2.0
    origin_z = -(rows - 1) * spacing / 2.0

    index = 0
    for row in range(rows):
        for column in range(columns):
            icon = icons[index % len(icons)] if icons else None
            obj = tile_mod.build_tile(
                container,
                name=f"Tile_{row}_{column}",
                glass=glass,
                icon=icon,
            )
            x = origin_x + column * spacing
            z = origin_z + row * spacing
            obj.location = (x, 0.0, z)

            # Each tile gets its own phase offset so the row breathes rather
            # than pumping in unison, and each offset is a fixed fraction of
            # the loop rather than a random number, so the scene rebuilds the
            # same way every time.
            offset = index / max(1, columns * rows)
            bake(
                obj,
                "location",
                lambda frame, z=z, offset=offset: z + clock.sine(frame, cycles=1, offset=offset) * 0.045,
                clock.frames,
                index=2,
            )
            bake(
                obj,
                "rotation_euler",
                lambda frame, offset=offset: math.radians(7.0)
                * clock.sine(frame, cycles=1, offset=offset),
                clock.frames,
                index=1,
            )
            index += 1

    distance = columns * 1.35 + 1.2
    add_camera(bpy.context.scene, distance=distance)
    add_key_light(bpy.context.scene)
    add_caustic_backdrop(
        bpy.context.scene, clock, distance=distance * 1.6, size=distance * 6.0
    )


def main() -> None:
    args = parse_args(sys.argv)
    container = spec_mod.load(args.spec)
    clock = LoopClock(frames=args.frames, fps=args.fps)

    scene = reset_scene()
    if args.scene == "deepfield":
        # Portrait targets get the phone camera, landscape ones the desktop
        # camera, unless told otherwise — rendering a portrait composition into
        # a 16:9 frame is the mistake this inference exists to prevent.
        target = render.TARGETS[args.target]
        framing = args.framing or ("phone" if target.height >= target.width else "desktop")
        deepfield.build(
            container,
            clock,
            icons=tile_mod.find_icons(args.icons) if args.icons else [],
            framing=framing,
            bubbles=args.bubbles,
            rays=args.rays,
            far_tiles=args.far_tiles,
            seed=args.seed,
        )
        print(f"built deepfield, framing={framing}")
    else:
        build_studio(args, container, clock)

    render.apply_loop(scene, clock.frames, clock.fps)
    render.apply_target(scene, args.target, args.percent)
    render.colour_management(scene, look=args.look, transform=args.view, exposure=args.exposure)
    if args.engine == "cycles":
        render.use_cycles(scene, samples=args.samples)
    else:
        render.use_eevee(scene, samples=args.samples)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.video:
        render.output_video(scene, str(out))
    else:
        render.output_frames(scene, str(out))

    if args.save_blend:
        blend = Path(args.save_blend)
        blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
        print(f"saved {blend}")

    if args.still or args.animation:
        scene.frame_set(1)
        bpy.ops.render.render(animation=args.animation, write_still=args.still)
        print(f"rendered {out}")


if __name__ == "__main__":
    main()
