"""
The bridge from the web app's exports into the 3D scene.

The app keeps rendered icons as PNG blobs in IndexedDB and hands them over as
a download; the 3D side just needs a folder of PNGs. That deliberately loose
coupling means neither half has to know about the other, and the scene can be
lit and framed long before any final artwork exists.

Two rules govern how icons are chosen and ordered, and both exist to stop the
scene changing under you:

  * **Sorted, never directory order.** Filesystem order varies by machine, so
    an unsorted scan would deal a different icon into the hero position on
    someone else's checkout — and the hero position is the one you spent an
    hour lighting.
  * **Seeded shuffling only.** Where a scene wants scattered rather than
    grid-ordered icons, it passes a seed. Same seed, same arrangement, on
    every machine and every rebuild.
"""

from __future__ import annotations

import random
from pathlib import Path

import bpy

from . import geometry, materials

SUPPORTED = {".png", ".PNG"}

# Icons whose silhouettes read well large, ordered for the hero slots. The
# scenes put the first entries closest to camera, so this is effectively the
# casting decision: shapes that survive being seen at 40% of frame height,
# with an obvious meaning at a glance.
HERO_ORDER = [
    "folder",
    "photo_camera",
    "mail",
    "music_note",
    "calendar_month",
    "map",
    "sunny",
    "alarm",
    "home",
    "search",
    "settings",
    "notifications",
]


def discover(directory: Path) -> list[Path]:
    """Every PNG in `directory`, hero icons first, then everything else A-Z."""
    if not directory.exists():
        return []

    found = sorted(p for p in directory.iterdir() if p.suffix in SUPPORTED)
    ranked = {name: i for i, name in enumerate(HERO_ORDER)}

    def key(path: Path):
        stem = path.stem.lower().replace("-", "_").replace(" ", "_")
        return (ranked.get(stem, len(HERO_ORDER)), stem)

    return sorted(found, key=key)


def load_image(path: Path) -> bpy.types.Image:
    """Load a PNG as sRGB colour data with alpha kept straight.

    Straight rather than premultiplied matters for these specific icons: the
    open-frame exports have genuinely semi-transparent glass in the middle of
    the tile, and premultiplied alpha would darken those pixels toward black
    as they fade instead of letting the background show through.
    """
    existing = bpy.data.images.get(path.name)
    if existing is not None:
        return existing

    image = bpy.data.images.load(str(path))
    image.name = path.name
    image.colorspace_settings.name = "sRGB"
    image.alpha_mode = "STRAIGHT"
    return image


def build_tiles(
    directory: Path,
    count: int,
    size: float = 1.0,
    thickness: float = 0.12,
    dome: float = 0.16,
    exponent: float = geometry.DEFAULT_EXPONENT,
    shuffle_seed: int | None = None,
) -> list[bpy.types.Object]:
    """Create `count` icon tiles, textured from `directory` where possible.

    Falls back to procedurally tinted aqua tiles when there is no artwork yet,
    cycling hues so a placeholder scene still shows depth and separation
    rather than a wall of identical blue. A scene built on placeholders is
    laid out identically to one built on real icons, so framing work done
    before the icons exist is not wasted.
    """
    paths = discover(directory)
    if shuffle_seed is not None and paths:
        rng = random.Random(shuffle_seed)
        rng.shuffle(paths)

    tiles: list[bpy.types.Object] = []
    for i in range(count):
        if paths:
            path = paths[i % len(paths)]
            name = f"Icon_{i:03d}_{path.stem}"
            material = materials.icon_gel(f"MAT_{path.stem}", load_image(path))
        else:
            name = f"Icon_{i:03d}_placeholder"
            material = materials.icon_gel(
                f"MAT_placeholder_{i:03d}", None, tint=_placeholder_tint(i)
            )

        tile = geometry.create_icon_tile(
            name,
            size=size,
            thickness=thickness,
            dome=dome,
            exponent=exponent,
        )
        tile.data.materials.append(material)
        tiles.append(tile)

    return tiles


def _placeholder_tint(index: int):
    """Cycle through the aqua range so placeholders read as distinct objects."""
    import colorsys

    hue = 0.5 + 0.06 * ((index % 5) - 2)
    r, g, b = colorsys.hsv_to_rgb(hue % 1.0, 0.72, 0.95)
    return (r, g, b, 1.0)


def report(directory: Path) -> str:
    """One line for the build log: what artwork the scene actually found."""
    paths = discover(directory)
    if not paths:
        return (
            f"no PNGs in {directory} — building with placeholder tiles. "
            "Export a family from the web app and drop the PNGs there."
        )
    preview = ", ".join(p.stem for p in paths[:6])
    suffix = ", ..." if len(paths) > 6 else ""
    return f"{len(paths)} icons from {directory}: {preview}{suffix}"
