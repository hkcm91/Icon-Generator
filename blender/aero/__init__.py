"""
aero — a Blender scene, built from the icon set's own container spec.

The .blend is a build artifact. The scene lives here, in code, because a binary
that four people have each nudged by hand is not a thing you can review, diff,
or rebuild at a different resolution six months from now. Run the builder and
you get the same scene every time; edit the .blend and you get a render, not a
project.

    build_scene.py  ->  out/aero.blend  ->  out/loop.mp4

Modules:
    spec       ContainerSpec, mirroring src/core/spec.ts
    geometry   the contour, ported from src/core/geometry.ts
    tile       that contour, extruded into glass
    materials  the aqua glass, the glyph plate, the world
    loop       phase helpers that make the loop close by construction
    render     engines, resolutions, output formats
"""

__all__ = ["spec", "geometry", "tile", "materials", "loop", "render"]
