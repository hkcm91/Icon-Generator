import { describe, expect, it } from 'vitest';
import {
  containerPath,
  effectiveCornerRadius,
  glyphSafePath,
  innerBox,
} from '../src/core/geometry';
import { DEFAULT_SPEC, normalizeSpec, serializeSpec, type ContainerSpec } from '../src/core/spec';
import { hashString } from '../src/core/hash';

const spec = (overrides: Partial<ContainerSpec> = {}) =>
  normalizeSpec({ ...DEFAULT_SPEC, ...overrides });

/** Pull every coordinate pair out of a path for geometric assertions. */
function points(path: string): Array<[number, number]> {
  const numbers = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push([numbers[i], numbers[i + 1]]);
  return out;
}

describe('determinism', () => {
  it('produces a byte-identical path across many renders of one spec', () => {
    const subject = spec({ shape: 'superellipse', exponent: 5, size: 1024 });
    const first = containerPath(subject);
    for (let i = 0; i < 500; i++) {
      expect(containerPath(spec({ shape: 'superellipse', exponent: 5, size: 1024 }))).toBe(first);
    }
  });

  it('gives the same path for every exponent across repeat runs', () => {
    for (let n = 2; n <= 20; n += 0.5) {
      const a = containerPath(spec({ shape: 'superellipse', exponent: n }));
      const b = containerPath(spec({ shape: 'superellipse', exponent: n }));
      expect(a).toBe(b);
      expect(a).not.toContain('NaN');
    }
  });

  it('changes the path when, and only when, the spec changes', () => {
    const base = containerPath(spec({ exponent: 5 }));
    expect(containerPath(spec({ exponent: 5.0 }))).toBe(base);
    expect(containerPath(spec({ exponent: 5.1 }))).not.toBe(base);
  });

  it('hashes a serialized spec stably regardless of key order in the input', () => {
    const a = serializeSpec(normalizeSpec({ size: 512, shape: 'superellipse', exponent: 4 } as never));
    const b = serializeSpec(normalizeSpec({ exponent: 4, shape: 'superellipse', size: 512 } as never));
    expect(hashString(a)).toBe(hashString(b));
  });

  it('never emits a signed zero, which would break string equality', () => {
    expect(containerPath(spec({ padding: 0, shape: 'rounded-rect', radius: 0 }))).not.toContain('-0 ');
  });
});

describe('rounded-rect geometry is exact', () => {
  it('honours the requested radius to the pixel', () => {
    const subject = spec({ shape: 'rounded-rect', radius: 25, size: 1000, padding: 0 });
    // 25% of a 1000px edge is 250px, regardless of anything a model might do.
    expect(effectiveCornerRadius(subject)).toBeCloseTo(250, 6);
  });

  it('clamps a 50% radius to a circle rather than overshooting', () => {
    const subject = spec({ shape: 'rounded-rect', radius: 50, size: 800, padding: 0 });
    expect(effectiveCornerRadius(subject)).toBeCloseTo(400, 6);
  });

  it('scales the radius with padding, keeping the shape proportional', () => {
    const padded = spec({ shape: 'rounded-rect', radius: 20, size: 1000, padding: 10 });
    expect(innerBox(padded).edge).toBeCloseTo(800, 6);
    expect(effectiveCornerRadius(padded)).toBeCloseTo(160, 6);
  });
});

describe('superellipse geometry', () => {
  it('stays inside the inner box for every exponent', () => {
    for (const exponent of [2, 3, 4, 5, 8, 12, 20]) {
      const subject = spec({ shape: 'superellipse', exponent, size: 1000, padding: 5 });
      const box = innerBox(subject);
      for (const [x, y] of points(containerPath(subject))) {
        // Control points of a Bezier fit can sit marginally outside the hull.
        // Measured worst case is 0.52px on a 900px shape (0.058%, at n=20);
        // the tolerance is set just above that so a regression in the sampler
        // fails here rather than quietly widening the silhouette.
        const TOLERANCE = 0.75;
        expect(x).toBeGreaterThanOrEqual(box.x - TOLERANCE);
        expect(x).toBeLessThanOrEqual(box.x + box.edge + TOLERANCE);
        expect(y).toBeGreaterThanOrEqual(box.y - TOLERANCE);
        expect(y).toBeLessThanOrEqual(box.y + box.edge + TOLERANCE);
      }
    }
  });

  it('reaches the edge midpoints, so the shape fills its box', () => {
    const subject = spec({ shape: 'superellipse', exponent: 5, size: 1000, padding: 0, segments: 128 });
    const all = points(containerPath(subject));
    const maxX = Math.max(...all.map(([x]) => x));
    const minX = Math.min(...all.map(([x]) => x));
    expect(maxX).toBeGreaterThan(995);
    expect(minX).toBeLessThan(5);
  });

  it('gets squarer as the exponent rises', () => {
    const radii = [2, 4, 5, 8, 12].map((exponent) =>
      effectiveCornerRadius(spec({ shape: 'superellipse', exponent, size: 1000, padding: 0 })),
    );
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeLessThan(radii[i - 1]);
    }
  });

  it('degenerates to a circle at exponent 2', () => {
    const subject = spec({ shape: 'superellipse', exponent: 2, size: 1000, padding: 0 });
    expect(effectiveCornerRadius(subject)).toBeCloseTo(500, 0);
  });
});

describe('glyph safe area', () => {
  it('is strictly inside the container and shares its shape', () => {
    const subject = spec({ glyphInset: 20, shape: 'superellipse', exponent: 5 });
    const outer = points(containerPath(subject));
    const inner = points(glyphSafePath(subject));
    const spread = (list: Array<[number, number]>) =>
      Math.max(...list.map(([x]) => x)) - Math.min(...list.map(([x]) => x));
    expect(spread(inner)).toBeLessThan(spread(outer));
    // Same segment count means the contour is similar, not merely smaller.
    expect(inner.length).toBe(outer.length);
  });

  it('collapses to the container when the inset is zero', () => {
    const subject = spec({ glyphInset: 0 });
    expect(glyphSafePath(subject)).toBe(containerPath(subject));
  });
});

describe('spec normalization', () => {
  it('is idempotent', () => {
    const once = normalizeSpec({ size: 777, exponent: 99, padding: -5, radius: 900 });
    expect(normalizeSpec(once)).toEqual(once);
  });

  it('clamps out-of-range values instead of throwing', () => {
    const subject = normalizeSpec({ exponent: 999, padding: -20, radius: 400, glyphInset: 99 });
    expect(subject.exponent).toBe(20);
    expect(subject.padding).toBe(0);
    expect(subject.radius).toBe(50);
    expect(subject.glyphInset).toBe(40);
  });

  it('forces an even canvas so the centre never lands on a half pixel', () => {
    expect(normalizeSpec({ size: 777 }).size % 2).toBe(0);
  });

  it('falls back to the default shape for unknown input', () => {
    expect(normalizeSpec({ shape: 'blob' as never }).shape).toBe(DEFAULT_SPEC.shape);
  });
});
