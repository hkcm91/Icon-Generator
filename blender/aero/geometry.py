"""
Deterministic container geometry, ported from `src/core/geometry.ts`.

The 2D pipeline needs a cubic Bezier path because it draws into a canvas. A
mesh needs the ring of points that path was fitted through, so this module
stops one step earlier and returns the ring. Everything up to that point —
the parametric superellipse, the curvature-weighted resampler, the constants —
is the same algorithm, deliberately kept line-for-line comparable with the TS
so the two can be diffed by eye when either changes.

Same spec in, same ring out. No randomness, no clock.
"""

from __future__ import annotations

import math

from .spec import ContainerSpec

Point = tuple[float, float]

# See geometry.ts: flat runs stay cheap, corners cost in proportion to how
# sharply they turn. Uniform-in-t under-samples corners at high exponents;
# uniform-in-arc-length does too, just less obviously.
CURVATURE_WEIGHT = 1.5

PRECISION = 6


def _fixed(value: float) -> float:
    rounded = round(value, PRECISION)
    return 0.0 if rounded == 0 else rounded


def superellipse_point(t: float, a: float, b: float, n: float) -> Point:
    """
    Point on |x/a|^n + |y/b|^n = 1, in the parametric form
      x = a*sgn(cos t)*|cos t|^(2/n),  y = b*sgn(sin t)*|sin t|^(2/n)
    centred on the origin.
    """
    ct = math.cos(t)
    st = math.sin(t)
    e = 2.0 / n
    return (
        a * math.copysign(abs(ct) ** e, ct),
        b * math.copysign(abs(st) ** e, st),
    )


def _wrap(angle: float) -> float:
    """Signed angular difference wrapped into (-pi, pi]."""
    while angle > math.pi:
        angle -= math.tau
    while angle <= -math.pi:
        angle += math.tau
    return angle


def resample_by_shape(at, count: int, scale: float, dense_factor: int = 64) -> list[Point]:
    """
    Resample a closed curve so points are distributed by a blend of arc length
    and turning angle, rather than by the parameter t.
    """
    dense = count * dense_factor
    samples = [at((i / dense) * math.tau) for i in range(dense + 1)]

    def heading(a: Point, b: Point) -> float:
        return math.atan2(b[1] - a[1], b[0] - a[0])

    cumulative = [0.0] * (dense + 1)
    previous = heading(samples[dense - 1], samples[dense])

    for i in range(1, dense + 1):
        a, b = samples[i - 1], samples[i]
        distance = math.hypot(b[0] - a[0], b[1] - a[1])
        current = heading(a, b) if distance > 0 else previous
        turn = abs(_wrap(current - previous))
        previous = current
        cumulative[i] = cumulative[i - 1] + distance + CURVATURE_WEIGHT * scale * turn

    total = cumulative[dense]
    out: list[Point] = []
    cursor = 1
    for i in range(count):
        target = (i / count) * total
        while cursor < dense and cumulative[cursor] < target:
            cursor += 1
        span_start = cumulative[cursor - 1]
        span = cumulative[cursor] - span_start
        ratio = 0.0 if span == 0 else (target - span_start) / span
        a, b = samples[cursor - 1], samples[cursor]
        out.append((a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio))
    return out


def _circle_ring(cx: float, cy: float, r: float, count: int) -> list[Point]:
    return [
        (cx + r * math.cos(i / count * math.tau), cy + r * math.sin(i / count * math.tau))
        for i in range(count)
    ]


def _rounded_rect_ring(
    x: float, y: float, edge: float, radius_percent: float, count: int
) -> list[Point]:
    """
    Exact rounded rectangle. The corners are true quarter arcs rather than a
    fit, so no resampling is needed — the only choice is how many points each
    arc gets, and they are shared out evenly.
    """
    r = min(edge / 2.0, (edge * radius_percent) / 100.0)
    if r <= 0:
        return [(x, y), (x + edge, y), (x + edge, y + edge), (x, y + edge)]

    per_corner = max(2, count // 4)
    centres = [
        (x + edge - r, y + r, -math.pi / 2),  # top-right
        (x + edge - r, y + edge - r, 0.0),  # bottom-right
        (x + r, y + edge - r, math.pi / 2),  # bottom-left
        (x + r, y + r, math.pi),  # top-left
    ]

    ring: list[Point] = []
    for ccx, ccy, start in centres:
        for i in range(per_corner):
            angle = start + (i / (per_corner - 1)) * (math.pi / 2)
            ring.append((ccx + r * math.cos(angle), ccy + r * math.sin(angle)))
    return ring


def container_ring(spec: ContainerSpec, scale: float = 1.0) -> list[Point]:
    """
    The container contour as a closed ring of points, in canvas coordinates
    (origin top-left, y down, edge length `spec.size`).

    `scale` shrinks the contour about its centre, exactly as in
    `containerPath(spec, scale)`. Pass `1 - spec.glyph_inset / 100` to get the
    glyph safe area — the shape a glyph plate should be cut to.
    """
    _, _, edge, centre = spec.inner_box
    scaled = edge * scale
    origin = centre - scaled / 2.0

    if spec.shape == "circle":
        return _circle_ring(centre, centre, scaled / 2.0, spec.segments)

    if spec.shape == "superellipse":
        a = scaled / 2.0

        def at(t: float) -> Point:
            px, py = superellipse_point(t, a, a, spec.exponent)
            return centre + px, centre + py

        return resample_by_shape(at, spec.segments, a)

    # 'rounded-rect', and 'custom-path' until path parsing lands here — the TS
    # falls back the same way when customPath is empty.
    return _rounded_rect_ring(origin, origin, scaled, spec.radius, spec.segments)


def ring_to_unit(ring: list[Point], spec: ContainerSpec) -> list[Point]:
    """
    Canvas coordinates to Blender's: centred on the origin, y up, and scaled so
    that one tile spans 1.0 unit across the *padded* canvas.

    Padding is kept inside that unit rather than trimmed away, so tiles spaced
    1.0 apart in the scene sit at exactly the optical spacing the icon grid was
    designed for.
    """
    half = spec.size / 2.0
    return [(_fixed((x - half) / spec.size), _fixed((half - y) / spec.size)) for x, y in ring]


def bounds(ring: list[Point]) -> tuple[float, float, float, float]:
    """(min_x, min_y, max_x, max_y) — used by the self-checks."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)
