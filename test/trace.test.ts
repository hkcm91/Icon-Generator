import { describe, expect, it } from 'vitest';
import {
  contourToPathData,
  radialContour,
  symmetrizeContour,
  traceMaster,
} from '../src/core/trace';
import { boundingBox, contourPoints, subPixelBox, toMask, type RGBAImage } from '../src/core/measure';
import { DEFAULT_SPEC, normalizeSpec } from '../src/core/spec';

const SUPERSAMPLE = 4;

function rasterize(size: number, inside: (x: number, y: number) => boolean): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          if (inside(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE)) hits++;
        }
      }
      const at = (py * size + px) * 4;
      data[at] = data[at + 1] = data[at + 2] = 255;
      data[at + 3] = Math.round((hits / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
    }
  }
  return { data, width: size, height: size };
}

const superellipse = (size: number, edge: number, exponent: number) => {
  const a = edge / 2;
  const c = size / 2;
  return rasterize(size, (x, y) =>
    Math.pow(Math.abs(x - c) / a, exponent) + Math.pow(Math.abs(y - c) / a, exponent) <= 1,
  );
};

/** A superellipse with one corner pulled in — a deliberately lopsided master. */
const lopsided = (size: number, edge: number, exponent: number, squash: number) => {
  const a = edge / 2;
  const c = size / 2;
  return rasterize(size, (x, y) => {
    const dx = (x - c) / a;
    const dy = (y - c) / a;
    // Tighten only the top-left quadrant.
    const k = dx < 0 && dy < 0 ? squash : 1;
    return Math.pow(Math.abs(dx) / k, exponent) + Math.pow(Math.abs(dy) / k, exponent) <= 1;
  });
};

const boxOf = (image: RGBAImage) => {
  const mask = toMask(image);
  return { mask, box: subPixelBox(contourPoints(mask, boundingBox(mask))) };
};

describe('radial contour tracing', () => {
  it('recovers the radius of a circle at every angle', () => {
    const { mask, box } = boxOf(superellipse(512, 400, 2));
    const points = radialContour(mask, box, 128);
    for (const point of points) {
      const radius = Math.hypot(point.x - box.cx, point.y - box.cy);
      expect(radius).toBeGreaterThan(198.5);
      expect(radius).toBeLessThan(201.5);
    }
  });

  it('returns an ordered ring of the requested length', () => {
    const { mask, box } = boxOf(superellipse(400, 300, 5));
    expect(radialContour(mask, box, 64)).toHaveLength(64);
  });

  it('traces the outer silhouette, ignoring a hole in the middle', () => {
    // Container with a punched-out centre, like a glyph knocked through it.
    const size = 400;
    const image = rasterize(size, (x, y) => {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const outer = Math.pow(Math.abs(dx) / 150, 5) + Math.pow(Math.abs(dy) / 150, 5) <= 1;
      const hole = Math.hypot(dx, dy) < 40;
      return outer && !hole;
    });
    const mask = toMask(image);
    const box = subPixelBox(contourPoints(mask, boundingBox(mask)));
    for (const point of radialContour(mask, box, 64)) {
      // Every traced point must be on the outer shell, not the hole rim.
      expect(Math.hypot(point.x - box.cx, point.y - box.cy)).toBeGreaterThan(100);
    }
  });
});

describe('symmetrisation', () => {
  it('evens out a lopsided master', () => {
    const { mask, box } = boxOf(lopsided(512, 400, 5, 0.88));
    const traced = radialContour(mask, box, 128);
    const evened = symmetrizeContour(traced, box);

    const spread = (points: typeof traced) => {
      const radii = points.map((point) => Math.hypot(point.x - box.cx, point.y - box.cy));
      const n = radii.length;
      const half = n / 2;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const group = [i, (half - i + n) % n, (half + i) % n, (n - i) % n].map(
          (index) => radii[index],
        );
        worst = Math.max(worst, Math.max(...group) - Math.min(...group));
      }
      return worst;
    };

    expect(spread(traced)).toBeGreaterThan(5);
    expect(spread(evened)).toBeLessThan(0.001);
  });

  it('leaves an already-symmetric shape essentially untouched', () => {
    const { mask, box } = boxOf(superellipse(512, 400, 5));
    const traced = radialContour(mask, box, 128);
    const evened = symmetrizeContour(traced, box);
    for (let i = 0; i < traced.length; i++) {
      // With the mirror indices correct, a symmetric master moves only by
      // rasterisation noise. The four edge midpoints are additionally replaced
      // by their neighbour mean, which on a symmetric shape is the same value.
      expect(Math.hypot(evened[i].x - traced[i].x, evened[i].y - traced[i].y)).toBeLessThan(0.15);
    }
  });
});

