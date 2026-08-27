#!/usr/bin/env python3
"""
Measure the loop seam on rendered pixels.

`tests/test_loop.py` proves the phase maths returns to its starting value.
That is necessary and it is not sufficient: it says nothing about whether some
keyframe got baked with the wrong interpolation, whether a material forgot to
close, or whether the frame range was set one frame too long — all of which
produce a hitch that the maths is entirely happy about.

This measures the thing itself. Given a rendered sequence, it compares the
change across the wrap (last frame -> first frame) with the typical change
between neighbouring frames. A seamless loop is one where the wrap is an
ordinary step: nothing about it stands out.

    python3 tools/loop_check.py out/loopseq

Two failure signatures, and they mean opposite things:

  wrap much LARGER than a normal step
      the animation does not return — something is travelling in one
      direction and never coming back, or a cycle count is not a whole number

  wrap much SMALLER than a normal step (near zero)
      the last frame is a duplicate of the first. The loop will play both and
      stutter once per cycle. Usually the frame range ends at `frames + 1`.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

# A wrap this many times an ordinary step is a seam worth failing over. Motion
# is not perfectly uniform frame to frame, so some latitude is needed; beyond
# this the wrap is not "a slightly bigger step", it is a jump.
SEAM_TOLERANCE = 2.5
DUPLICATE_FLOOR = 0.25


def load(path: Path) -> np.ndarray:
    import bpy

    image = bpy.data.images.load(str(path.resolve()))
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    bpy.data.images.remove(image)
    return pixels[..., :3]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", help="a rendered PNG sequence")
    args = parser.parse_args()

    frames = sorted(Path(args.directory).glob("*.png"))
    if len(frames) < 4:
        raise SystemExit(f"need at least 4 frames, found {len(frames)}")

    images = [load(path) for path in frames]
    steps = [float(np.abs(images[i + 1] - images[i]).mean()) for i in range(len(images) - 1)]
    wrap = float(np.abs(images[0] - images[-1]).mean())

    typical = float(np.median(steps))
    ratio = wrap / typical if typical > 0 else float("inf")

    print(f"{len(frames)} frames from {args.directory}")
    print(f"  median step between neighbours   {typical:.6f}")
    print(f"  largest step between neighbours  {max(steps):.6f}")
    print(f"  step across the wrap             {wrap:.6f}")
    print(f"  wrap / median                    {ratio:.2f}x")
    print()

    if ratio > SEAM_TOLERANCE:
        print(f"  FAIL the wrap is {ratio:.1f}x an ordinary step — the loop does not close")
        raise SystemExit(1)
    if ratio < DUPLICATE_FLOOR:
        print(f"  FAIL the wrap is only {ratio:.2f}x a step — the last frame duplicates the first")
        raise SystemExit(1)
    print(f"  ok   the wrap is an ordinary step ({ratio:.2f}x) — no seam")


if __name__ == "__main__":
    main()
