/**
 * A PNG encoder that emits **truecolour without an alpha channel**.
 *
 * Canvas can only hand back RGBA — `toBlob('image/png')` always writes colour
 * type 6 — and Apple's asset validation rejects an icon for *having* an alpha
 * channel, not merely for having transparent pixels in it. Flattening the
 * artwork onto an opaque backdrop is therefore not enough on its own: the
 * channel has to be gone from the file. So the RGB bytes are re-encoded here.
 *
 * DEFLATE is written as **stored** blocks, for the same reason `buildZip` does:
 * a real compressor is a dependency and a build step, and this repository has
 * neither. The cost is file size — a 1024px icon lands around 3MB rather than a
 * few hundred KB. That is acceptable for the one asset it applies to: Xcode
 * re-encodes everything into `Assets.car` at build time, so the size of the
 * source PNG never reaches the app. It would not be acceptable for artwork
 * served over a network, which is why nothing else uses this path.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 over the uncompressed data, as the zlib trailer requires. */
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 is the most bytes that can be accumulated before `b` can overflow a
  // 32-bit int, so the modulo runs once per block rather than once per byte.
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** One PNG chunk: length, type, payload, CRC over type+payload. */
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/** Wrap raw bytes in a zlib stream built from stored DEFLATE blocks. */
function storedZlib(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const MAX = 0xffff;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  // CM=8, CINFO=7, no preset dictionary, and a check byte that makes the
  // two-byte header a multiple of 31.
  out[0] = 0x78;
  out[1] = 0x01;

  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, raw.length - start);
    out[at++] = i === blocks - 1 ? 1 : 0; // BFINAL on the last, BTYPE 00 = stored
    out[at++] = len & 0xff;
    out[at++] = (len >>> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), at);
    at += len;
  }

  new DataView(out.buffer).setUint32(at, adler32(raw));
  return out;
}

/**
 * Encode RGBA pixels as an RGB PNG, dropping the alpha channel outright.
 *
 * Any pixel that is not fully opaque is composited over `backdrop` first —
 * discarding alpha without compositing would let a half-transparent pixel keep
 * its un-blended colour, which is how "flattened" exports end up with bright
 * fringes around the artwork.
 */
export function encodeRgbPng(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  backdrop: [number, number, number] = [255, 255, 255],
): Uint8Array<ArrayBuffer> {
  if (rgba.length < width * height * 4) {
    throw new Error(`Expected ${width * height * 4} bytes of RGBA, got ${rgba.length}.`);
  }

  // Each scanline is prefixed with its filter type. Filters exist to help a
  // compressor find runs; with stored blocks there is nothing to help, so
  // every line uses filter 0 (None).
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    let out = y * stride + 1;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const alpha = rgba[at + 3];
      if (alpha === 255) {
        raw[out++] = rgba[at];
        raw[out++] = rgba[at + 1];
        raw[out++] = rgba[at + 2];
      } else {
        const k = alpha / 255;
        raw[out++] = Math.round(rgba[at] * k + backdrop[0] * (1 - k));
        raw[out++] = Math.round(rgba[at + 1] * k + backdrop[1] * (1 - k));
        raw[out++] = Math.round(rgba[at + 2] * k + backdrop[2] * (1 - k));
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour, no alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', storedZlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** Parse `#rrggbb` into the byte triple the encoder composites against. */
export function rgbOf(color: string): [number, number, number] {
  const hex = color.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return Number.isNaN(n) ? [255, 255, 255] : [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
