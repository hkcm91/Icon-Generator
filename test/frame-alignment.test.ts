import { describe, expect, it } from 'vitest';
import { alphaBounds, boundsTransform } from '../src/core/frameAlignment';

describe('subject-removed master alignment', () => {
  it('measures the visible alpha envelope', () => {
    const data = new Uint8ClampedArray(6 * 5 * 4);
    for (let y = 1; y <= 3; y++) {
      for (let x = 2; x <= 4; x++) data[(y * 6 + x) * 4 + 3] = 255;
    }
    expect(alphaBounds(data, 6, 5)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
  });

  it('ignores a fully transparent canvas', () => {
    expect(alphaBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull();
  });

  it('maps the cleaned frame bounds exactly onto the original upload', () => {
    const source = { x: 40, y: 20, width: 900, height: 960 };
    const reference = { x: 88, y: 72, width: 820, height: 840 };
    const transform = boundsTransform(source, reference);
    expect(source.x * transform.scaleX + transform.translateX).toBeCloseTo(reference.x);
    expect(source.y * transform.scaleY + transform.translateY).toBeCloseTo(reference.y);
    expect(source.width * transform.scaleX).toBeCloseTo(reference.width);
    expect(source.height * transform.scaleY).toBeCloseTo(reference.height);
  });
});
