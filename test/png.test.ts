import { describe, expect, it } from 'vitest';
import { crc32, encodeRgbPng, rgbOf } from '../src/core/png';

/** Read a big-endian u32. */
const u32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** Walk the chunk list, verifying each CRC on the way. */
function chunks(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const found: Array<{ type: string; data: Uint8Array }> = [];
  let at = 8;
  while (at < png.length) {
    const length = u32(png, at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    expect(u32(png, at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    found.push({ type, data });
    at += 12 + length;
  }
  return found;
}

/** Undo the zlib wrapper and the stored DEFLATE blocks. */
function inflateStored(zlib: Uint8Array): Uint8Array {
  expect(zlib[0]).toBe(0x78);
  // The two header bytes must be a multiple of 31 or a decoder rejects them.
  expect(((zlib[0] << 8) | zlib[1]) % 31).toBe(0);
  const out: number[] = [];
  let at = 2;
  for (;;) {
    const header = zlib[at];
    expect(header & 0b110).toBe(0); // BTYPE 00 — stored
    const len = zlib[at + 1] | (zlib[at + 2] << 8);
    const nlen = zlib[at + 3] | (zlib[at + 4] << 8);
    expect(nlen).toBe(~len & 0xffff);
    out.push(...zlib.subarray(at + 5, at + 5 + len));
    at += 5 + len;
    if (header & 1) break;
  }
  return new Uint8Array(out);
}

/** Build RGBA input from a per-pixel callback. */
function pixels(w: number, h: number, at: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  return data;
}

describe('RGB PNG encoder', () => {
  it('declares truecolour without alpha, which is the whole point', () => {
    const png = encodeRgbPng(pixels(4, 3, () => [10, 20, 30, 255]), 4, 3);
    const ihdr = chunks(png).find((c) => c.type === 'IHDR');
    expect(ihdr).toBeDefined();
    expect(u32(ihdr!.data, 0)).toBe(4);
    expect(u32(ihdr!.data, 4)).toBe(3);
    expect(ihdr!.data[8]).toBe(8); // bit depth
    expect(ihdr!.data[9]).toBe(2); // colour type 2 = RGB, no alpha
  });

  it('emits no transparency chunk of any kind', () => {
    const png = encodeRgbPng(pixels(8, 8, () => [1, 2, 3, 255]), 8, 8);
    const types = chunks(png).map((c) => c.type);
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(types).not.toContain('tRNS');
  });

  it('round-trips the pixels it was given', () => {
    const source = pixels(5, 4, (x, y) => [x * 40, y * 60, (x + y) * 20, 255]);
    const png = encodeRgbPng(source, 5, 4);
    const raw = inflateStored(chunks(png).find((c) => c.type === 'IDAT')!.data);
    // Each scanline is a filter byte followed by width RGB triples.
    expect(raw.length).toBe(4 * (5 * 3 + 1));
    for (let y = 0; y < 4; y++) {
      expect(raw[y * 16]).toBe(0); // filter 0 = None
      for (let x = 0; x < 5; x++) {
        const got = [raw[y * 16 + 1 + x * 3], raw[y * 16 + 2 + x * 3], raw[y * 16 + 3 + x * 3]];
        expect(got).toEqual([x * 40, y * 60, (x + y) * 20]);
      }
    }
  });

  it('composites a transparent pixel over the backdrop instead of keeping its raw colour', () => {
    // Dropping alpha without blending is how flattened exports get bright
    // fringes: a fully transparent white pixel would come out white.
    const png = encodeRgbPng(pixels(1, 1, () => [255, 255, 255, 0]), 1, 1, [10, 20, 30]);
    const raw = inflateStored(chunks(png).find((c) => c.type === 'IDAT')!.data);
    expect([raw[1], raw[2], raw[3]]).toEqual([10, 20, 30]);
  });

  it('blends a half-transparent pixel proportionally', () => {
    const png = encodeRgbPng(pixels(1, 1, () => [200, 100, 0, 128]), 1, 1, [0, 0, 200]);
    const raw = inflateStored(chunks(png).find((c) => c.type === 'IDAT')!.data);
    const k = 128 / 255;
    expect([raw[1], raw[2], raw[3]]).toEqual([
      Math.round(200 * k),
      Math.round(100 * k),
      Math.round(200 * (1 - k)),
    ]);
  });

  it('spans more than one stored block when the data exceeds 65535 bytes', () => {
    // 200x200 RGB is ~120KB of scanlines, so the block loop has to run twice.
    const png = encodeRgbPng(pixels(200, 200, () => [9, 9, 9, 255]), 200, 200);
    const raw = inflateStored(chunks(png).find((c) => c.type === 'IDAT')!.data);
    expect(raw.length).toBe(200 * (200 * 3 + 1));
  });

  it('refuses input that is too short rather than encoding garbage', () => {
    expect(() => encodeRgbPng(new Uint8ClampedArray(8), 4, 4)).toThrow(/Expected/);
  });
});

describe('colour parsing', () => {
  it('reads long and short hex, and falls back on nonsense', () => {
    expect(rgbOf('#1d4ed8')).toEqual([0x1d, 0x4e, 0xd8]);
    expect(rgbOf('1d4ed8')).toEqual([0x1d, 0x4e, 0xd8]);
    expect(rgbOf('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(rgbOf('rebeccapurple')).toEqual([255, 255, 255]);
  });
});
