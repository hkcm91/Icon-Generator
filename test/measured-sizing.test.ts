import { describe, expect, it } from 'vitest';
import { measureAlpha, solveMeasuredSize } from '../src/core/measuredSizing';

describe('measured icon sizing', () => {
  const shape = { x: 0, y: 0, width: 200, height: 100, mass: 10000 };
  it('matches an exact edge without changing aspect ratio', () => {
    const result = solveMeasuredSize(shape, 1024, 600, 'longest', 50, 10)!;
    expect(result.width).toBe(512);
    expect(result.height).toBe(256);
    expect(result.scale * 600).toBe(512);
    expect(result.limited).toBe(false);
  });
  it('uses square-root scaling for weighted alpha area', () => {
    const result = solveMeasuredSize(shape, 1000, 600, 'coverage', 16, 10)!;
    expect(result.coverage).toBeCloseTo(16);
    expect(result.width).toBe(800);
  });
  it('limits tall or wide shapes to the margin rather than stretching or clipping', () => {
    const result = solveMeasuredSize(shape, 1000, 600, 'height', 60, 10)!;
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.limited).toBe(true);
  });
  it('counts faint alpha in bounds and fractional alpha in mass', () => {
    const data = new Uint8ClampedArray(16);
    data[3] = 255; data[15] = 1;
    expect(measureAlpha(data, 2, 2)).toEqual({ x: 0, y: 0, width: 2, height: 2, mass: 1 + 1 / 255 });
    expect(measureAlpha(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
  it('rejects invalid input and an impossible safe margin', () => {
    expect(solveMeasuredSize(shape, 1000, 0, 'width', 50, 10)).toBeNull();
    expect(solveMeasuredSize(shape, 1000, 600, 'width', NaN, 10)).toBeNull();
    expect(solveMeasuredSize(shape, 1000, 4000, 'width', 50, 10)).toBeNull();
  });
});
