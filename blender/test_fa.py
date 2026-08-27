#!/usr/bin/env python3
"""
Tests for the parts that fail silently.

The bugs this project has actually hit were not crashes. A camera aimed by a
sign-flipped formula renders a clean, plausible image of the wrong thing. A
traveller moving at a fractional speed loops perfectly for nine seconds and
snaps on the tenth. Neither raises, and both cost a render to notice.

So these cover the invariants that only reveal themselves in output:
aiming, periodicity, and the interlock between `rise` and `fade_at_ends`.
Composition and colour are judged by eye; correctness is judged here.

    python test_fa.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402  (imported for mathutils and the bpy-backed modules)
from mathutils import Euler, Vector  # noqa: E402

from fa import geometry, loop as fa_loop  # noqa: E402
from fa.environment import _look_rotation  # noqa: E402

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        FAILURES.append(message)


# ---------------------------------------------------------------------------


def test_look_rotation_aims_minus_z():
    """The returned Euler must rotate -Z onto the requested direction.

    Regression test for a sign flip in the pitch term. It mirrored every aim
    about the horizon: a camera asked to look 7 degrees up looked 7 degrees
    down. At small angles that reads as slightly odd framing rather than as a
    bug, which is exactly why it survived several renders.
    """
    cases = {
        "straight down": (0, 0, -1),
        "straight up": (0, 0, 1),
        "north": (0, 1, 0),
        "east": (1, 0, 0),
        "west": (-1, 0, 0),
        "south": (0, -1, 0),
        "up and away": (0.0, 12.5, 1.6),
        "down and away": (0.0, 12.5, -0.7),
        "diagonal": (3.0, -4.0, 5.0),
    }
    for label, direction in cases.items():
        want = Vector(direction).normalized()
        got = (Euler(_look_rotation(direction), "XYZ").to_matrix() @ Vector((0, 0, -1))).normalized()
        check((want - got).length < 1e-6, f"_look_rotation({label}): want {want}, got {got}")


def test_look_rotation_pitch_sign():
    """Explicitly: a target above the origin must pitch the camera upward.

    Stated separately from the vector test because this is the property a
    human reasons about when placing a camera, and it is the one that broke.
    """
    up = _look_rotation((0.0, 10.0, 5.0))[0]
    down = _look_rotation((0.0, 10.0, -5.0))[0]
    check(up > math.pi / 2, f"looking up should pitch past 90 degrees, got {math.degrees(up):.1f}")
    check(down < math.pi / 2, f"looking down should pitch under 90 degrees, got {math.degrees(down):.1f}")


# ---------------------------------------------------------------------------


def test_periodic_primitives_close_the_loop():
    """f(0) == f(1) for every oscillator, at every cycle count."""
    for cycles in (1, 2, 3, 7):
        for fn in (fa_loop.wave, fa_loop.wave2):
            start = fn(0.0, 1.0, 0.3, cycles=cycles)
            end = fn(1.0, 1.0, 0.3, cycles=cycles)
            check(
                abs(start - end) < 1e-9,
                f"{fn.__name__}(cycles={cycles}) is not periodic: {start} vs {end}",
            )
    for offset in (0.0, 0.37, 0.9):
        check(
            abs(fa_loop.bob(0.0, 1.0, offset) - fa_loop.bob(1.0, 1.0, offset)) < 1e-9,
            f"bob(offset={offset}) is not periodic",
        )


def test_travel_rejects_fractional_cycles():
    """A fractional speed is the quiet way to break a loop; it must raise."""
    try:
        fa_loop.travel(0.5, cycles=1.5)
    except ValueError:
        pass
    else:
        FAILURES.append("travel() accepted a fractional cycle count")

    for cycles in (1, 2, 5):
        check(
            abs(fa_loop.travel(0.0, 0.3, cycles) - fa_loop.travel(1.0, 0.3, cycles)) < 1e-9,
            f"travel(cycles={cycles}) is not periodic",
        )


def test_fade_hides_every_wrap():
    """The core interlock: `rise` may only teleport while `fade` reads zero.

    Swept across phases, cycle counts and loop lengths, because the failure is
    phase-dependent — most offsets put the wrap somewhere harmless and only
    some land it where it shows.
    """
    for frames in (24, 60, 300, 450):
        spec = fa_loop.Loop(frames=frames)
        for cycles in (1, 2):
            dead = spec.dead_zone(cycles)
            ramp = max(0.18, dead * 2.5)
            for phase in [i / 17 for i in range(17)]:
                previous = None
                for frame in spec.frame_range():
                    t = spec.phase(frame)
                    height = fa_loop.rise(t, 10.0, phase, cycles=cycles)
                    visible = fa_loop.fade_at_ends(t, phase, ramp=ramp, cycles=cycles, dead=dead)
                    if previous is not None:
                        jumped = height - previous[0] < -1.0
                        if jumped:
                            check(
                                previous[1] == 0.0 and visible == 0.0,
                                f"frames={frames} cycles={cycles} phase={phase:.3f}: "
                                f"wrap at frame {frame} while visible "
                                f"({previous[1]:.4f} -> {visible:.4f})",
                            )
                    previous = (height, visible)


def test_fade_rejects_ramp_inside_dead_zone():
    try:
        fa_loop.fade_at_ends(0.5, ramp=0.05, dead=0.05)
    except ValueError:
        pass
    else:
        FAILURES.append("fade_at_ends() accepted ramp <= dead")


def test_dead_zone_outruns_one_frame():
    """The window must be wider than a frame's progress, or a wrap steps it."""
    for frames in (24, 60, 300, 450):
        spec = fa_loop.Loop(frames=frames)
        for cycles in (1, 2, 3):
            check(
                spec.dead_zone(cycles) > cycles / frames,
                f"dead_zone({cycles}) too narrow at {frames} frames",
            )


