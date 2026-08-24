/**
 * Trace an approved master icon into a container spec.
 *
 * The premise: if the master you already approved is itself slightly irregular,
 * fitting it to an idealised preset bakes a mismatch into every icon that
 * follows. The master should define the container, not be approximated by one.
 *
 * Three outputs, because "faithful" and "clean" are genuinely different goals:
 *
 *  - **parametric** — the closest superellipse / rounded rect / circle. Cleanest
 *    result, and it changes the master's look by however far it was off.
 *  - **symmetric** — the master's own corner profile, folded across both axes
 *    and averaged. Keeps the curve the master actually has while removing
 *    per-corner noise. Usually the right default.
 *  - **exact** — the contour verbatim, asymmetry included. Faithful to the
 *    approved artwork, and every icon in the family inherits the same
 *    irregularity, which is consistent even where it is not ideal.
 *
 * Whichever is chosen, the result is a spec: from then on it is compiled, so it
 * stops moving.
 */

import { ringToCubicPath, type Point } from './geometry';
import { boundingBox, contourPoints, subPixelBox, toMask, type BoundingBox, type Mask, type RGBAImage } from './measure';
import { fitExponent } from './measure';
import { normalizeSpec, type ContainerSpec } from './spec';

const ALPHA_THRESHOLD = 128;

/** Bilinear coverage sample at a continuous position; centres are at +0.5. */
function sampleCoverage(mask: Mask, x: number, y: number): number {
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;

  const at = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return 0;
    return mask.coverage[py * mask.width + px];
  };

  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Radial contour trace.
 *
 * Marches outward from the centre along `samples` evenly spaced rays and
 * records where coverage falls through the threshold. Icon containers are
 * star-convex about their centre, which is exactly the condition that makes
 * this valid — and it yields an ordered, already-resampled closed ring, so no
 * separate edge-walk-then-order step is needed.
 *
 * Marching outward and taking the *last* crossing rather than the first makes
 * it robust to interior holes and to a glyph of a different tone sitting inside
 * the container: only the outer silhouette is traced.
 */
export function radialContour(mask: Mask, box: BoundingBox, samples = 256): Point[] {
  const maxRadius = Math.hypot(box.width, box.height) / 2 + 4;
  const step = 0.25;
  const points: Point[] = [];

  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let lastInside = 0;
    let previousValue = sampleCoverage(mask, box.cx, box.cy);

    for (let radius = step; radius <= maxRadius; radius += step) {
      const value = sampleCoverage(mask, box.cx + dx * radius, box.cy + dy * radius);
      if (previousValue >= ALPHA_THRESHOLD && value < ALPHA_THRESHOLD) {
        // Sub-pixel: interpolate where the ramp crosses the threshold.
        const span = previousValue - value;
        const frac = span === 0 ? 0 : (previousValue - ALPHA_THRESHOLD) / span;
        lastInside = radius - step + step * frac;
      }
      previousValue = value;
    }

    points.push({ x: box.cx + dx * lastInside, y: box.cy + dy * lastInside });
  }

  return points;
}

/**
 * Mirror partners of ray `i` on an `n`-ray contour.
 *
 * A ray at angle t = 2*pi*i/n maps under reflection to:
 *   about the y axis (x -> -x):  pi - t   ->  n/2 - i
 *   about the x axis (y -> -y):  -t       ->  n - i
 *   about both:                  pi + t   ->  n/2 + i
 *
 * Getting these indices off by one silently averages rays that are not
 * actually mirrors, which reads as residual asymmetry in a shape that is in
 * fact symmetric.
 *
 * Reflection about the two axes (rather than full 90-degree rotational
 * symmetry) is the deliberate choice: it averages all four *corners* together,
 * which is the asymmetry that matters, without forcing a master that is
 * slightly wider than it is tall to become square.
 */
function mirrorIndices(index: number, count: number): number[] {
  const half = count / 2;
  return [
    index,
    (half - index + count) % count,
    (half + index) % count,
    (count - index) % count,
  ];
}

/**
 * Fold the contour across both axes and average.
 *
 * Removes per-corner asymmetry while preserving the corner *profile* the master
 * actually has — which is the distinction that matters. An idealised preset
 * changes the curve; this keeps the curve and only evens it out.
 */
export function symmetrizeContour(points: Point[], box: BoundingBox): Point[] {
  const n = points.length;
  if (n % 4 !== 0) return points;

  const radii = points.map((point) => Math.hypot(point.x - box.cx, point.y - box.cy));
  const averaged = radii.map((_radius, index) => {
    const group = mirrorIndices(index, n);
    return group.reduce((sum, at) => sum + radii[at], 0) / group.length;
  });

  // The four fixed points of the mirror group — 0, n/4, n/2, 3n/4, i.e. the
  // edge midpoints — are degenerate: each maps to only two distinct rays where
  // every other index maps to four. On an asymmetric master those two averages
  // differ from their neighbours' four-averages, leaving a one-sample spike at
  // each edge midpoint.
  //
  // Only those four indices are corrected, and each is re-estimated from its
  // four neighbours by symmetric parabolic interpolation:
  //
  //     r(0) ~= (4*(r[-1] + r[1]) - (r[-2] + r[2])) / 6
  //
  // which is exact for a quadratic. That matters because an edge midpoint is a
  // genuine local extremum of the radius function — for a superellipse it is
  // the minimum — so averaging the two neighbours overshoots it by the local
  // curvature (0.24px on a 400px master). Smoothing the whole ring has the
  // same problem at every corner as well; this leaves every other sample
  // exactly as computed.
  const despiked = [...averaged];
  const at = (index: number) => averaged[(index + n) % n];
  for (const fixedPoint of [0, n / 4, n / 2, (3 * n) / 4]) {
    despiked[fixedPoint] =
      (4 * (at(fixedPoint - 1) + at(fixedPoint + 1)) - (at(fixedPoint - 2) + at(fixedPoint + 2))) /
      6;
  }

  return points.map((_point, index) => {
    const angle = (index / n) * Math.PI * 2;
    return {
      x: box.cx + Math.cos(angle) * despiked[index],
      y: box.cy + Math.sin(angle) * despiked[index],
    };
  });
}

