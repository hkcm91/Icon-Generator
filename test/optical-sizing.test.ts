import { describe, expect, it } from 'vitest';
import { opticalScaleForAlpha, outlierScaleForAlpha } from '../src/core/frameAlignment';

function rectangle(width: number, height: number, x: number, y: number, w: number, h: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data[(row * width + col) * 4 + 3] = 255;
  return data;
}
describe('optical size correction', () => {
  it('shrinks dense shapes and enlarges thin shapes with the same longest edge', () => {
    expect(opticalScaleForAlpha(rectangle(100, 100, 10, 10, 80, 80), 100, 100)).toBe(.85);
    expect(opticalScaleForAlpha(rectangle(100, 100, 10, 40, 80, 20), 100, 100)).toBe(1.15);
  });
  it('does not depend on transparent padding or source resolution', () => {
    const reference = opticalScaleForAlpha(rectangle(100, 100, 10, 10, 80, 60), 100, 100);
    expect(opticalScaleForAlpha(rectangle(300, 250, 110, 120, 80, 60), 300, 250)).toBe(reference);
    expect(opticalScaleForAlpha(rectangle(200, 200, 20, 20, 160, 120), 200, 200)).toBe(reference);
  });
  it('leaves empty images unchanged', () => {
    expect(opticalScaleForAlpha(new Uint8ClampedArray(400), 10, 10)).toBe(1);
  });
  it('leaves balanced icons out of the outlier plan', () => {
    expect(outlierScaleForAlpha(rectangle(100,100,25,25,50,50),100,100,1,.20)).toBeNull();
  });
  it('allows growth beyond 15% to match reference coverage', () => {
    const result = outlierScaleForAlpha(rectangle(100,100,30,30,40,40),100,100,1.15,.24)!;
    expect(result.scale).toBe(1.40);
    expect(result.limited).toBe(false);
    expect(result.coverage * (result.scale / 1.15) ** 2).toBeCloseTo(.24,2);
  });
  it('caps a thin icon at safe margins without stretching or clipping', () => {
    const result = outlierScaleForAlpha(rectangle(100,100,15,45,70,10),100,100,1,.20)!;
    expect(result.limited).toBe(true);
    expect(result.scale).toBe(1.14);
    expect(70 * result.scale).toBeLessThanOrEqual(80);
  });
  it('does not enlarge an off-center icon past the margin', () => {
    const result = outlierScaleForAlpha(rectangle(100,100,10,40,60,10),100,100,1,.20)!;
    expect(result.scale).toBe(1);
    expect(result.limited).toBe(true);
  });
});
