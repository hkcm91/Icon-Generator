/**
 * Content hashing used to *prove* determinism rather than assert it.
 *
 * Two independent FNV-1a lanes, each 32-bit and exact under `Math.imul`,
 * concatenated into a 64-bit hex digest. This is an equality check over our
 * own renders, not a security boundary — the bar is "different pixels almost
 * never collide", and it has to stay fast because the determinism panel hashes
 * dozens of full-size frames in a loop.
 */

const LANES = [
  { basis: 0x811c9dc5, prime: 0x01000193 },
  // Second lane uses a different basis so the two are not correlated.
  { basis: 0x7fffffff, prime: 0x01000193 },
] as const;

export function fnv1a64(bytes: ArrayLike<number>): string {
  let a = LANES[0].basis >>> 0;
  let b = LANES[1].basis >>> 0;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    a = Math.imul(a ^ byte, LANES[0].prime) >>> 0;
    // Fold the index into the second lane so transpositions change the digest.
    b = Math.imul(b ^ (byte + (i & 0xff)), LANES[1].prime) >>> 0;
  }

  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function hashString(text: string): string {
  return fnv1a64(new TextEncoder().encode(text));
}

/** Hash raw RGBA pixels. Used to compare two renders bit-for-bit. */
export function hashPixels(data: Uint8ClampedArray): string {
  return fnv1a64(data);
}
