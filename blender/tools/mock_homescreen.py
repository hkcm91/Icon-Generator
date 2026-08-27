#!/usr/bin/env python3
"""
Put a home screen on top of a render.

The whole composition rests on one claim — that the icon grid stays legible
against this wallpaper, and that the tiles drifting in the far field never
resolve into something the eye confuses with a real icon. Judging that from
the wallpaper alone is guesswork, because the thing being judged is a
relationship between two images and only one of them is on screen.

So this draws the other one. It composites a grid of icon-shaped tiles over a
render, at real launcher proportions, using `container_ring` — the same
geometry the rasteriser and the 3D tiles come from. The silhouettes are
therefore exactly the silhouettes that will actually sit there, not an
approximation of them.

    python3 tools/mock_homescreen.py out/look08.png out/mock.png

It is a legibility check, not a mockup: the tiles are painted as flat aqua
glass rather than rendered, because what is being tested is contrast and
figure-ground separation, and those survive the simplification.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aero.geometry import container_ring  # noqa: E402
from aero.spec import ContainerSpec, load  # noqa: E402

# Launcher proportions, as fractions of the short and long screen edges.
COLUMNS = 4
ROWS = 5
GRID_TOP = 0.16
GRID_BOTTOM = 0.80
SIDE_MARGIN = 0.06
ICON_FRACTION = 0.68  # of the cell's short edge


def polygon_mask(ring, width: int, height: int, cx: float, cy: float, size: float) -> np.ndarray:
    """
    Rasterise a closed ring into a boolean mask by crossing-number test.

    Vectorised over the whole bounding box at once: for each edge, find the
    rows it spans, work out where it crosses each of those rows, and flip the
    parity of every pixel to the right of that crossing. Odd parity is inside.
    """
    points = np.array(ring, dtype=np.float64)
    # Ring coordinates are centred on zero and one unit across; place them.
    xs = cx + points[:, 0] * size
    ys = cy - points[:, 1] * size

    x0, x1 = int(max(0, xs.min() - 2)), int(min(width, xs.max() + 2))
    y0, y1 = int(max(0, ys.min() - 2)), int(min(height, ys.max() + 2))
    if x1 <= x0 or y1 <= y0:
        return np.zeros((height, width), dtype=bool)

    box_w, box_h = x1 - x0, y1 - y0
    parity = np.zeros((box_h, box_w), dtype=bool)

    grid_x = np.arange(x0, x1) + 0.5
    row_y = np.arange(y0, y1) + 0.5

    ax, ay = xs, ys
    bx, by = np.roll(xs, -1), np.roll(ys, -1)

    for i in range(len(xs)):
        y_lo, y_hi = min(ay[i], by[i]), max(ay[i], by[i])
        if y_hi == y_lo:
            continue
        spans = (row_y >= y_lo) & (row_y < y_hi)
        if not spans.any():
            continue
        t = (row_y[spans] - ay[i]) / (by[i] - ay[i])
        crossing = ax[i] + t * (bx[i] - ax[i])
        parity[spans] ^= grid_x[None, :] < crossing[:, None]

    mask = np.zeros((height, width), dtype=bool)
    mask[y0:y1, x0:x1] = parity
    return mask


def feather(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    """A cheap box blur of the mask, to give the tile edge one soft pixel."""
    soft = mask.astype(np.float32)
    for _ in range(radius):
        padded = np.pad(soft, 1, mode="edge")
        soft = (
            padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:] + soft * 4
        ) / 8.0
    return soft


def composite(render: np.ndarray, spec: ContainerSpec) -> np.ndarray:
    """Paint the grid over the render and return the result."""
    height, width = render.shape[:2]
    out = render.copy()

    ring = [
        ((x - spec.size / 2) / spec.size, (spec.size / 2 - y) / spec.size)
        for x, y in container_ring(spec)
    ]

    usable = width * (1 - 2 * SIDE_MARGIN)
    cell_w = usable / COLUMNS
    cell_h = height * (GRID_BOTTOM - GRID_TOP) / ROWS
    size = min(cell_w, cell_h) * ICON_FRACTION

    # Two aqua tones and a white glyph block, which is all the legibility test
    # needs: a filled body, a bright rim, and a bright mark in the middle.
    body = np.array([0.29, 0.72, 0.90], dtype=np.float32)
    rim = np.array([0.82, 0.97, 1.0], dtype=np.float32)
    glyph = np.array([1.0, 1.0, 1.0], dtype=np.float32)

    for row in range(ROWS):
        for column in range(COLUMNS):
            cx = width * SIDE_MARGIN + cell_w * (column + 0.5)
            cy = height * GRID_TOP + cell_h * (row + 0.5)

            outer = feather(polygon_mask(ring, width, height, cx, cy, size))
            inner = feather(polygon_mask(ring, width, height, cx, cy, size * 0.88))
            mark = feather(polygon_mask(ring, width, height, cx, cy, size * 0.34))

            edge = np.clip(outer - inner, 0.0, 1.0)
            out[..., :3] = out[..., :3] * (1 - inner[..., None] * 0.88) + body * inner[..., None] * 0.88
            out[..., :3] = out[..., :3] * (1 - edge[..., None]) + rim * edge[..., None]
            out[..., :3] = out[..., :3] * (1 - mark[..., None] * 0.9) + glyph * mark[..., None] * 0.9

    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("render")
    parser.add_argument("output")
    parser.add_argument("--spec", default=str(Path(__file__).resolve().parents[1] / "specs" / "aqua-default.json"))
    args = parser.parse_args()

    # bpy is used only to read and write the PNG — no scene is involved.
    import bpy

    image = bpy.data.images.load(str(Path(args.render).resolve()))
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    # Blender's buffer starts at the bottom row.
    pixels = pixels[::-1]

    result = composite(pixels, load(args.spec))

    out = bpy.data.images.new("mock", width=width, height=height, alpha=True)
    out.pixels = result[::-1].ravel().tolist()
    out.filepath_raw = str(Path(args.output).resolve())
    out.file_format = "PNG"
    out.save()
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
