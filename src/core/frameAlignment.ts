export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundsTransform {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

/** Estimate visual weight from alpha coverage, with conservative adjustment limits. */
export function opticalScaleForAlpha(data: Uint8ClampedArray, width: number, height: number): number {
  const bounds = alphaBounds(data, width, height, 24);
  if (!bounds) return 1;
  let mass = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 24) mass += data[i] / 255;
  const density = mass / Math.max(bounds.width, bounds.height) ** 2;
  return Math.round(Math.min(1.15, Math.max(0.85, Math.sqrt(0.65 / density))) * 100) / 100;
}

/** Review only underweight rendered icons; preserve a 10% exterior margin. */
export function outlierScaleForAlpha(data: Uint8ClampedArray, width: number, height: number, currentScale: number, targetCoverage: number) {
  let mass = 0;
  for (let i = 3; i < data.length; i += 4) mass += data[i] / 255;
  const coverage = mass / (width * height);
  const bounds = alphaBounds(data, width, height, 1);
  if (!bounds || coverage >= 0.18 || coverage <= 0) return null;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const room = Math.min(
    2 * Math.min(cx - width * .1, width * .9 - cx) / bounds.width,
    2 * Math.min(cy - height * .1, height * .9 - cy) / bounds.height,
  );
  const desired = Math.sqrt(targetCoverage / coverage);
  const ratio = Math.max(1, Math.min(desired, room));
  const scale = Math.max(currentScale, Math.floor(currentScale * ratio * 100) / 100);
  return { scale, coverage, limited: room < desired, targetCoverage };
}

/** Measure visible pixels while ignoring extremely faint alpha noise. */
export function alphaBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24,
): PixelBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX || maxY < minY
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Measure the substantial visible envelope of a complete icon.
 *
 * Image models sometimes leave a bright stray pixel or a very faint shadow
 * near the canvas edge. A normal min/max alpha bound treats that fringe as
 * part of the container and therefore fails to enlarge an otherwise smaller
 * result. Requiring a little alpha mass on each row/column keeps translucent
 * glass edges while ignoring isolated noise.
 */
export function substantialAlphaBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24,
  minAxisMassRatio = 0.015,
): PixelBounds | null {
  const rowMass = new Float64Array(height);
  const columnMass = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < threshold) continue;
      const mass = alpha / 255;
      rowMass[y] += mass;
      columnMass[x] += mass;
    }
  }

  const minimumRowMass = Math.max(2, width * minAxisMassRatio);
  const minimumColumnMass = Math.max(2, height * minAxisMassRatio);
  const minX = columnMass.findIndex((mass) => mass >= minimumColumnMass);
  const minY = rowMass.findIndex((mass) => mass >= minimumRowMass);
  let maxX = -1;
  let maxY = -1;
  for (let x = width - 1; x >= 0; x--) {
    if (columnMass[x] >= minimumColumnMass) {
      maxX = x;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowMass[y] >= minimumRowMass) {
      maxY = y;
      break;
    }
  }

  return minX < 0 || minY < 0 || maxX < minX || maxY < minY
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Map one visible envelope exactly onto another without cropping pixels. */
export function boundsTransform(source: PixelBounds, reference: PixelBounds): BoundsTransform {
  const scaleX = reference.width / Math.max(1, source.width);
  const scaleY = reference.height / Math.max(1, source.height);
  return {
    scaleX,
    scaleY,
    translateX: reference.x - source.x * scaleX,
    translateY: reference.y - source.y * scaleY,
  };
}

/** Uniformly fit one visible envelope into another without stretching it. */
export function boundsContainTransform(source: PixelBounds, reference: PixelBounds): BoundsTransform {
  const scale = Math.min(
    reference.width / Math.max(1, source.width),
    reference.height / Math.max(1, source.height),
  );
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = reference.x + reference.width / 2;
  const targetCenterY = reference.y + reference.height / 2;
  return {
    scaleX: scale,
    scaleY: scale,
    translateX: targetCenterX - sourceCenterX * scale,
    translateY: targetCenterY - sourceCenterY * scale,
  };
}