# ---------------------------------------------------------------------------


def test_superellipse_matches_the_typescript():
    """Spot-check the port against values from the |x|^n + |y|^n = 1 identity.

    The app treats the silhouette as compiled data; if this drifts, the 3D rim
    stops matching the painted edge and every tile grows a sliver of mismatch.
    """
    for exponent in (2.0, 4.0, 5.0, 8.0):
        for i in range(64):
            x, y = geometry.superellipse_point(i / 64 * math.tau, 1.0, 1.0, exponent)
            residual = abs(abs(x) ** exponent + abs(y) ** exponent - 1.0)
            check(residual < 1e-9, f"exponent {exponent}: point off the curve by {residual:.2e}")


def test_ring_is_closed_and_evenly_spaced():
    """Arc-length resampling: no segment may be wildly longer than the mean.

    Even spacing is not cosmetic here. Crowded corners and starved edges
    interpolate normals differently, and the specular highlight — the most
    important thing on a glossy icon — crawls as it crosses the change.
    """
    ring = geometry.superellipse_ring(96, 1.0, geometry.DEFAULT_EXPONENT)
    check(len(ring) == 96, f"expected 96 points, got {len(ring)}")

    lengths = [
        math.dist(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))
    ]
    mean = sum(lengths) / len(lengths)
    spread = max(lengths) / min(lengths)
    check(spread < 1.15, f"segment lengths vary by {spread:.2f}x (mean {mean:.4f})")


def test_tile_mesh_is_closed():
    """A tile is a solid: every edge shared by exactly two faces.

    An open mesh would let transmission rays leak straight through the body
    and the gel would render as a hollow shell.
    """
    tile = geometry.create_icon_tile("test_tile", segments=48, rings=6)
    mesh = tile.data
    counts: dict[tuple[int, int], int] = {}
    for poly in mesh.polygons:
        verts = list(poly.vertices)
        for a, b in zip(verts, verts[1:] + verts[:1]):
            counts[(min(a, b), max(a, b))] = counts.get((min(a, b), max(a, b)), 0) + 1

    open_edges = [e for e, n in counts.items() if n != 2]
    check(not open_edges, f"tile mesh has {len(open_edges)} non-manifold edges")
    check(len(mesh.uv_layers) == 1, "tile mesh is missing its UV layer")


# ---------------------------------------------------------------------------


def main() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        before = len(FAILURES)
        test()
        status = "ok" if len(FAILURES) == before else "FAIL"
        print(f"  {status:4s}  {test.__name__}")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failure(s):")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print(f"{len(tests)} tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
