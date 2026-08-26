#!/usr/bin/env python3
"""
Build a .blend from scratch.

The .blend is an *output*, never a source file. Git cannot merge a binary
scene, so two people touching the same wallpaper on different branches would
have no way to reconcile it — one of them just loses. Keeping the scene as
Python means the diff is readable, the merge is a normal merge, and a build is
reproducible from any commit.

Which also means: do not hand-edit a generated .blend and expect it to
survive. Open it, look, tweak numbers, then move the numbers you liked back
into the scene module.

Usage:
    python build.py --scene aquarium
    python build.py --scene aquarium --frames 450 --fps 30 --preview

Runs under either the `bpy` PyPI wheel (`pip install -r requirements.txt`) or
a real Blender (`blender --background --python build.py -- --scene aquarium`).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402

from fa import loop as fa_loop  # noqa: E402
from fa import icons, render  # noqa: E402
from fa.scenes import aquarium  # noqa: E402

SCENES = {
    "aquarium": aquarium.build,
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    # Blender passes script arguments after a bare `--` (everything before it
    # belongs to Blender itself); plain Python just has the script name at
    # argv[0]. Normalising both here is what lets one file run either way.
    argv = argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", default="aquarium", choices=sorted(SCENES))
    parser.add_argument("--frames", type=int, default=300, help="Loop length in frames.")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--icons", type=Path, default=HERE / "icons")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--tiles", type=int, default=9, help="How many icon tiles.")
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument(
        "--resolution",
        default="2560x1440",
        help="Render resolution, WxH. Use 1080x2400 for a phone wallpaper.",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Also render one still to out/, as a build sanity check.",
    )
    parser.add_argument(
        "--preview-frame", type=int, default=1, help="Which frame --preview renders."
    )
    parser.add_argument("--preview-samples", type=int, default=48)
    parser.add_argument(
        "--preview-scale",
        type=float,
        default=0.25,
        help="Fraction of full resolution for the preview still.",
    )
    return parser.parse_args(argv)


def reset_scene() -> None:
    """Empty the default startup file.

    `bpy.ops.wm.read_factory_settings` is deliberately avoided: under the PyPI
    wheel there is no window manager for it to reset, and it raises. Deleting
    datablocks directly works identically in both environments.
    """
    for collection in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.images,
        bpy.data.actions,
        bpy.data.worlds,
    ):
        for item in list(collection):
            collection.remove(item)


def main() -> int:
    args = parse_args(sys.argv)

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    out = args.out or HERE / "scenes" / f"{args.scene}.blend"
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"[fa] building '{args.scene}' at {width}x{height}")
    print(f"[fa] {icons.report(args.icons)}")

    reset_scene()
    spec = fa_loop.Loop(frames=args.frames, fps=args.fps)
    render.configure(bpy.context.scene, width=width, height=height)

    SCENES[args.scene](
        icon_dir=args.icons,
        spec=spec,
        tile_count=args.tiles,
        seed=args.seed,
    )

    problems = fa_loop.verify_loop(bpy.context.scene, spec)
    if problems:
        print(f"[fa] LOOP NOT SEAMLESS — {len(problems)} discontinuity(ies):")
        for problem in problems[:20]:
            print(f"[fa]   {problem}")
        return 1
    print(f"[fa] loop verified seamless over {spec.frames} frames ({spec.seconds:.1f}s)")

    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    print(f"[fa] wrote {out}")

    if args.preview:
        still = HERE / "out" / f"{args.scene}_preview.png"
        render.still(
            bpy.context.scene,
            still,
            frame=args.preview_frame,
            samples=args.preview_samples,
            scale=args.preview_scale,
        )
        print(f"[fa] wrote {still}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
