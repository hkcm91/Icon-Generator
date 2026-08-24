/**
 * Measure the geometry a raster icon actually has.
 *
 * The point of this module is to turn "the radius looks slightly different
 * every time" into a number. Given a batch of previously generated container
 * PNGs it reports, per file, the effective corner radius and the superellipse
 * exponent that best describes the silhouette — and across the batch, how far
 * apart those came out.
 *
 * Everything here works on a plain ImageData-shaped object rather than a real
 * canvas, so it runs in Node and can be round-trip tested against synthetic
 * shapes with a known radius.
 */

export interface RGBAImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Mask {
  width: number;
  height: number;
  /** Coverage per pixel, 0-255. Kept as a ramp so edges can be sub-pixel. */
  coverage: Uint8Array;
  /** True when coverage came from keying a flat background, not from alpha. */
  keyed: boolean;
}

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface CornerReading {
  corner: 'tl' | 'tr' | 'br' | 'bl';
  /** Distance from the bounding-box corner to the contour along the diagonal. */
  gap: number;
  /** Corner radius implied by that gap, in px. */
  radius: number;
}

export interface Measurement {
  /** Silhouette bounds inside the source image. */
  box: BoundingBox;
  /** Per-corner radii, in px. */
  corners: CornerReading[];
  /** Mean of the four corner radii, in px. */
  radius: number;
  /** Max - min across the four corners: asymmetry within this one image. */
  cornerSpread: number;
  /** Radius as a percentage of the silhouette's shorter edge. */
  radiusPercent: number;
  /** Best-fit superellipse exponent for the silhouette. */
  exponent: number;
  /** Mean |u^n + v^n - 1| at the fitted exponent. Low = genuinely a superellipse. */
  exponentResidual: number;
  /** Least-squares circular arc through the corner region. */
  circleRadius: number;
  /** RMS error of that circle fit, in px. High = continuous curvature, not an arc. */
  circleResidual: number;
  /** Optical margin implied by the silhouette, as a percentage of the canvas. */
  padding: number;
  /** height/width of the silhouette. 1 = square. */
  aspect: number;
  keyed: boolean;
}

const ALPHA_THRESHOLD = 128;

/**
 * Build a coverage mask.
 *
 * Prefers the alpha channel. When the image is fully opaque — which is what
 * most models return regardless of what the prompt asked for — falls back to
 * keying out the flat background sampled at the four corners.
 */
export function toMask(image: RGBAImage, tolerance = 32): Mask {
  const { data, width, height } = image;
  const count = width * height;
  const coverage = new Uint8Array(count);

  const cornerIndexes = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  const hasAlpha = cornerIndexes.some((index) => data[index + 3] < ALPHA_THRESHOLD);

  if (hasAlpha) {
    for (let i = 0; i < count; i++) coverage[i] = data[i * 4 + 3];
    return { width, height, coverage, keyed: false };
  }

  let r = 0;
  let g = 0;
  let b = 0;
  for (const index of cornerIndexes) {
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
  }
  r /= cornerIndexes.length;
  g /= cornerIndexes.length;
  b /= cornerIndexes.length;

  for (let i = 0; i < count; i++) {
    const at = i * 4;
    const distance = Math.hypot(data[at] - r, data[at + 1] - g, data[at + 2] - b);
    // Ramp between tolerance and 2x tolerance so the mask edge stays sub-pixel
    // rather than becoming a hard staircase that biases the fits.
    const value =
      distance <= tolerance
        ? 0
        : distance >= tolerance * 2
          ? 255
          : Math.round(((distance - tolerance) / tolerance) * 255);
    coverage[i] = value;
  }

  return { width, height, coverage, keyed: true };
}

export function boundingBox(mask: Mask): BoundingBox {
  const { width, height, coverage } = mask;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (coverage[y * width + x] >= ALPHA_THRESHOLD) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 < x0 || y1 < y0) {
    throw new Error('No opaque pixels found — the image looks empty.');
  }

  return {
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
  };
}

/** Where the coverage ramp crosses the threshold between two samples. */
function subPixelCrossing(previous: number, current: number): number {
  const span = current - previous;
  if (span === 0) return 0;
  return Math.min(1, Math.max(0, (ALPHA_THRESHOLD - previous) / span));
}

/**
 * Bilinear coverage sample at a continuous position.
 *
 * Coverage values live at pixel *centres* — pixel (px, py) is sampled at
 * (px + 0.5, py + 0.5) — so the lookup shifts by half a pixel before
 * interpolating. Getting this wrong biases every measurement below by a
 * consistent half pixel, which is exactly the kind of error a tool built to
 * quantify sub-pixel drift cannot afford.
 */
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
 * Trace the silhouette as sub-pixel contour points, two per scanline.
 * Scanlines suffice because these shapes are convex, so the left and right
 * extremes of each row describe the contour completely.
 */
