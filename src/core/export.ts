/**
 * Export: platform PNG sets, Windows .ico, and a .zip to carry them.
 *
 * Because the container is geometry rather than a bitmap, every size here is a
 * fresh render at native resolution instead of a downscale of one master. A
 * 32px icon therefore gets a corner mathematically identical to the 1024px
 * one, antialiased for 32px — not a smeared resample of a big corner.
 */

import { composeCompleteIcon, composeIcon, composeOpenFrame, renderTransparentLayer, type ComposeLayers, type ComposeOptions } from './compose';
import { containerPath, toSvgDocument } from './geometry';
import type { ContainerSpec } from './spec';

export interface PlatformTarget {
  platform: string;
  name: string;
  size: number;
}

export const PLATFORM_TARGETS: PlatformTarget[] = [
  { platform: 'ios', name: 'Icon-1024', size: 1024 },
  { platform: 'ios', name: 'Icon-180', size: 180 },
  { platform: 'ios', name: 'Icon-120', size: 120 },
  { platform: 'ios', name: 'Icon-87', size: 87 },
  { platform: 'ios', name: 'Icon-60', size: 60 },
  { platform: 'android', name: 'xxxhdpi-192', size: 192 },
  { platform: 'android', name: 'xxhdpi-144', size: 144 },
  { platform: 'android', name: 'xhdpi-96', size: 96 },
  { platform: 'android', name: 'hdpi-72', size: 72 },
  { platform: 'android', name: 'mdpi-48', size: 48 },
  { platform: 'macos', name: 'icon_512x512@2x', size: 1024 },
  { platform: 'macos', name: 'icon_256x256@2x', size: 512 },
  { platform: 'macos', name: 'icon_128x128', size: 128 },
  { platform: 'windows', name: 'icon-256', size: 256 },
  { platform: 'windows', name: 'icon-48', size: 48 },
  { platform: 'windows', name: 'icon-32', size: 32 },
  { platform: 'windows', name: 'icon-16', size: 16 },
  { platform: 'web', name: 'favicon-32', size: 32 },
  { platform: 'web', name: 'apple-touch-icon-180', size: 180 },
  { platform: 'web', name: 'maskable-512', size: 512 },
];

/** Sizes packed into a Windows .ico. */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas could not be encoded as PNG.'));
    }, 'image/png');
  });
}

/** Re-render the icon at a different edge length. Not a resample. */
export function renderAtSize(
  spec: ContainerSpec,
  size: number,
  layers: ComposeLayers,
  options: ComposeOptions,
): HTMLCanvasElement {
  // Stroke and shadow widths are authored against the spec size, so they are
  // scaled proportionally; otherwise a 2px rim would swallow a 16px icon.
  const k = size / spec.size;
  return composeIcon(
    { ...spec, size },
    layers,
    {
      ...options,
      rimWidth: options.rimWidth * k,
      shadowBlur: options.shadowBlur * k,
      shadowOffsetY: options.shadowOffsetY * k,
    },
  );
}

/** Re-render an isolated alpha asset at a target size without a backing tile. */
export function renderTransparentAtSize(
  spec: ContainerSpec,
  size: number,
  image: CanvasImageSource | null | undefined,
  options: ComposeOptions,
): HTMLCanvasElement {
  return renderTransparentLayer({ ...spec, size }, image, options);
}

/** Render a transparent decorative container plus glyph at a target size. */
export function renderOpenFrameAtSize(
  spec: ContainerSpec,
  size: number,
  layers: ComposeLayers,
  options: ComposeOptions,
): HTMLCanvasElement {
  return composeOpenFrame({ ...spec, size }, layers, options);
}

/** Render a self-contained complete tile while retaining its translucent rim. */
export function renderCompleteAtSize(
  spec: ContainerSpec,
  size: number,
  image: CanvasImageSource | null | undefined,
  options: ComposeOptions,
): HTMLCanvasElement {
  const k = size / spec.size;
  return composeCompleteIcon({ ...spec, size }, image, {
    ...options,
    rimWidth: options.rimWidth * k,
    shadowBlur: options.shadowBlur * k,
    shadowOffsetY: options.shadowOffsetY * k,
  });
}

// ---------------------------------------------------------------------------
// Windows .ico
// ---------------------------------------------------------------------------

/**
 * Build a Windows .ico containing PNG-encoded entries.
 *
 * PNG-in-ICO is supported from Vista onward and avoids hand-rolling the BMP
 * variant with its inverted rows and separate AND mask.
 */
export async function buildIco(
  pngs: Array<{ size: number; bytes: Uint8Array<ArrayBuffer> }>,
): Promise<Blob> {
  const entries = [...pngs].sort((a, b) => a.size - b.size);
  const HEADER = 6;
  const DIRECTORY = 16;
  const directorySize = HEADER + DIRECTORY * entries.length;

  const total = directorySize + entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, entries.length, true);

  let offset = directorySize;
  entries.forEach((entry, index) => {
    const at = HEADER + DIRECTORY * index;
    // 256 is encoded as 0 in the directory — the field is a single byte.
    view.setUint8(at, entry.size >= 256 ? 0 : entry.size);
    view.setUint8(at + 1, entry.size >= 256 ? 0 : entry.size);
    view.setUint8(at + 2, 0); // palette count
    view.setUint8(at + 3, 0); // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, entry.bytes.length, true);
    view.setUint32(at + 12, offset, true);
    bytes.set(entry.bytes, offset);
    offset += entry.bytes.length;
  });

  return new Blob([buffer], { type: 'image/x-icon' });
}

// ---------------------------------------------------------------------------
// ZIP (stored, no compression)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP writer using stored entries.
 *
 * PNG payloads are already DEFLATE-compressed internally, so running them
 * through DEFLATE again would add a dependency to save low single-digit
 * percentages. Stored entries keep this to one file and no build step.
 */
export function buildZip(files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }>): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);

    const local = new Uint8Array(30 + nameBytes.length + file.bytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0, true); // flags
    localView.setUint16(8, 0, true); // method: stored
    localView.setUint16(10, 0, true); // mod time
    localView.setUint16(12, 0x21, true); // mod date (1980-01-01)
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(file.bytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x21, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  // Each part is allocated at its exact length, so handing Blob the underlying
  // buffers is equivalent to handing it the views — and sidesteps the
  // ArrayBufferLike/ArrayBuffer narrowing that TypeScript applies to BlobPart.
  const parts = [...locals, ...centrals, end].map((part) => part.buffer as ArrayBuffer);
  return new Blob(parts, { type: 'application/zip' });
}

export function svgMask(spec: ContainerSpec, fill = '#000000'): string {
  return toSvgDocument(spec, containerPath(spec), fill);
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}
