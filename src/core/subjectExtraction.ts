export interface SubjectExtractionMetrics {
  /** Portion of the full canvas occupied by pixels removed from the frame. */
  coverage: number;
  /** Portion of the central 60% occupied by removed pixels. */
  centralCoverage: number;
}

export interface SubjectExtractionPixels {
  pixels: Uint8ClampedArray;
  metrics: SubjectExtractionMetrics;
}

/**
 * Recover the uploaded subject from the alpha pixels removed by the frame edit.
 * RGB always comes from the unchanged upload; the AI-cleaned frame supplies
 * only the subtraction mask and can never repaint the saved subject.
 */
export function extractSubjectPixels(
  reference: Uint8ClampedArray,
  frame: Uint8ClampedArray,
  width: number,
  height: number,
): SubjectExtractionPixels {
  if (reference.length !== frame.length || reference.length !== width * height * 4) {
    throw new Error('The reference and frame must have matching pixel dimensions.');
  }
  const output = new Uint8ClampedArray(reference.length);
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.ceil(height * 0.8);
  let visible = 0;
  let centralVisible = 0;
  let centralTotal = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const removedAlpha = Math.max(0, reference[offset + 3] - frame[offset + 3]);
      output[offset] = reference[offset];
      output[offset + 1] = reference[offset + 1];
      output[offset + 2] = reference[offset + 2];
      output[offset + 3] = removedAlpha;
      if (removedAlpha >= 20) visible++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        centralTotal++;
        if (removedAlpha >= 20) centralVisible++;
      }
    }
  }

  return {
    pixels: output,
    metrics: {
      coverage: visible / Math.max(1, width * height),
      centralCoverage: centralVisible / Math.max(1, centralTotal),
    },
  };
}

export function extractSubjectLayer(
  reference: CanvasImageSource,
  frame: CanvasImageSource,
  size: number,
): { layer: HTMLCanvasElement; metrics: SubjectExtractionMetrics } {
  const referenceCanvas = document.createElement('canvas');
  referenceCanvas.width = size;
  referenceCanvas.height = size;
  const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true });
  if (!referenceContext) throw new Error('This browser did not provide a 2D canvas context.');
  referenceContext.drawImage(reference, 0, 0, size, size);

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = size;
  frameCanvas.height = size;
  const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
  if (!frameContext) throw new Error('This browser did not provide a 2D canvas context.');
  frameContext.drawImage(frame, 0, 0, size, size);

  const extracted = extractSubjectPixels(
    referenceContext.getImageData(0, 0, size, size).data,
    frameContext.getImageData(0, 0, size, size).data,
    size,
    size,
  );
  const layer = document.createElement('canvas');
  layer.width = size;
  layer.height = size;
  const layerContext = layer.getContext('2d');
  if (!layerContext) throw new Error('This browser did not provide a 2D canvas context.');
  const imageData = layerContext.createImageData(size, size);
  imageData.data.set(extracted.pixels);
  layerContext.putImageData(imageData, 0, 0);
  return { layer, metrics: extracted.metrics };
}
