export interface OpenFrameInspection {
  centralCoverage: number;
  largestCentralComponent: number;
  subjectLikely: boolean;
}

/**
 * Detect a large residual subject without confusing small detached bubbles for
 * content. A valid open frame may contain particles, but it should not occupy
 * most of the central safe area or contain one large centre-bound component.
 */
export function inspectOpenFramePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): OpenFrameInspection {
  const total = Math.max(1, width * height);
  const x0 = Math.floor(width * 0.28);
  const x1 = Math.ceil(width * 0.72);
  const y0 = Math.floor(height * 0.28);
  const y1 = Math.ceil(height * 0.72);
  let centralPixels = 0;
  let centralAlpha = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      centralPixels++;
      if (data[(y * width + x) * 4 + 3] >= 32) centralAlpha++;
    }
  }

  const visited = new Uint8Array(total);
  let largestCentral = 0;
  const stack: number[] = [];
  for (let start = 0; start < total; start++) {
    if (visited[start] || data[start * 4 + 3] < 32) continue;
    visited[start] = 1;
    stack.push(start);
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (stack.length) {
      const at = stack.pop()!;
      const x = at % width;
      const y = Math.floor(at / width);
      area++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbours = [at - 1, at + 1, at - width, at + width];
      for (const next of neighbours) {
        if (next < 0 || next >= total || visited[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1 || data[next * 4 + 3] < 32) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    const reachesFrame = minX < width * 0.2 || maxX > width * 0.8 || minY < height * 0.2 || maxY > height * 0.8;
    const centered = centreX > width * 0.3 && centreX < width * 0.7 && centreY > height * 0.3 && centreY < height * 0.7;
    if (!reachesFrame && centered) largestCentral = Math.max(largestCentral, area);
  }

  const centralCoverage = centralAlpha / Math.max(1, centralPixels);
  const largestCentralComponent = largestCentral / total;
  return {
    centralCoverage,
    largestCentralComponent,
    subjectLikely: centralCoverage > 0.52 || largestCentralComponent > 0.055,
  };
}

export function inspectOpenFrame(image: CanvasImageSource, size = 512): OpenFrameInspection {
  const sampleSize = Math.min(320, Math.max(64, size));
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser did not provide a 2D canvas context.');
  context.drawImage(image, 0, 0, sampleSize, sampleSize);
  return inspectOpenFramePixels(context.getImageData(0, 0, sampleSize, sampleSize).data, sampleSize, sampleSize);
}
