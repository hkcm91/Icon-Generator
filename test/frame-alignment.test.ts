import { describe, expect, it } from 'vitest';
import { alphaBounds, boundsContainTransform, boundsTransform, substantialAlphaBounds } from '../src/core/frameAlignment';

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

  it('ignores isolated fringe pixels when measuring a complete icon', () => {
    const size = 12;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 3; y <= 8; y++) {
      for (let x = 3; x <= 8; x++) data[(y * size + x) * 4 + 3] = 255;
    }
    data[0 * 4 + 3] = 255;
    data[((size - 1) * size + size - 1) * 4 + 3] = 255;

    expect(alphaBounds(data, size, size)).toEqual({ x: 0, y: 0, width: 12, height: 12 });
    expect(substantialAlphaBounds(data, size, size)).toEqual({ x: 3, y: 3, width: 6, height: 6 });
  });

  it('retains a translucent glass edge when it has meaningful coverage', () => {
    const size = 20;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 2; y <= 17; y++) {
      for (let x = 2; x <= 17; x++) {
        if (x === 2 || x === 17 || y === 2 || y === 17) data[(y * size + x) * 4 + 3] = 64;
      }
    }
    expect(substantialAlphaBounds(data, size, size)).toEqual({ x: 2, y: 2, width: 16, height: 16 });
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

  it('fits generated visible bounds to the family box without stretching', () => {
    const transform = boundsContainTransform(
      { x: 20, y: 40, width: 80, height: 40 },
      { x: 10, y: 10, width: 100, height: 100 },
    );
    expect(transform.scaleX).toBe(transform.scaleY);
    expect(transform.scaleX).toBeCloseTo(1.25);
    expect(20 * transform.scaleX + transform.translateX).toBeCloseTo(10);
    expect(40 * transform.scaleY + transform.translateY).toBeCloseTo(35);
  });
});