describe('contour to path data', () => {
  it('normalises into the 0-1000 viewBox that custom-path specs use', () => {
    const { mask, box } = boxOf(superellipse(512, 400, 5));
    const path = contourToPathData(radialContour(mask, box, 64));
    const numbers = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    expect(Math.min(...numbers)).toBeGreaterThan(-2);
    expect(Math.max(...numbers)).toBeLessThan(1002);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('is deterministic', () => {
    const { mask, box } = boxOf(superellipse(512, 400, 4));
    const once = contourToPathData(radialContour(mask, box, 64));
    const twice = contourToPathData(radialContour(mask, box, 64));
    expect(once).toBe(twice);
  });
});

describe('traceMaster', () => {
  const base = normalizeSpec(DEFAULT_SPEC);

  it('recovers the exponent of a clean master in parametric mode', () => {
    const result = traceMaster(superellipse(512, 400, 5), 'parametric', base);
    expect(result.spec.shape).toBe('superellipse');
    expect(result.exponent).toBeGreaterThan(4.9);
    expect(result.exponent).toBeLessThan(5.1);
  });

  it('reports near-zero deviation for a master that really is a superellipse', () => {
    const result = traceMaster(superellipse(512, 400, 5), 'parametric', base);
    expect(result.deviationPercent).toBeLessThan(0.5);
  });

  it('reports real deviation and asymmetry for a lopsided master', () => {
    const result = traceMaster(lopsided(512, 400, 5, 0.88), 'parametric', base);
    expect(result.maxDeviation).toBeGreaterThan(3);
    expect(result.asymmetry).toBeGreaterThan(3);
  });

  it('leaves no spike at the edge midpoints of an asymmetric master', () => {
    const image = lopsided(512, 400, 5, 0.88);
    const { mask, box } = boxOf(image);
    const evened = symmetrizeContour(radialContour(mask, box, 256), box);
    const radii = evened.map((point) => Math.hypot(point.x - box.cx, point.y - box.cy));

    // Indices 0, n/4, n/2, 3n/4 are the degenerate fixed points of the mirror
    // group and used to sit ~6px inside their neighbours.
    for (const fixedPoint of [0, 64, 128, 192]) {
      const neighbours = (radii[(fixedPoint - 1 + 256) % 256] + radii[(fixedPoint + 1) % 256]) / 2;
      expect(Math.abs(radii[fixedPoint] - neighbours)).toBeLessThan(0.2);
    }
  });

  it('emits a custom-path spec in symmetric and exact modes', () => {
    for (const mode of ['symmetric', 'exact'] as const) {
      const result = traceMaster(lopsided(512, 400, 5, 0.88), mode, base);
      expect(result.spec.shape).toBe('custom-path');
      expect(result.spec.customPath.length).toBeGreaterThan(50);
    }
  });

  it('keeps asymmetry in exact mode and removes it in symmetric mode', () => {
    const image = lopsided(512, 400, 5, 0.88);
    const exact = traceMaster(image, 'exact', base);
    const symmetric = traceMaster(image, 'symmetric', base);
    expect(exact.spec.customPath).not.toBe(symmetric.spec.customPath);
  });

  it('inherits the master optical padding', () => {
    // 400px silhouette in a 512px frame -> (512-400)/2/512 = 10.94%
    const result = traceMaster(superellipse(512, 400, 5), 'parametric', base);
    expect(result.spec.padding).toBeGreaterThan(10);
    expect(result.spec.padding).toBeLessThan(12);
  });

  it('produces a spec that round-trips through normalisation unchanged', () => {
    const result = traceMaster(superellipse(512, 400, 5), 'symmetric', base);
    expect(normalizeSpec(result.spec)).toEqual(result.spec);
  });
});
