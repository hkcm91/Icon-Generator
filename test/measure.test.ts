import { describe, expect, it } from 'vitest';
import { batchStats, measureImage, type RGBAImage } from '../src/core/measure';

/**
 * Analytic rasterisers. These deliberately avoid the app's own geometry code so
 * the estimator is validated against an independent definition of each shape
 * rather than against the thing it is meant to check.
 */
const SUPERSAMPLE = 4;

function rasterize(
  size: number,
  inside: (x: number, y: number) => boolean,
  opaqueBackground = false,
): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const y = py + (sy + 0.5) / SUPERSAMPLE;
          if (inside(x, y)) hits++;
        }
      }
      const coverage = hits / (SUPERSAMPLE * SUPERSAMPLE);
      const at = (py * size + px) * 4;

      if (opaqueBackground) {
        // White shape on a flat mid-grey field, fully opaque — the shape of
        // output most image models actually return.
        const value = Math.round(60 + coverage * 195);
        data[at] = data[at + 1] = data[at + 2] = value;
        data[at + 3] = 255;
      } else {
        data[at] = data[at + 1] = data[at + 2] = 255;
        data[at + 3] = Math.round(coverage * 255);
      }
    }
  }

  return { data, width: size, height: size };
}

function roundedRect(size: number, edge: number, radius: number, opaque = false): RGBAImage {
  const origin = (size - edge) / 2;
  const x1 = origin + edge;
  const y1 = origin + edge;
  return rasterize(
    size,
    (x, y) => {
      if (x < origin || x > x1 || y < origin || y > y1) return false;
      const dx = Math.max(origin + radius - x, 0, x - (x1 - radius));
      const dy = Math.max(origin + radius - y, 0, y - (y1 - radius));
      return Math.hypot(dx, dy) <= radius;
    },
    opaque,
  );
}

function superellipse(size: number, edge: number, exponent: number, opaque = false): RGBAImage {
  const a = edge / 2;
  const cx = size / 2;
  const cy = size / 2;
  return rasterize(
    size,
    (x, y) =>
      Math.pow(Math.abs(x - cx) / a, exponent) + Math.pow(Math.abs(y - cy) / a, exponent) <= 1,
    opaque,
  );
}

describe('corner radius estimation', () => {
  it('recovers a known radius from a rounded rectangle', () => {
    for (const radius of [40, 80, 120, 200]) {
      const measured = measureImage(roundedRect(512, 400, radius));
      // Bilinear sub-pixel sampling holds the worst measured error to 0.13px
      // across 20-200px radii; the tolerance sits just above that so a
      // regression in the sampler fails here instead of silently degrading.
      expect(measured.radius).toBeGreaterThan(radius - 0.3);
      expect(measured.radius).toBeLessThan(radius + 0.3);
    }
  });

  it('reports the radius as a percentage of the silhouette', () => {
    const measured = measureImage(roundedRect(512, 400, 100));
    expect(measured.radiusPercent).toBeGreaterThan(23);
    expect(measured.radiusPercent).toBeLessThan(27);
  });

  it('finds the silhouette bounds and implied padding', () => {
    const measured = measureImage(roundedRect(512, 400, 80));
    expect(measured.box.width).toBeGreaterThan(398);
    expect(measured.box.width).toBeLessThan(403);
    // (512 - 400) / 2 / 512 = 10.9%
    expect(measured.padding).toBeGreaterThan(10);
    expect(measured.padding).toBeLessThan(12);
    expect(measured.aspect).toBeCloseTo(1, 1);
  });

  it('reports a near-zero corner spread for a symmetric shape', () => {
    const measured = measureImage(roundedRect(512, 400, 100));
    expect(measured.cornerSpread).toBeLessThan(2);
  });
});

describe('superellipse exponent estimation', () => {
  it('recovers a known exponent', () => {
    for (const exponent of [2, 3, 4, 5, 8]) {
      const measured = measureImage(superellipse(600, 520, exponent));
      // Worst measured error across n = 2..10 is 0.03%.
      expect(measured.exponent).toBeGreaterThan(exponent * 0.99);
      expect(measured.exponent).toBeLessThan(exponent * 1.01);
    }
  });

  it('fits a superellipse tightly and a circle loosely on a squircle', () => {
    const measured = measureImage(superellipse(600, 520, 5));
    expect(measured.exponentResidual).toBeLessThan(0.02);
    // A continuous-curvature corner is not a circular arc, and the circle fit
    // should say so rather than quietly returning a plausible radius.
    expect(measured.circleResidual).toBeGreaterThan(1);
  });

  it('fits a circle tightly on an actual rounded rectangle', () => {
    const measured = measureImage(roundedRect(600, 520, 120));
    expect(measured.circleResidual).toBeLessThan(1);
    expect(measured.circleRadius).toBeGreaterThan(115);
    expect(measured.circleRadius).toBeLessThan(125);
  });
});

describe('opaque source images', () => {
  it('keys out a flat background and still measures correctly', () => {
    const measured = measureImage(roundedRect(512, 400, 100, true));
    expect(measured.keyed).toBe(true);
    // Keying a flat background costs a little precision versus a true alpha
    // channel, but stays well inside a pixel.
    expect(measured.radius).toBeGreaterThan(99);
    expect(measured.radius).toBeLessThan(101);
  });

  it('does not key an image that already carries alpha', () => {
    expect(measureImage(roundedRect(512, 400, 100)).keyed).toBe(false);
  });
});

describe('batch drift', () => {
  it('quantifies spread across runs that differ', () => {
    const drifting = [96, 104, 88, 112].map((radius) =>
      measureImage(roundedRect(512, 400, radius)),
    );
    const stats = batchStats(drifting);
    expect(stats.count).toBe(4);
    // 88..112px on a 400px silhouette is a 6-point spread in percentage terms.
    expect(stats.radiusPercent.spread).toBeGreaterThan(5);
    expect(stats.radiusPercent.stdev).toBeGreaterThan(1);
  });

  it('reports effectively zero spread across identical runs', () => {
    const identical = [0, 1, 2].map(() => measureImage(roundedRect(512, 400, 100)));
    expect(batchStats(identical).radiusPercent.spread).toBeLessThan(0.001);
  });

  it('ignores unmeasurable entries rather than poisoning the mean', () => {
    const stats = batchStats([
      measureImage(roundedRect(512, 400, 100)),
      { ...measureImage(roundedRect(512, 400, 100)), exponent: Number.NaN },
    ]);
    expect(Number.isFinite(stats.exponent.mean)).toBe(true);
  });
});

describe('failure modes', () => {
  it('refuses an empty image with a clear message', () => {
    const blank: RGBAImage = {
      data: new Uint8ClampedArray(64 * 64 * 4),
      width: 64,
      height: 64,
    };
    expect(() => measureImage(blank)).toThrow(/empty/i);
  });
});
