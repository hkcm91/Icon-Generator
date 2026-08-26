"""
The icon tile, built from the same superellipse the web app compiles.

`src/core/geometry.ts` treats the container silhouette as compiled data rather
than something a model draws, which is the whole premise of the app. A 3D
scene that puts those icons on a generic rounded square would break that
premise at the last step: the PNG's painted edge and the mesh's actual edge
would disagree, and the mismatch shows as a sliver of wrong-coloured rim all
the way round every tile.

So this module ports `superellipsePoint` exactly, defaults included, and the
mesh outline is the same curve the rasteriser used. The silhouette survives
the trip into 3D.

Ported from spec.ts / geometry.ts:

    |x/a|^n + |y/b|^n = 1,  parametrically with e = 2/n:
        x = a * sign(cos t) * |cos t|^e
        y = b * sign(sin t) * |sin t|^e

Defaults mirror DEFAULT_SPEC: exponent 5 ("ios-icon"), padding 6%.
"""

from __future__ import annotations

import math
from typing import Sequence

import bpy

# Mirrors SUPERELLIPSE_PRESETS in src/core/spec.ts.
SUPERELLIPSE_PRESETS = {
    "ellipse": 2.0,
    "squircle": 4.0,
    "ios-icon": 5.0,
    "soft-square": 8.0,
}

DEFAULT_EXPONENT = SUPERELLIPSE_PRESETS["ios-icon"]


def superellipse_point(t: float, a: float, b: float, n: float) -> tuple[float, float]:
    """One point on the curve. Direct port of `superellipsePoint`."""
    e = 2.0 / n
    ct = math.cos(t)
    st = math.sin(t)
    return (
        a * math.copysign(abs(ct) ** e, ct),
        b * math.copysign(abs(st) ** e, st),
    )


def superellipse_ring(segments: int, radius: float = 1.0, exponent: float = DEFAULT_EXPONENT):
    """The closed outline as `segments` points, evenly spaced in arc length.

    geometry.ts makes the same correction and explains why: for n > 2 the
    parametric speed of a superellipse is wildly non-uniform, so stepping t
    evenly crowds points into the corners and starves the flat edges. In 2D
    that shows up as a lumpy curve; in 3D it also wrecks the shading, because
    a dense corner and a sparse edge normal-interpolate differently and the
    highlight — the single most important thing on a glossy icon — crawls.

    Sampling densely in t and then resampling by cumulative arc length costs
    nothing at build time and gives evenly-lit rims.
    """
    dense = max(segments * 8, 512)
    samples = [superellipse_point(i / dense * math.tau, radius, radius, exponent) for i in range(dense + 1)]

    lengths = [0.0]
    for (x0, y0), (x1, y1) in zip(samples, samples[1:]):
        lengths.append(lengths[-1] + math.hypot(x1 - x0, y1 - y0))
    total = lengths[-1]

    ring = []
    cursor = 0
    for i in range(segments):
        target = total * i / segments
        while cursor < len(lengths) - 2 and lengths[cursor + 1] < target:
            cursor += 1
        span = lengths[cursor + 1] - lengths[cursor]
        f = 0.0 if span <= 0 else (target - lengths[cursor]) / span
        x0, y0 = samples[cursor]
        x1, y1 = samples[cursor + 1]
        ring.append((x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))
    return ring


def _dome_height(s: float, height: float, power: float = 0.55) -> float:
    """Front-face profile: a pillow, not a hemisphere.

    A true hemisphere puts a hard silhouette break at the rim and squashes the
    icon art into the middle third under perspective. Raising (1 - s^2) to a
    power below 1 flattens the centre and eases into the rim, which is the
    profile the aqua-era icons themselves were drawn to imitate — most of the
    face readable and flat, curvature saved for the last 20% where it catches
    the highlight.
    """
    return height * (max(0.0, 1.0 - s * s) ** power)


def create_icon_tile(
    name: str,
    size: float = 1.0,
    thickness: float = 0.12,
    dome: float = 0.16,
    rings: int = 12,
    segments: int = 96,
    exponent: float = DEFAULT_EXPONENT,
) -> bpy.types.Object:
    """A closed, UV-mapped, domed superellipse tile.

    Built as explicit vertices rather than a primitive plus modifiers because
    the UVs have to come from the *flat* XY position, not from the domed
    surface. Unwrapping the dome would pinch the icon art toward the rim;
    projecting flat keeps the artwork's proportions exactly as painted, with
    the dome only bending the light across it.

    Topology: a fan at the centre, `rings` concentric quad rings out to the
    silhouette, a rim wall dropped by `thickness`, and a flat back.
    """
    outline = superellipse_ring(segments, 1.0, exponent)

    verts: list[tuple[float, float, float]] = []
    faces: list[Sequence[int]] = []
    uvs: dict[int, tuple[float, float]] = {}

    def add(x: float, y: float, z: float) -> int:
        index = len(verts)
        verts.append((x * size, y * size, z * size))
        # UV from the flat footprint, so the texture is unaffected by the dome.
        uvs[index] = (x * 0.5 + 0.5, y * 0.5 + 0.5)
        return index

    centre = add(0.0, 0.0, _dome_height(0.0, dome))

    ring_indices: list[list[int]] = []
    for r in range(1, rings + 1):
        s = r / rings
        z = _dome_height(s, dome)
        ring_indices.append([add(x * s, y * s, z) for x, y in outline])

    # Centre fan.
    first = ring_indices[0]
    for i in range(segments):
        faces.append((centre, first[i], first[(i + 1) % segments]))

    # Concentric quads.
    for inner, outer in zip(ring_indices, ring_indices[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((inner[i], outer[i], outer[j], inner[j]))

    # Rim wall and flat back.
    rim = ring_indices[-1]
    back_ring = [add(x, y, -thickness) for x, y in outline]
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((rim[i], back_ring[i], back_ring[j], rim[j]))

    back_centre = add(0.0, 0.0, -thickness)
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((back_centre, back_ring[j], back_ring[i]))

    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(verts, [], [list(f) for f in faces])
    mesh.update()

    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]

    for poly in mesh.polygons:
        poly.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    # Smooth across the dome, sharp where the face meets the rim wall. That
    # crease is what makes a tile read as a solid object rather than a
    # sticker, and an angle-based split gets it without hand-marking edges.
    # An EdgeSplit modifier is used rather than mesh-level auto-smooth because
    # the auto-smooth API moved between Blender 4.0 and 4.1; this spelling is
    # stable across every version this project targets.
    split = obj.modifiers.new("Rim", "EDGE_SPLIT")
    split.use_edge_angle = True
    split.use_edge_sharp = False
    split.split_angle = math.radians(40.0)
    return obj


def create_bubble(name: str, radius: float = 0.1, subdivisions: int = 3) -> bpy.types.Object:
    """An ico-sphere bubble. Ico rather than UV so there are no pole pinches.

    Bubbles carry thin-film iridescence, and a UV sphere's pole convergence
    concentrates the film's colour banding into two visible dots.
    """
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj
