import { describe, expect, it } from 'vitest';
import { extractSubjectPixels } from '../src/core/subjectExtraction';

const pixels = (width: number, height: number) => new Uint8ClampedArray(width * height * 4);

describe('subject extraction from a cleaned frame', () => {
  it('keeps the unchanged upload RGB only where alpha was removed', () => {
    const reference = pixels(4, 4);
    const frame = pixels(4, 4);
    for (let index = 0; index < 16; index++) {
      reference[index * 4] = 120;
      reference[index * 4 + 1] = 80;
      reference[index * 4 + 2] = 240;
      reference[index * 4 + 3] = 255;
      frame[index * 4 + 3] = 255;
    }
    frame[(1 * 4 + 1) * 4 + 3] = 0;
    frame[(1 * 4 + 2) * 4 + 3] = 0;
    frame[(2 * 4 + 1) * 4 + 3] = 0;
    frame[(2 * 4 + 2) * 4 + 3] = 0;

    const result = extractSubjectPixels(reference, frame, 4, 4);
    expect(result.metrics.coverage).toBe(0.25);
    expect(result.metrics.centralCoverage).toBe(0.25);
    expect(Array.from(result.pixels.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)))
      .toEqual([120, 80, 240, 255]);
    expect(result.pixels[3]).toBe(0);
  });

  it('reports no extracted subject when the model returned the original alpha', () => {
    const reference = pixels(3, 3);
    for (let index = 0; index < 9; index++) reference[index * 4 + 3] = 255;
    const result = extractSubjectPixels(reference, reference.slice(), 3, 3);
    expect(result.metrics.coverage).toBe(0);
    expect(result.pixels.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
  });

  it('rejects mismatched image dimensions', () => {
    expect(() => extractSubjectPixels(pixels(2, 2), pixels(3, 3), 2, 2)).toThrow(/matching pixel dimensions/i);
  });
});
