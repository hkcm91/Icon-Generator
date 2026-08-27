#!/usr/bin/env python3
"""
Measure a render against the composition rule.

The whole scene is built on one assertion — bright at the top, dark and quiet
through the band where the icon grid sits — and an assertion you only ever
check by looking at it is one you will eventually talk yourself out of. This
measures it.

    python3 tools/probe.py out/look13.png

It reports a vertical luminance and saturation profile, then checks three
things that the design actually depends on:

  1. The top band, behind the clock, is genuinely the brightest part.
  2. The icon band is dark enough that bright aqua tiles will separate from it.
  3. Saturation does not collapse. This one catches the failure that is
     hardest to see by eye and easiest to introduce: adding light to a scene
     lifts every channel, and against a blue ground the red channel rises
     proportionally fastest, so "brighter" quietly becomes "greyer". A pass
     here is what keeps the water a colour rather than a tone.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

# Where a launcher actually puts things, as fractions of frame height.
CLOCK_BAND = (0.00, 0.14)
ICON_BAND = (0.16, 0.80)
DOCK_BAND = (0.82, 1.00)

# Rec. 709 luma weights.
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# A bright aqua tile sits around 0.7 luma. Below this the grid separates from
# the ground comfortably at a glance; above it the two start to merge.
ICON_BAND_CEILING = 0.34
MIN_SATURATION = 0.45


def load(path: str) -> np.ndarray:
    import bpy

    image = bpy.data.images.load(str(Path(path).resolve()))
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    return pixels[::-1, :, :3]


def band(pixels: np.ndarray, span: tuple[float, float], axis: str = "vertical") -> tuple[float, float]:
    """
    Mean luma and mean saturation over a band.

    Vertical bands are rows, for the portrait framing where the icon grid is a
    horizontal stripe. Horizontal bands are columns, for the desktop framing
    where the icons run down the left edge instead and the quiet zone has to
    move with them — the same rule, rotated ninety degrees.
    """
    if axis == "horizontal":
        width = pixels.shape[1]
        cut = pixels[:, int(span[0] * width) : max(int(span[1] * width), int(span[0] * width) + 1)]
    else:
        height = pixels.shape[0]
        cut = pixels[int(span[0] * height) : max(int(span[1] * height), int(span[0] * height) + 1)]
    flat = cut.reshape(-1, 3)
    luma = float((flat * LUMA).sum(axis=1).mean())
    peak = flat.max(axis=1)
    trough = flat.min(axis=1)
    saturation = float(np.divide(peak - trough, np.maximum(peak, 1e-6)).mean())
    return luma, saturation


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("render")
    parser.add_argument("--bands", type=int, default=12)
    parser.add_argument("--axis", default="vertical", choices=["vertical", "horizontal"])
    args = parser.parse_args()

    pixels = load(args.render)
    height = pixels.shape[0]

    print(f"{args.render}  {pixels.shape[1]}x{height}  ({args.axis})")
    print()
    print("  across  luma   sat" if args.axis == "horizontal" else "  depth   luma   sat")
    for i in range(args.bands):
        span = (i / args.bands, (i + 1) / args.bands)
        luma, saturation = band(pixels, span, args.axis)
        bar = "#" * int(luma * 40)
        print(f"  {span[0]:4.0%}   {luma:.3f}  {saturation:.2f}  {bar}")
    print()

    if args.axis == "horizontal":
        # Desktop: icons occupy the left edge, so that column is the one that
        # has to stay dark, and the light is expected to gather on the right.
        icon_luma, icon_sat = band(pixels, (0.0, 0.18), "horizontal")
        clock_luma, clock_sat = band(pixels, (0.55, 1.0), "horizontal")
        dock_luma, dock_sat = band(pixels, (0.18, 0.4), "horizontal")
    else:
        clock_luma, clock_sat = band(pixels, CLOCK_BAND)
        icon_luma, icon_sat = band(pixels, ICON_BAND)
        dock_luma, dock_sat = band(pixels, DOCK_BAND)

    bright, quiet, rest = ("light side", "icon column", "mid") if args.axis == "horizontal" else ("clock band", "icon band ", "dock band")
    print(f"  {bright:11s} luma {clock_luma:.3f}  sat {clock_sat:.2f}")
    print(f"  {quiet:11s} luma {icon_luma:.3f}  sat {icon_sat:.2f}")
    print(f"  {rest:11s} luma {dock_luma:.3f}  sat {dock_sat:.2f}")
    print()

    failures = []

    if clock_luma > icon_luma:
        print(f"  ok   light gathers away from the icons ({clock_luma:.3f} over {icon_luma:.3f})")
    else:
        failures.append("the light is not gathering away from where the icons sit")

    if icon_luma <= ICON_BAND_CEILING:
        print(f"  ok   icon band at {icon_luma:.3f}, under the {ICON_BAND_CEILING} ceiling")
    else:
        failures.append(
            f"icon band luma {icon_luma:.3f} exceeds {ICON_BAND_CEILING} — "
            "bright tiles will start to merge into it"
        )

    if args.axis == "vertical":
        if dock_luma <= icon_luma:
            print(f"  ok   frame keeps falling toward the dock ({dock_luma:.3f})")
        else:
            failures.append(f"dock band ({dock_luma:.3f}) is brighter than the icon band")

    if icon_sat >= MIN_SATURATION:
        print(f"  ok   icon band holds its colour (sat {icon_sat:.2f})")
    else:
        failures.append(
            f"icon band saturation {icon_sat:.2f} is under {MIN_SATURATION} — "
            "the water is going grey, check for light with too much red in it"
        )

    print()
    if failures:
        for failure in failures:
            print(f"  FAIL {failure}")
        raise SystemExit(1)
    print("  composition holds")


if __name__ == "__main__":
    main()
