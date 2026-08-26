"""
A ContainerSpec, built as a solid.

`container_ring` gives the same contour the rasteriser fills. This extrudes it,
bevels the rim, and hangs a glyph plate in front of the face. The result is a
tile whose silhouette is provably the icon's silhouette — not a modelled
approximation of it, and not something that drifts the next time the scene is
rebuilt.

Tile dimensions are in unit-tile space: one tile spans 1.0 across the padded
canvas, so a grid at 1.0 spacing reproduces the icon grid's optical rhythm.
"""

from __future__ import annotations

from pathlib import Path

import bmesh
import bpy

from . import materials
from .geometry import container_ring, ring_to_unit
from .spec import ContainerSpec


def build_tile(
    spec: ContainerSpec,
    name: str = "Tile",
    depth: float = 0.22,
    bevel: float = 0.045,
    bevel_segments: int = 6,
    glass: bpy.types.Material | None = None,
    icon: str | Path | None = None,
) -> bpy.types.Object:
    """
    One glass tile.

    `depth` is front-to-back thickness. It matters more than it looks: the
    volume tint deepens with thickness, so a thin tile reads as a sticker and a
    thick one reads as a lozenge of coloured water. 0.22 is roughly the
    proportion the 2D set implies through its inner shading.

    `bevel` is the rim width. This is where the rim glow lives and where every
    specular hit lands, so it is doing the work that a highlight layer does in
    the 2D icon.
    """
    ring = ring_to_unit(container_ring(spec), spec)

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    bm = bmesh.new()
    verts = [bm.verts.new((x, -depth / 2.0, y)) for x, y in ring]
    face = bm.faces.new(verts)

    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [v for v in extruded["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0.0, depth, 0.0))

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    mesh.shade_smooth()
    # Only the rim should round over. The side wall is a fan of near-coplanar
    # quads (5.6 degrees apart at 64 segments) and must be left alone, which is
    # exactly what an angle limit above that threshold does.
    modifier = obj.modifiers.new("Rim", "BEVEL")
    modifier.width = bevel
    modifier.segments = bevel_segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = 0.523599  # 30 degrees
    modifier.harden_normals = False

    obj.data.materials.append(glass or materials.aero_glass(f"{name}Glass"))

    if icon is not None:
        plate = build_glyph_plate(spec, f"{name}Glyph", icon, depth=depth)
        plate.parent = obj

    return obj


def build_glyph_plate(
    spec: ContainerSpec,
    name: str,
    icon: str | Path,
    depth: float = 0.22,
    lift: float = 0.004,
) -> bpy.types.Object:
    """
    The flat quad carrying the rendered icon, floating just proud of the face.

    A quad rather than a plate cut to the glyph safe path: the PNG's own alpha
    already carries the silhouette, and cutting the mesh to the safe area as
    well would clip glyphs that legitimately bleed toward the rim. The safe
    area governs the *scale* of the quad instead, which is what it means in the
    2D pipeline too.
    """
    scale = 1.0 - spec.glyph_inset / 100.0
    half = scale * (1.0 - spec.padding * 2.0 / 100.0) / 2.0
    y = -depth / 2.0 - lift

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(
        [(-half, y, -half), (half, y, -half), (half, y, half), (-half, y, half)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()

    uv = mesh.uv_layers.new(name="UVMap")
    for i, coord in enumerate([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]):
        uv.data[i].uv = coord

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(materials.icon_face(name, icon))
    return obj


def find_icons(directory: str | Path, limit: int | None = None) -> list[Path]:
    """
    Collect icon PNGs from a directory, in a stable order.

    Sorted by name so a rebuild places the same icon in the same slot. An
    unsorted `glob` would reshuffle the scene on a different filesystem, which
    is the kind of non-determinism this project exists to avoid.
    """
    root = Path(directory)
    if not root.is_dir():
        return []
    found = sorted(p for p in root.rglob("*.png") if p.is_file())
    return found[:limit] if limit else found