export function contourPoints(mask: Mask, box: BoundingBox): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];

  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * mask.width;

    let left = Number.NaN;
    let previous = 0;
    for (let x = box.x0; x <= box.x1; x++) {
      const value = mask.coverage[row + x];
      if (value >= ALPHA_THRESHOLD) {
        // Crossing sits between the centres of pixels x-1 and x.
        left = x - 0.5 + subPixelCrossing(previous, value);
        break;
      }
      previous = value;
    }
    if (!Number.isFinite(left)) continue;

    let right = Number.NaN;
    previous = 0;
    for (let x = box.x1; x >= box.x0; x--) {
      const value = mask.coverage[row + x];
      if (value >= ALPHA_THRESHOLD) {
        right = x + 1.5 - subPixelCrossing(previous, value);
        break;
      }
      previous = value;
    }

    // Pixel row y is centred at y + 0.5 in continuous coordinates.
    points.push({ x: left, y: y + 0.5 });
    if (Number.isFinite(right) && right > left) points.push({ x: right, y: y + 0.5 });
  }

  return points;
}

/**
 * Continuous bounds derived from the sub-pixel contour rather than from whole
 * pixels. Every fit and every corner reading works from this, so a half-pixel
 * quantisation never reaches the reported numbers.
 */
export function subPixelBox(points: Array<{ x: number; y: number }>): BoundingBox {
  if (!points.length) throw new Error('No contour points — the image looks empty.');

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const point of points) {
    if (point.x < x0) x0 = point.x;
    if (point.x > x1) x1 = point.x;
    if (point.y < y0) y0 = point.y;
    if (point.y > y1) y1 = point.y;
  }

  // Scanlines sample row centres, so the vertical extent is short by half a
  // pixel at each end compared with the horizontal one. Extend it to match.
  y0 -= 0.5;
  y1 += 0.5;

  return {
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0,
    height: y1 - y0,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
  };
}

/**
 * Walk inward from a bounding-box corner along the 45-degree diagonal until the
 * contour is crossed.
 *
 * For a circular-arc corner of radius r the contour sits at r(sqrt2 - 1) from
 * the box corner along that diagonal, so the gap inverts directly to a radius.
 * That is the same definition `effectiveCornerRadius` applies to a spec, which
 * is what makes a measured value and a specified value directly comparable.
 *
 * Stepping is sub-pixel: consecutive whole-pixel samples along a diagonal are
 * sqrt2 apart, wider than the ~1px antialiasing band, so an integer walk can
 * step straight over the ramp and quantise the result.
 */
const DIAGONAL_STEP = 0.2;

function diagonalGap(mask: Mask, box: BoundingBox, dx: number, dy: number): number {
  const startX = dx > 0 ? box.x0 : box.x1;
  const startY = dy > 0 ? box.y0 : box.y1;
  const limit = Math.min(box.width, box.height);
  const ux = dx / Math.SQRT2;
  const uy = dy / Math.SQRT2;

  let previousValue = sampleCoverage(mask, startX, startY);
  if (previousValue >= ALPHA_THRESHOLD) return 0;

  for (let distance = DIAGONAL_STEP; distance < limit; distance += DIAGONAL_STEP) {
    const value = sampleCoverage(mask, startX + ux * distance, startY + uy * distance);
    if (value >= ALPHA_THRESHOLD) {
      const frac = subPixelCrossing(previousValue, value);
      return distance - DIAGONAL_STEP * (1 - frac);
    }
    previousValue = value;
  }
  return 0;
}

export function cornerReadings(mask: Mask, box: BoundingBox): CornerReading[] {
  const directions: Array<{ corner: CornerReading['corner']; dx: number; dy: number }> = [
    { corner: 'tl', dx: 1, dy: 1 },
    { corner: 'tr', dx: -1, dy: 1 },
    { corner: 'br', dx: -1, dy: -1 },
    { corner: 'bl', dx: 1, dy: -1 },
  ];

  return directions.map(({ corner, dx, dy }) => {
    const gap = Math.max(0, diagonalGap(mask, box, dx, dy));
    return { corner, gap, radius: gap / (Math.SQRT2 - 1) };
  });
}

/**
 * Fit the superellipse exponent n in |x/a|^n + |y/b|^n = 1.
 *
 * Solved per point by bisection — f(n) = u^n + v^n - 1 is monotonically
 * decreasing in n whenever u and v are both below 1 — then reduced by median so
 * that a handful of bad contour rows cannot drag the answer.
 *
 * Points too close to either axis carry almost no information about the
 * exponent (u^n + v^n is dominated by the larger term) and are excluded.
 */