/**
 * Normalise a contour into the 0..1000 viewBox that `custom-path` specs use,
 * scaling about the contour's own bounds so the shape fills the box exactly.
 */
export function contourToPathData(points: Point[]): string {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const scale = 1000 / Math.max(width, height, 1e-6);

  // Centre the shorter axis so a slightly non-square master is not stretched.
  const offsetX = (1000 - width * scale) / 2;
  const offsetY = (1000 - height * scale) / 2;

  return ringToCubicPath(
    points.map((point) => ({
      x: (point.x - minX) * scale + offsetX,
      y: (point.y - minY) * scale + offsetY,
    })),
  );
}

export type TraceMode = 'parametric' | 'symmetric' | 'exact';

export interface TraceResult {
  spec: ContainerSpec;
  /** Max deviation from the best parametric fit, in px on the source image. */
  maxDeviation: number;
  /** RMS deviation from that fit, in px. */
  rmsDeviation: number;
  /** Deviation as a percentage of the silhouette's edge. */
  deviationPercent: number;
  /** Best-fit superellipse exponent for the master. */
  exponent: number;
  /** Asymmetry: max spread of mirrored radii, in px. */
  asymmetry: number;
  mode: TraceMode;
}

/**
 * Deviation of the traced contour from a perfect superellipse at `exponent`,
 * measured radially. This is the number that answers "is my master close enough
 * to an ideal shape that I should just use the ideal one?".
 */
function deviationFromSuperellipse(points: Point[], box: BoundingBox, exponent: number) {
  const a = box.width / 2;
  const b = box.height / 2;
  let worst = 0;
  let squared = 0;

  for (const point of points) {
    const dx = point.x - box.cx;
    const dy = point.y - box.cy;
    const angle = Math.atan2(dy, dx);

    // Radius of the ideal superellipse along this ray.
    const cu = Math.abs(Math.cos(angle)) / a;
    const cv = Math.abs(Math.sin(angle)) / b;
    const ideal = Math.pow(Math.pow(cu, exponent) + Math.pow(cv, exponent), -1 / exponent);

    const actual = Math.hypot(dx, dy);
    const delta = Math.abs(actual - ideal);
    if (delta > worst) worst = delta;
    squared += delta * delta;
  }

  return { max: worst, rms: Math.sqrt(squared / points.length) };
}

/** Largest spread among mirrored ray radii — how lopsided the master is. */
function measureAsymmetry(points: Point[], box: BoundingBox): number {
  const n = points.length;
  if (n % 4 !== 0) return Number.NaN;
  const radii = points.map((point) => Math.hypot(point.x - box.cx, point.y - box.cy));

  let worst = 0;
  for (let index = 0; index < n; index++) {
    const group = mirrorIndices(index, n).map((at) => radii[at]);
    worst = Math.max(worst, Math.max(...group) - Math.min(...group));
  }
  return worst;
}

export function traceMaster(
  image: RGBAImage,
  mode: TraceMode,
  base: ContainerSpec,
  samples = 256,
): TraceResult {
  const mask = toMask(image);
  const pixelBox = boundingBox(mask);
  const box = subPixelBox(contourPoints(mask, pixelBox));

  const traced = radialContour(mask, box, samples);
  const { exponent } = fitExponent(traced, box);
  const usableExponent = Number.isFinite(exponent) ? exponent : 4;

  const deviation = deviationFromSuperellipse(traced, box, usableExponent);
  const asymmetry = measureAsymmetry(traced, box);
  const shortEdge = Math.min(box.width, box.height);

  // Padding is taken from the master so the family inherits its optical margin.
  const padding =
    ((Math.min(image.width, image.height) - shortEdge) / 2 / Math.min(image.width, image.height)) *
    100;

  const contour = mode === 'exact' ? traced : symmetrizeContour(traced, box);

  const spec =
    mode === 'parametric'
      ? normalizeSpec({
          ...base,
          shape: 'superellipse',
          exponent: Number(usableExponent.toFixed(3)),
          padding: Number(padding.toFixed(2)),
          customPath: '',
        })
      : normalizeSpec({
          ...base,
          shape: 'custom-path',
          customPath: contourToPathData(contour),
          padding: Number(padding.toFixed(2)),
        });

  return {
    spec,
    maxDeviation: deviation.max,
    rmsDeviation: deviation.rms,
    deviationPercent: (deviation.max / shortEdge) * 100,
    exponent: usableExponent,
    asymmetry,
    mode,
  };
}
