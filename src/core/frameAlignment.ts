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
