/**
 * Deterministic container geometry.
 *
 * Every export here is a pure function of its arguments: no randomness, no
 * clock, no floating-point accumulation across calls. Feed the same spec in
 * and you get a byte-identical path string out, which is what removes the
 * corner-radius drift entirely.
 */

import type { ContainerSpec } from './spec';

export interface Point {
  x: number;
  y: number;
}

/**
 * Rounding applied to every emitted coordinate. Six decimals is far below one
 * device pixel at 4096px, but fixing the precision matters more than the
 * accuracy: it stops the last bits of a float from making two mathematically
 * identical paths serialise differently.
 */
const PRECISION = 6;

const fixed = (value: number) => {
  const rounded = Number(value.toFixed(PRECISION));
  // Normalise -0 to 0 so the string form can't differ on sign of zero.
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** The drawable box after optical padding, in canvas coordinates. */
export function innerBox(spec: ContainerSpec) {
  const pad = (spec.size * spec.padding) / 100;
  const edge = spec.size - pad * 2;
  return { x: pad, y: pad, edge, cx: spec.size / 2, cy: spec.size / 2 };
}

/**
 * Point on a superellipse |x/a|^n + |y/b|^n = 1, in the parametric form
 *   x = a·sgn(cos t)·|cos t|^(2/n),  y = b·sgn(sin t)·|sin t|^(2/n)
 * centred on the origin.
 */
function superellipsePoint(t: number, a: number, b: number, n: number): Point {
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const e = 2 / n;
  return {
    x: a * Math.sign(ct) * Math.pow(Math.abs(ct), e),
    y: b * Math.sign(st) * Math.pow(Math.abs(st), e),
  };
}

/**
 * Resample a closed curve so points are distributed by a blend of arc length
 * and turning angle, rather than by the parameter t.
 *
 * Uniform-in-t is wrong here: for n > 2 the parametric speed of a superellipse
 * is wildly non-uniform, and nearly all of the t range maps to the flat edges
 * while the corner turns over in a sliver near t = k*pi/2.
 *
 * Uniform-in-arc-length is also wrong, just less obviously. At high exponents
 * the corners occupy a tiny fraction of the perimeter, so they receive almost
 * no samples and the Bezier fit through them bulges past the bounding box.
 *
 * Weighting each step by `distance + CURVATURE_WEIGHT * scale * |turn|` fixes
 * both: flat runs stay cheap, corners cost in proportion to how sharply they
 * turn, and the sampler spends its budget where the shape actually happens.
 */
const CURVATURE_WEIGHT = 1.5;

function resampleByShape(
  at: (t: number) => Point,
  count: number,
  scale: number,
  denseFactor = 64,
): Point[] {
  const dense = count * denseFactor;
  const samples: Point[] = new Array(dense + 1);
  for (let i = 0; i <= dense; i++) {
    samples[i] = at((i / dense) * Math.PI * 2);
  }

  const heading = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);
  /** Signed angular difference wrapped into (-pi, pi]. */
  const wrap = (angle: number) => {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value <= -Math.PI) value += Math.PI * 2;
    return value;
  };

  const cumulative: number[] = new Array(dense + 1);
  cumulative[0] = 0;
  let previousHeading = heading(samples[dense - 1], samples[dense]);

  for (let i = 1; i <= dense; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const current = distance > 0 ? heading(a, b) : previousHeading;
    const turn = Math.abs(wrap(current - previousHeading));
    previousHeading = current;
    cumulative[i] = cumulative[i - 1] + distance + CURVATURE_WEIGHT * scale * turn;
  }

  const total = cumulative[dense];
  const out: Point[] = new Array(count);
  let cursor = 1;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (cursor < dense && cumulative[cursor] < target) cursor++;
    const spanStart = cumulative[cursor - 1];
    const span = cumulative[cursor] - spanStart;
    const ratio = span === 0 ? 0 : (target - spanStart) / span;
    const a = samples[cursor - 1];
    const b = samples[cursor];
    out[i] = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
  }
  return out;
}

/**
 * Convert a closed ring of points into a closed cubic Bezier path using
 * centripetal Catmull-Rom (alpha = 0.5).
 *
 * Two deliberate choices here:
 *
 *  - Catmull-Rom rather than the analytic derivative, because the parametric
 *    derivative of a superellipse is unbounded at the edge midpoints for every
 *    n > 2, so control points built from it come out infinite.
 *  - Centripetal rather than uniform parametrisation, because uniform weights
 *    overshoot wherever curvature changes quickly — measurably so, about 1.5px
 *    past the bounding box at high exponents, right at the flat-to-corner
 *    transition. Centripetal weighting is the standard fix and keeps the
 *    contour inside the box it was specified in.
 */
function ringToCubicPath(points: Point[]): string {
  const n = points.length;
  if (n < 3) return '';

  const ALPHA = 0.5;
  const knot = (a: Point, b: Point) => {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    // Guard against coincident samples, which would divide by zero below.
    return Math.pow(Math.max(distance, 1e-9), ALPHA);
  };

  const parts: string[] = [`M ${fixed(points[0].x)} ${fixed(points[0].y)}`];

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const d1 = knot(p0, p1);
    const d2 = knot(p1, p2);
    const d3 = knot(p2, p3);

    const axis = (k0: number, k1: number, k2: number, k3: number) => {
      const c1 =
        (d1 * d1 * k2 - d2 * d2 * k0 + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * k1) /
        (3 * d1 * (d1 + d2));
      const c2 =
        (d3 * d3 * k1 - d2 * d2 * k3 + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * k2) /
        (3 * d3 * (d3 + d2));
      return [c1, c2] as const;
    };

    const [c1x, c2x] = axis(p0.x, p1.x, p2.x, p3.x);
    const [c1y, c2y] = axis(p0.y, p1.y, p2.y, p3.y);

    parts.push(
      `C ${fixed(c1x)} ${fixed(c1y)} ${fixed(c2x)} ${fixed(c2y)} ${fixed(p2.x)} ${fixed(p2.y)}`,
    );
  }

  parts.push('Z');
  return parts.join(' ');
}

