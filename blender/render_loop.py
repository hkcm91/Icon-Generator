#!/usr/bin/env python3
"""
Render the loop as a PNG sequence, then encode it to a wallpaper-ready MP4.

Deliberately two steps rather than one. A video render that dies at frame 240
leaves an unusable file and four hours of nothing; a frame sequence leaves 240
finished PNGs and resumes where it stopped. The encode afterwards costs
seconds and can be repeated at different qualities without re-rendering.

    python render_loop.py                       # render, then encode
    python render_loop.py --resume              # skip frames already on disk
    python render_loop.py --encode-only         # re-encode existing frames
    python render_loop.py --start 1 --end 100   # split across machines

Rendering a 300-frame loop at 2560x1440 is an overnight job on a GPU and is
not viable on a CPU. `python build.py --preview` is the iteration loop; this
is what gets run once the look is settled.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402

from fa import render  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    argv = argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", type=Path, default=HERE / "scenes" / "aquarium.blend")
    parser.add_argument("--frames-dir", type=Path, default=HERE / "out" / "frames")
    parser.add_argument("--output", type=Path, default=HERE / "out" / "aquarium-loop.mp4")
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--start", type=int, default=None)
    parser.add_argument("--end", type=int, default=None)
    parser.add_argument("--crf", type=int, default=16, help="Lower is better quality.")
    parser.add_argument("--cpu", action="store_true", help="Force CPU rendering.")
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip frames whose PNG is already on disk.",
    )
    parser.add_argument(
        "--encode-only",
        action="store_true",
        help="Encode the frames already in --frames-dir and stop.",
    )
    return parser.parse_args(argv)


def frame_path(directory: Path, frame: int) -> Path:
    return directory / f"frame_{frame:04d}.png"


def render_frames(scene, directory: Path, start: int, end: int, resume: bool) -> int:
    directory.mkdir(parents=True, exist_ok=True)
    rendered = 0

    for frame in range(start, end + 1):
        target = frame_path(directory, frame)
        if resume and target.exists() and target.stat().st_size > 0:
            print(f"[fa] frame {frame:4d}/{end}  skipped (already rendered)")
            continue

        scene.frame_set(frame)
        # Written per frame with an explicit path rather than letting Blender
        # append its own numbering, so a resumed or split render cannot end up
        # with two different numbering schemes in one directory.
        scene.render.filepath = str(target.with_suffix(""))
        bpy.ops.render.render(write_still=True)
        rendered += 1
        print(f"[fa] frame {frame:4d}/{end}  written")

    return rendered


def check_sequence(directory: Path, start: int, end: int) -> list[int]:
    """Frames missing from the sequence.

    Worth checking before encoding: ffmpeg's globbing quietly skips gaps, so a
    sequence missing frames 130-140 encodes without complaint and produces a
    loop with a jump cut in it.
    """
    return [f for f in range(start, end + 1) if not frame_path(directory, f).exists()]


def verify_rendered_loop(directory: Path, start: int, end: int, tolerance: float = 1.6) -> bool:
    """Measure the loop seam on the rendered pixels themselves.

    `build.py` already proves the f-curves are periodic, but that only covers
    what was baked. It cannot see a shader whose animation was wired up wrong,
    a volume that has not converged, or a camera effect evaluated per frame.
    Those all show as a jump in the *output* while every curve reads clean.

    So this compares the wrap — last frame against first — with the largest
    step taken between consecutive frames inside the loop. A seamless loop's
    wrap is in family with its interior motion. A broken one stands out
    immediately, because a wallpaper's whole hitch is that one transition
    differing from every other.

    Cheap enough to run on every sequence: it is one pass over the PNGs, next
    to nothing beside the hours spent rendering them.
    """
    try:
        import numpy as np
    except ImportError:
        print("[fa] numpy unavailable — skipping the rendered-loop check")
        return True

    frames: list = []
    for frame in range(start, end + 1):
        image = bpy.data.images.load(str(frame_path(directory, frame)))
        buffer = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(buffer)
        frames.append(buffer.reshape(-1, 4)[:, :3])
        bpy.data.images.remove(image)

    if len(frames) < 3:
        return True

    def delta(a, b) -> float:
        return float(np.abs(a - b).mean())

    interior = [delta(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
    wrap = delta(frames[-1], frames[0])
    worst = max(interior)
    ratio = wrap / worst if worst > 0 else 0.0

    print(
        f"[fa] loop seam: wrap delta {wrap:.6f}, "
        f"interior peak {worst:.6f} ({ratio:.2f}x)"
    )
    if ratio > tolerance:
        print("[fa] the rendered loop has a visible seam — it will hitch once per cycle")
        return False

    print("[fa] rendered loop verified seamless")
    return True


def encode(directory: Path, output: Path, fps: int, frames: int, crf: int) -> int:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = render.ffmpeg_command(directory, output, fps=fps, frames=frames, crf=crf)
    print(f"[fa] {command}")

    result = subprocess.run(command, shell=True, check=False)

    # 127 is the shell's "command not found". Worth naming, because the frames
    # are all rendered at this point and the only thing missing is a five
    # second encode — the command printed above can be run by hand on any
    # machine with ffmpeg, without re-rendering anything.
    if result.returncode == 127:
        print("[fa] ffmpeg is not installed. The frames are fine — install")
        print("[fa] ffmpeg and re-run with --encode-only, or run the command above.")
        return 127

    if result.returncode != 0:
        print(f"[fa] ffmpeg exited {result.returncode}")
        return result.returncode

    print(f"[fa] wrote {output}")
    return 0


def main() -> int:
    args = parse_args(sys.argv)

    if not args.blend.exists():
        print(f"[fa] no scene at {args.blend} — run build.py first")
        return 1

    bpy.ops.wm.open_mainfile(filepath=str(args.blend))
    scene = bpy.context.scene

    loop_start = args.start or scene.frame_start
    loop_end = args.end or scene.frame_end
    total = scene.frame_end - scene.frame_start + 1

    if not args.encode_only:
        scene.cycles.samples = args.samples
        scene.render.resolution_percentage = 100
        render.configure_sequence(scene, args.frames_dir)

        backend = "CPU" if args.cpu else render.enable_gpu()
        print(f"[fa] rendering on {backend}")
        if backend == "CPU":
            print("[fa] no GPU backend available — expect this to take a very long time")

        print(
            f"[fa] frames {loop_start}-{loop_end} at "
            f"{scene.render.resolution_x}x{scene.render.resolution_y}, "
            f"{args.samples} samples"
        )
        render_frames(scene, args.frames_dir, loop_start, loop_end, args.resume)

    missing = check_sequence(args.frames_dir, scene.frame_start, scene.frame_end)
    if missing:
        # A partial render is a legitimate state — split across machines, or
        # stopped early — so this reports and stops rather than encoding a
        # sequence with holes in it.
        preview = ", ".join(str(f) for f in missing[:10])
        suffix = ", ..." if len(missing) > 10 else ""
        print(f"[fa] {len(missing)} frame(s) missing: {preview}{suffix}")
        print("[fa] not encoding an incomplete loop. Re-run with --resume.")
        return 1

    if not verify_rendered_loop(args.frames_dir, scene.frame_start, scene.frame_end):
        # Encode anyway. The frames are hours of work and are still useful for
        # diagnosing the seam; refusing to produce the file would just mean
        # running ffmpeg by hand to look at it.
        print("[fa] encoding anyway so the result can be inspected")

    return encode(args.frames_dir, args.output, scene.render.fps, total, args.crf)


if __name__ == "__main__":
    raise SystemExit(main())
