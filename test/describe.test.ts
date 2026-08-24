import { describe, expect, it } from 'vitest';
import { describeMaster, nameColor } from '../src/core/describe';
import type { RGBAImage } from '../src/core/measure';

/** Paint a squircle master with a given fill routine. */
function master(
  size: number,
  edge: number,
  paint: (x: number, y: number, t: { nx: number; ny: number }) => [number, number, number],
): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const a = edge / 2;
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / a;
      const dy = (y + 0.5 - c) / a;
      const at = (y * size + x) * 4;
      if (Math.pow(Math.abs(dx), 5) + Math.pow(Math.abs(dy), 5) > 1) continue;
      const [r, g, b] = paint(x, y, { nx: dx, ny: dy });
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

const flat = (r: number, g: number, b: number) => master(400, 320, () => [r, g, b]);

describe('colour naming', () => {
  it('names the common icon colours usefully', () => {
    expect(nameColor(40, 40, 120)).toContain('blue');
    expect(nameColor(34, 139, 34)).toContain('green');
    expect(nameColor(220, 60, 60)).toContain('red');
    expect(nameColor(90, 60, 160)).toMatch(/indigo|violet|purple/);
  });

  it('separates teal from cyan by lightness, since they share a hue', () => {
    expect(nameColor(0, 128, 128)).toContain('teal');
    expect(nameColor(120, 235, 235)).toContain('cyan');
  });

  it('uses greyscale words when saturation is negligible', () => {
    expect(nameColor(30, 30, 31)).toBe('charcoal');
    expect(nameColor(128, 128, 128)).toBe('mid grey');
    expect(nameColor(250, 250, 250)).toBe('white');
    expect(nameColor(4, 4, 4)).toBe('near-black');
  });

  it('qualifies by lightness', () => {
    // Same hue, different lightness, must not produce the same word.
    expect(nameColor(20, 20, 70)).not.toBe(nameColor(150, 150, 240));
  });
});

describe('describeMaster', () => {
  it('reports the container colour as the base', () => {
    const result = describeMaster(flat(40, 44, 130));
    expect(result.material).toContain('blue');
    expect(result.baseColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('detects a vertical gradient and its direction', () => {
    const lightTop = master(400, 320, (_x, y) => {
      const t = y / 400;
      const v = Math.round(220 - t * 150);
      return [v * 0.4, v * 0.45, v];
    });
    const result = describeMaster(lightTop);
    expect(result.finish.gradient).toBe('vertical');
    expect(result.material).toContain('top-lit');
  });

  it('joins description clauses with commas rather than running them together', () => {
    const glossyGradient = master(400, 320, (_x, y) => {
      const t = y / 400;
      const v = Math.round(245 - t * 210);
      return [v * 0.35, v * 0.4, v];
    });
    const { material } = describeMaster(glossyGradient);
    expect(material).toContain(', ');
    expect(material).not.toMatch(/gradient glossy/);
  });

  it('detects a horizontal gradient separately from a vertical one', () => {
    const sideLit = master(400, 320, (x) => {
      const v = Math.round(60 + (x / 400) * 150);
      return [v, v * 0.6, v * 0.5];
    });
    expect(describeMaster(sideLit).finish.gradient).toBe('horizontal');
  });

  it('calls a flat fill matte and finds no gradient', () => {
    const result = describeMaster(flat(90, 40, 40));
    expect(result.finish.gradient).toBe('none');
    expect(result.material).toContain('matte');
    expect(result.finish.contrast).toBeLessThan(0.16);
  });

  it('finds a symbol sitting inside the container', () => {
    const withGlyph = master(400, 320, (x, y) => {
      const inCentre = Math.abs(x - 200) < 45 && Math.abs(y - 200) < 45;
      return inCentre ? [255, 255, 255] : [30, 40, 120];
    });
    const result = describeMaster(withGlyph);
    expect(result.glyph.present).toBe(true);
    expect(result.glyph.coverage).toBeGreaterThan(0.05);
    expect(result.glyph.colorName).toMatch(/white|off-white/);
    expect(result.notes.join(' ')).toContain('describe what it is');
  });

  it('does not invent a symbol on a plain tile', () => {
    const result = describeMaster(flat(30, 40, 120));
    expect(result.glyph.present).toBe(false);
    expect(result.notes.join(' ')).toContain('No separate symbol');
  });

  it('is deterministic — the same master always describes identically', () => {
    const image = master(400, 320, (x, y) => [30 + (x % 7), 40, 120 + (y % 5)]);
    const first = describeMaster(image);
    const second = describeMaster(image);
    expect(second.material).toBe(first.material);
    expect(second.baseColor).toBe(first.baseColor);
    expect(second.palette.map((s) => s.hex)).toEqual(first.palette.map((s) => s.hex));
  });

  it('returns a palette ordered by how much of the image each colour covers', () => {
    const result = describeMaster(
      master(400, 320, (x) => (x < 260 ? [20, 30, 110] : [230, 90, 40])),
    );
    expect(result.palette.length).toBeGreaterThan(1);
    for (let i = 1; i < result.palette.length; i++) {
      expect(result.palette[i].weight).toBeLessThanOrEqual(result.palette[i - 1].weight);
    }
  });

  it('refuses an empty image rather than describing nothing', () => {
    expect(() =>
      describeMaster({ data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 }),
    ).toThrow();
  });
});