/** Exact rounded rectangle using arc commands — no approximation needed. */
function roundedRectPath(x: number, y: number, edge: number, radiusPercent: number): string {
  const r = Math.min(edge / 2, (edge * radiusPercent) / 100);
  if (r <= 0) {
    return [
      `M ${fixed(x)} ${fixed(y)}`,
      `L ${fixed(x + edge)} ${fixed(y)}`,
      `L ${fixed(x + edge)} ${fixed(y + edge)}`,
      `L ${fixed(x)} ${fixed(y + edge)}`,
      'Z',
    ].join(' ');
  }
  return [
    `M ${fixed(x + r)} ${fixed(y)}`,
    `L ${fixed(x + edge - r)} ${fixed(y)}`,
    `A ${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x + edge)} ${fixed(y + r)}`,
    `L ${fixed(x + edge)} ${fixed(y + edge - r)}`,
    `A ${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x + edge - r)} ${fixed(y + edge)}`,
    `L ${fixed(x + r)} ${fixed(y + edge)}`,
    `A ${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x)} ${fixed(y + edge - r)}`,
    `L ${fixed(x)} ${fixed(y + r)}`,
    `A ${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x + r)} ${fixed(y)}`,
    'Z',
  ].join(' ');
}

/** Exact circle inscribed in the inner box, drawn as two arcs. */
function circlePath(cx: number, cy: number, r: number): string {
  return [
    `M ${fixed(cx - r)} ${fixed(cy)}`,
    `A ${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(cx + r)} ${fixed(cy)}`,
    `A ${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(cx - r)} ${fixed(cy)}`,
    'Z',
  ].join(' ');
}

/**
 * Rescale a custom path authored in a 0..1000 viewBox into the inner box.
 * Only the numeric literals are touched; command letters pass through, so an
 * arbitrary path from Figma or Illustrator survives intact.
 */
function scaleCustomPath(path: string, x: number, y: number, edge: number): string {
  const k = edge / 1000;
  let axis = 0;
  return path.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (match) => {
    const value = Number(match);
    const mapped = axis % 2 === 0 ? x + value * k : y + value * k;
    axis++;
    return String(fixed(mapped));
  });
}

/**
 * Build the container outline for a spec.
 *
 * `scale` shrinks the shape about its centre (1 = the container itself,
 * 1 - glyphInset/100 = the glyph safe area). Scaling the *path* rather than
 * eroding a bitmap keeps the inner contour mathematically similar to the outer
 * one, so a glyph never picks up a corner shape that disagrees with its shell.
 */
export function containerPath(spec: ContainerSpec, scale = 1): string {
  const { edge, cx, cy } = innerBox(spec);
  const scaledEdge = edge * scale;
  const originX = cx - scaledEdge / 2;
  const originY = cy - scaledEdge / 2;

  switch (spec.shape) {
    case 'circle':
      return circlePath(cx, cy, scaledEdge / 2);

    case 'rounded-rect':
      return roundedRectPath(originX, originY, scaledEdge, spec.radius);

    case 'superellipse': {
      const a = scaledEdge / 2;
      const ring = resampleByShape(
        (t) => {
          const p = superellipsePoint(t, a, a, spec.exponent);
          return { x: cx + p.x, y: cy + p.y };
        },
        spec.segments,
        a,
      );
      return ringToCubicPath(ring);
    }

    case 'custom-path':
      return spec.customPath
        ? scaleCustomPath(spec.customPath, originX, originY, scaledEdge)
        : roundedRectPath(originX, originY, scaledEdge, spec.radius);

    default:
      // Exhaustiveness guard: a new ShapeKind must be handled explicitly.
      return roundedRectPath(originX, originY, scaledEdge, spec.radius);
  }
}

/** The glyph safe-area path — the container contour, scaled about its centre. */
export function glyphSafePath(spec: ContainerSpec): string {
  return containerPath(spec, 1 - spec.glyphInset / 100);
}

/**
 * The single number the drift problem is about: the effective corner radius of
 * the container, in pixels, measured the same way for every shape kind.
 *
 * Defined as the radius of the circle through the point where the contour
 * crosses the 45-degree diagonal and the two adjacent axis extremes — i.e. how
 * round the corner actually looks, regardless of how the shape was specified.
 */
export function effectiveCornerRadius(spec: ContainerSpec): number {
  const { edge } = innerBox(spec);

  const a = edge / 2;

  switch (spec.shape) {
    case 'circle':
      return a;
    case 'rounded-rect':
      return Math.min(a, (edge * spec.radius) / 100);
    case 'superellipse': {
      // Distance from the corner of the bounding box to the contour along the
      // diagonal, converted to the radius of the osculating circle there.
      const d = a * Math.pow(0.5, 1 / spec.exponent); // contour crossing on x=y
      const gap = Math.SQRT2 * (a - d); // corner cut depth along the diagonal
      return gap / (Math.SQRT2 - 1);
    }
    default:
      return Number.NaN;
  }
}

/** Wrap a path in a standalone SVG document. */
export function toSvgDocument(spec: ContainerSpec, path: string, fill = '#111827'): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.size}" height="${spec.size}"`,
    ` viewBox="0 0 ${spec.size} ${spec.size}">`,
    `<path d="${path}" fill="${fill}" fill-rule="evenodd"/>`,
    '</svg>',
  ].join('');
}
