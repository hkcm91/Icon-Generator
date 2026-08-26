"""
Geometry self-checks.

Runs without Blender: `spec.py` and `geometry.py` import nothing from `bpy`,
deliberately, so the part that has to agree with the TypeScript can be checked
anywhere.

    python3 blender/tests/test_geometry.py

What is being defended here is the same property `test/geometry.test.ts`
defends on the other side: the contour is a pure function of the spec, and it
stays inside the box it was specified in.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aero.geometry import bounds, container_ring, ring_to_unit  # noqa: E402
from aero.spec import DEFAULT_SPEC, ContainerSpec, normalise  # noqa: E402

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        FAILURES.append(message)


def approx(a: float, b: float, tolerance: float = 1e-6) -> bool:
    return abs(a - b) <= tolerance


print("determinism")
for shape in ("superellipse", "rounded-rect", "circle"):
    spec = ContainerSpec(shape=shape)
    first = ring_to_unit(container_ring(spec), spec)
    second = ring_to_unit(container_ring(spec), spec)
    check(first == second, f"{shape}: two builds produce an identical ring")

print("containment")
for exponent in (2.0, 4.0, 5.0, 8.0, 16.0):
    spec = ContainerSpec(shape="superellipse", exponent=exponent)
    ring = ring_to_unit(container_ring(spec), spec)
    min_x, min_y, max_x, max_y = bounds(ring)
    half = (1.0 - spec.padding * 2.0 / 100.0) / 2.0
    inside = max(abs(min_x), abs(min_y), abs(max_x), abs(max_y)) <= half + 1e-6
    check(inside, f"n={exponent}: contour stays within the padded box")
    check(approx(max_x, half), f"n={exponent}: contour reaches the box edge")

print("shape")
# A superellipse at n=2 is a circle, so every point sits on one radius.
spec = ContainerSpec(shape="superellipse", exponent=2.0)
radii = [(x * x + y * y) ** 0.5 for x, y in ring_to_unit(container_ring(spec), spec)]
check(max(radii) - min(radii) < 1e-3, "n=2 is a circle to within a thousandth")

# Higher exponents push area toward the corners, so the corner-most point of a
# squircle sits further from centre than a circle's does.
def corner_reach(exponent: float) -> float:
    s = ContainerSpec(shape="superellipse", exponent=exponent)
    return max((x * x + y * y) ** 0.5 for x, y in ring_to_unit(container_ring(s), s))


check(corner_reach(8.0) > corner_reach(5.0) > corner_reach(2.0), "corners fill out as n rises")

print("segments")
for count in (16, 64, 128):
    spec = ContainerSpec(shape="superellipse", segments=count)
    check(len(container_ring(spec)) == count, f"segments={count} yields {count} points")

print("clamping")
wild = normalise({"size": 99999, "padding": -40, "exponent": 900, "shape": "nonsense"})
check(wild.size == 4096, "oversized canvas clamps to 4096")
check(wild.padding == 0, "negative padding clamps to 0")
check(wild.exponent == 16, "runaway exponent clamps to 16")
check(wild.shape == DEFAULT_SPEC.shape, "unknown shape falls back to the default")

print()
if FAILURES:
    print(f"{len(FAILURES)} failed")
    raise SystemExit(1)
print("all passed")
