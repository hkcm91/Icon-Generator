import { describe, expect, it } from 'vitest';
import { inspectOpenFramePixels } from '../src/core/frameValidation';

function pixels(size: number, paint: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (paint(x, y)) data[(y * size + x) * 4 + 3] = 255;
    }
  }
  return data;
}

describe('open-frame validation', () => {
  it('accepts a transparent center surrounded by a frame', () => {
    const size = 100;
    const result = inspectOpenFramePixels(pixels(size, (x, y) => x < 12 || x > 87 || y < 12 || y > 87), size, size);
    expect(result.subjectLikely).toBe(false);
  });

  it('rejects one large detached central subject', () => {
    const size = 100;
    const result = inspectOpenFramePixels(pixels(size, (x, y) => {
      const frame = x < 10 || x > 89 || y < 10 || y > 89;
      const ghost = Math.hypot(x - 50, y - 50) < 20;
      return frame || ghost;
    }), size, size);
    expect(result.largestCentralComponent).toBeGreaterThan(0.055);
    expect(result.subjectLikely).toBe(true);
  });

  it('allows small detached decorative bubbles', () => {
    const size = 100;
    const result = inspectOpenFramePixels(pixels(size, (x, y) => {
      const frame = x < 10 || x > 89 || y < 10 || y > 89;
      const bubble = Math.hypot(x - 45, y - 42) < 4 || Math.hypot(x - 58, y - 60) < 3;
      return frame || bubble;
    }), size, size);
    expect(result.subjectLikely).toBe(false);
  });

  it('allows decorative frame details to extend inward from the perimeter', () => {
    const size = 100;
    const result = inspectOpenFramePixels(pixels(size, (x, y) => {
      const frame = x < 10 || x > 89 || y < 10 || y > 89;
      const inwardGlassSweep = x >= 8 && x < 48 && y >= 36 && y < 45;
      return frame || inwardGlassSweep;
    }), size, size);
    expect(result.subjectLikely).toBe(false);
  });
});