export function fitExponent(
  points: Array<{ x: number; y: number }>,
  box: BoundingBox,
): { exponent: number; residual: number } {
  const a = box.width / 2;
  const b = box.height / 2;
  const estimates: number[] = [];

  for (const point of points) {
    const u = Math.abs(point.x - box.cx) / a;
    const v = Math.abs(point.y - box.cy) / b;
    if (u < 0.2 || v < 0.2 || u > 0.98 || v > 0.98) continue;

    let low = 1;
    let high = 40;
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      if (Math.pow(u, mid) + Math.pow(v, mid) - 1 > 0) low = mid;
      else high = mid;
    }
    estimates.push((low + high) / 2);
  }

  if (!estimates.length) return { exponent: Number.NaN, residual: Number.NaN };

  estimates.sort((p, q) => p - q);
  const exponent = estimates[Math.floor(estimates.length / 2)];

  let error = 0;
  let counted = 0;
  for (const point of points) {
    const u = Math.abs(point.x - box.cx) / a;
    const v = Math.abs(point.y - box.cy) / b;
    if (u < 0.2 || v < 0.2 || u > 0.98 || v > 0.98) continue;
    error += Math.abs(Math.pow(u, exponent) + Math.pow(v, exponent) - 1);
    counted++;
  }

  return { exponent, residual: counted ? error / counted : Number.NaN };
}

/**
 * Algebraic (Kasa) circle fit over the corner arcs.
 *
 * Reported alongside the superellipse fit as a discriminator: a true rounded
 * rectangle fits a circle with near-zero residual, while a squircle does not.
 * That distinction is the difference between "your container is a rounded rect
 * with radius r" and "your container has continuous curvature".
 */
export function fitCornerCircle(
  points: Array<{ x: number; y: number }>,
  box: BoundingBox,
): { radius: number; residual: number } {
  const a = box.width / 2;
  const b = box.height / 2;

  // Keep only points in the corner regions, mirrored into one quadrant so all
  // four corners contribute to a single fit.
  const corner: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const u = (point.x - box.cx) / a;
    const v = (point.y - box.cy) / b;
    if (Math.abs(u) < 0.45 || Math.abs(v) < 0.45) continue;
    corner.push({ x: Math.abs(point.x - box.cx), y: Math.abs(point.y - box.cy) });
  }
  if (corner.length < 8) return { radius: Number.NaN, residual: Number.NaN };

  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  const n = corner.length;

  for (const { x, y } of corner) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }

  const a11 = 2 * (sxx - (sx * sx) / n);
  const a12 = 2 * (sxy - (sx * sy) / n);
  const a22 = 2 * (syy - (sy * sy) / n);
  const b1 = sxz - (sx * sz) / n;
  const b2 = syz - (sy * sz) / n;

  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) < 1e-9) return { radius: Number.NaN, residual: Number.NaN };

  const cx = (b1 * a22 - b2 * a12) / determinant;
  const cy = (a11 * b2 - a12 * b1) / determinant;
  const radius = Math.sqrt(
    (sz - 2 * cx * sx - 2 * cy * sy) / n + cx * cx + cy * cy,
  );

  let squared = 0;
  for (const { x, y } of corner) {
    const delta = Math.hypot(x - cx, y - cy) - radius;
    squared += delta * delta;
  }

  return { radius, residual: Math.sqrt(squared / n) };
}

export function measureImage(image: RGBAImage, tolerance = 32): Measurement {
  const mask = toMask(image, tolerance);
  const pixelBox = boundingBox(mask);
  const points = contourPoints(mask, pixelBox);
  const box = subPixelBox(points);
  const corners = cornerReadings(mask, box);

  const radii = corners.map((entry) => entry.radius);
  const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const shortEdge = Math.min(box.width, box.height);

  const { exponent, residual } = fitExponent(points, box);
  const circle = fitCornerCircle(points, box);

  return {
    box,
    corners,
    radius,
    cornerSpread: Math.max(...radii) - Math.min(...radii),
    radiusPercent: (radius / shortEdge) * 100,
    exponent,
    exponentResidual: residual,
    circleRadius: circle.radius,
    circleResidual: circle.residual,
    padding: ((Math.min(image.width, image.height) - shortEdge) / 2 / Math.min(image.width, image.height)) * 100,
    aspect: box.height / box.width,
    keyed: mask.keyed,
  };
}

export interface BatchStats {
  count: number;
  radiusPercent: { mean: number; min: number; max: number; spread: number; stdev: number };
  exponent: { mean: number; min: number; max: number; spread: number; stdev: number };
}

const summarise = (values: number[]) => {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) {
    return { mean: Number.NaN, min: Number.NaN, max: Number.NaN, spread: Number.NaN, stdev: Number.NaN };
  }
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const variance =
    usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / usable.length;
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  return { mean, min, max, spread: max - min, stdev: Math.sqrt(variance) };
};

/** Across a batch: how much did the geometry actually move between runs. */
export function batchStats(measurements: Measurement[]): BatchStats {
  return {
    count: measurements.length,
    radiusPercent: summarise(measurements.map((entry) => entry.radiusPercent)),
    exponent: summarise(measurements.map((entry) => entry.exponent)),
  };
}
