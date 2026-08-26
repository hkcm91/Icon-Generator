"""
ContainerSpec, in Python.

A mirror of `src/core/spec.ts`. Same fields, same clamps, same defaults, so a
project JSON saved by the app can be handed to Blender without a translation
layer in between.

The 2D pipeline and the 3D scene must agree about the silhouette or the
wallpaper stops looking like it belongs to the icons. The only way to keep that
true is to have exactly one description of the shape and read it from both
sides. That description is this file's input, not this file.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# Named superellipse exponents, from spec.ts.
SUPERELLIPSE_PRESETS = {
    "ellipse": 2.0,
    "squircle": 4.0,
    "ios-icon": 5.0,
    "soft-square": 8.0,
}

SHAPE_KINDS = ("circle", "rounded-rect", "superellipse", "custom-path")


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


@dataclass(frozen=True)
class ContainerSpec:
    """The declarative source of truth for icon geometry."""

    version: int = 1
    size: int = 1024
    shape: str = "superellipse"
    radius: float = 24.0
    exponent: float = SUPERELLIPSE_PRESETS["ios-icon"]
    custom_path: str = ""
    padding: float = 6.0
    glyph_inset: float = 18.0
    segments: int = 64

    @property
    def inner_box(self) -> tuple[float, float, float, float]:
        """The drawable box after optical padding: (x, y, edge, centre)."""
        pad = (self.size * self.padding) / 100.0
        edge = self.size - pad * 2.0
        return pad, pad, edge, self.size / 2.0


DEFAULT_SPEC = ContainerSpec()


def normalise(raw: dict) -> ContainerSpec:
    """
    Coerce arbitrary JSON into a valid spec.

    Every field is clamped rather than rejected, matching `normaliseSpec` in
    spec.ts: a hand-edited file should never hard-fail the builder, and two
    structurally different inputs that mean the same thing must land on the
    same spec.
    """
    shape = raw.get("shape", DEFAULT_SPEC.shape)
    if shape not in SHAPE_KINDS:
        shape = DEFAULT_SPEC.shape

    return ContainerSpec(
        version=1,
        size=int(_clamp(float(raw.get("size", DEFAULT_SPEC.size)), 16, 4096)),
        shape=shape,
        radius=_clamp(float(raw.get("radius", DEFAULT_SPEC.radius)), 0, 50),
        exponent=_clamp(float(raw.get("exponent", DEFAULT_SPEC.exponent)), 2, 16),
        custom_path=str(raw.get("customPath", raw.get("custom_path", ""))),
        padding=_clamp(float(raw.get("padding", DEFAULT_SPEC.padding)), 0, 25),
        glyph_inset=_clamp(
            float(raw.get("glyphInset", raw.get("glyph_inset", DEFAULT_SPEC.glyph_inset))), 0, 40
        ),
        segments=int(_clamp(float(raw.get("segments", DEFAULT_SPEC.segments)), 8, 512)),
    )


def load(path: str | Path) -> ContainerSpec:
    """
    Read a spec from disk.

    Accepts either a bare spec object or a whole project file with the spec
    nested under `spec`, which is what the app writes out.
    """
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict) and isinstance(data.get("spec"), dict):
        data = data["spec"]
    return normalise(data)
