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
