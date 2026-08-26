/**
 * Export: platform PNG sets, Windows .ico, and a .zip to carry them.
 *
 * Because the container is geometry rather than a bitmap, every size here is a
 * fresh render at native resolution instead of a downscale of one master. A
 * 32px icon therefore gets a corner mathematically identical to the 1024px
 * one, antialiased for 32px — not a smeared resample of a big corner.
 */

import {
  ADAPTIVE_DP,
  composeAdaptiveBackground,
  composeAdaptiveForeground,
  composeAdaptiveMonochrome,
  composeForIos,
  composeIcon,
  type ComposeLayers,
  type ComposeOptions,
} from './compose';
import { containerPath, toSvgDocument } from './geometry';
import { crc32, encodeRgbPng, rgbOf } from './png';
import type { ContainerSpec } from './spec';

export interface PlatformTarget {
  platform: string;
  name: string;
  size: number;
}

export const PLATFORM_TARGETS: PlatformTarget[] = [
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

/**
 * One entry in an Xcode AppIcon set: the pixel size, plus the idiom and scale
 * that `Contents.json` files it under.
 */
export interface IosRole {
  name: string;
  idiom: string;
  /** Point size as Xcode writes it, e.g. "60x60". */
  points: string;
  scale: string;
  size: number;
}

/**
 * The classic iOS app icon set.
 *
 * Xcode 14 and later accept a lone 1024px icon and derive the rest, but a
 * project created before that still expects every slot filled, and an empty
 * slot is a build warning. Filling them all costs five seconds of rendering
 * and works in both.
 */
export const IOS_ROLES: IosRole[] = [
  { name: 'Icon-20@2x', idiom: 'iphone', points: '20x20', scale: '2x', size: 40 },
  { name: 'Icon-20@3x', idiom: 'iphone', points: '20x20', scale: '3x', size: 60 },
  { name: 'Icon-29@2x', idiom: 'iphone', points: '29x29', scale: '2x', size: 58 },
  { name: 'Icon-29@3x', idiom: 'iphone', points: '29x29', scale: '3x', size: 87 },
  { name: 'Icon-40@2x', idiom: 'iphone', points: '40x40', scale: '2x', size: 80 },
  { name: 'Icon-40@3x', idiom: 'iphone', points: '40x40', scale: '3x', size: 120 },
  { name: 'Icon-60@2x', idiom: 'iphone', points: '60x60', scale: '2x', size: 120 },
  { name: 'Icon-60@3x', idiom: 'iphone', points: '60x60', scale: '3x', size: 180 },
  { name: 'Icon-20', idiom: 'ipad', points: '20x20', scale: '1x', size: 20 },
  { name: 'Icon-20@2x~ipad', idiom: 'ipad', points: '20x20', scale: '2x', size: 40 },
  { name: 'Icon-29', idiom: 'ipad', points: '29x29', scale: '1x', size: 29 },
  { name: 'Icon-29@2x~ipad', idiom: 'ipad', points: '29x29', scale: '2x', size: 58 },
  { name: 'Icon-40', idiom: 'ipad', points: '40x40', scale: '1x', size: 40 },
  { name: 'Icon-40@2x~ipad', idiom: 'ipad', points: '40x40', scale: '2x', size: 80 },
  { name: 'Icon-76', idiom: 'ipad', points: '76x76', scale: '1x', size: 76 },
  { name: 'Icon-76@2x', idiom: 'ipad', points: '76x76', scale: '2x', size: 152 },
  { name: 'Icon-83.5@2x', idiom: 'ipad', points: '83.5x83.5', scale: '2x', size: 167 },
  { name: 'Icon-1024', idiom: 'ios-marketing', points: '1024x1024', scale: '1x', size: 1024 },
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

// ---------------------------------------------------------------------------
// iOS
// ---------------------------------------------------------------------------

/**
 * Render one iOS size as a PNG with no alpha channel.
 *
 * App Store Connect rejects an app icon for carrying an alpha channel at all —
 * a fully opaque RGBA file fails the same check a transparent one does — and
 * canvas cannot encode anything else, so the pixels are re-encoded as
 * truecolour. See `core/png.ts` for why that costs file size.
 */
export function iosPng(
  spec: ContainerSpec,
  size: number,
  layers: ComposeLayers,
  options: ComposeOptions,
): Uint8Array<ArrayBuffer> {
  const canvas = composeForIos(spec, size, layers, options);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  const pixels = ctx.getImageData(0, 0, size, size).data;
  return encodeRgbPng(pixels, size, size, rgbOf(options.baseColor));
}

/**
 * The `Contents.json` Xcode expects beside an AppIcon set, so the folder can
 * be dropped straight into an asset catalogue instead of placed by hand.
 */
export function appIconContentsJson(): string {
  const images = IOS_ROLES.map((role) => ({
    filename: `${role.name}.png`,
    idiom: role.idiom,
    scale: role.scale,
    size: role.points,
  }));
  return JSON.stringify({ images, info: { author: 'icon-generator', version: 1 } }, null, 2);
}

// ---------------------------------------------------------------------------
// Android adaptive icons
// ---------------------------------------------------------------------------

/** Screen densities, and the multiplier each applies to a dp measurement. */
export const ANDROID_DENSITIES = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
] as const;

/** The pre-adaptive launcher icon is 48dp; the adaptive layers are 108dp. */
const LEGACY_DP = 48;

/**
 * `mipmap-anydpi-v26/ic_launcher.xml` — the file that makes the three layers
 * an adaptive icon rather than three loose bitmaps.
 *
 * The monochrome entry is what a themed home screen uses. It is optional in
 * the sense that the icon still builds without it, and not optional in the
 * sense that an icon lacking it stays fully coloured while every icon around
 * it takes the wallpaper's tint.
 */
export function adaptiveIconXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
}

/**
 * The whole Android resource tree: three adaptive layers at five densities,
 * a legacy launcher bitmap for anything older than API 26, the XML that binds
 * them, and the 512px bitmap the Play listing asks for separately.
 *
 * Emitting real layers is close to free here and is not for most generators:
 * the material and the glyph were never flattened together in the first place,
 * so there is nothing to segment back apart.
 */
export async function buildAndroidResources(
  spec: ContainerSpec,
  layers: ComposeLayers,
  options: ComposeOptions,
): Promise<Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }>> {
  const files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> = [];
  const png = async (canvas: HTMLCanvasElement) => blobBytes(await canvasToBlob(canvas));

  for (const density of ANDROID_DENSITIES) {
    const layer = Math.round(ADAPTIVE_DP * density.scale);
    const legacy = Math.round(LEGACY_DP * density.scale);
    const dir = `android/res/mipmap-${density.name}`;

    files.push({
      name: `${dir}/ic_launcher_background.png`,
      bytes: await png(composeAdaptiveBackground(layer, layers, options)),
    });
    files.push({
      name: `${dir}/ic_launcher_foreground.png`,
      bytes: await png(composeAdaptiveForeground(layer, layers)),
    });
    files.push({
      name: `${dir}/ic_launcher_monochrome.png`,
      bytes: await png(composeAdaptiveMonochrome(spec, layer, layers)),
    });
    // Pre-26 launchers ignore the layers and use this one flattened bitmap,
    // which is the icon exactly as the preview shows it.
    files.push({
      name: `${dir}/ic_launcher.png`,
      bytes: await png(renderAtSize(spec, legacy, layers, options)),
    });
  }

  files.push({
    name: 'android/res/mipmap-anydpi-v26/ic_launcher.xml',
    bytes: new TextEncoder().encode(adaptiveIconXml()),
  });
  files.push({
    name: 'android/play-store-512.png',
    bytes: await png(renderAtSize(spec, 512, layers, options)),
  });
  files.push({
    name: 'android/README.txt',
    bytes: new TextEncoder().encode(ANDROID_README),
  });
  return files;
}

const ANDROID_README = `Android icon resources
======================

Copy the contents of res/ into your module's src/main/res/, then point the
manifest at it:

    <application android:icon="@mipmap/ic_launcher" ... >

mipmap-anydpi-v26/ic_launcher.xml declares the three adaptive layers. Devices
on API 26 and above use those; anything older falls back to the flattened
ic_launcher.png in the density folders.

The layers
----------
  ic_launcher_background   the container fill, edge to edge
  ic_launcher_foreground   the symbol, inside the ${ADAPTIVE_DP}dp canvas's safe zone
  ic_launcher_monochrome   the same silhouette in one colour, for themed icons

Adaptive layers are ${ADAPTIVE_DP}dp square and the launcher shows the middle 72dp of
them, so the artwork is placed inside the 66dp that is safe under every mask
shape. Do not crop these files: the margin is what lets the launcher animate
and re-shape the icon.

play-store-512.png is the Play Console listing icon. It is uploaded there, not
bundled in the APK.
`;

/**
 * The whole `AppIcon.appiconset` folder — every role rendered at its native
 * size, all of them alpha-free, and the `Contents.json` that names them.
 */
export function buildIosAppIconSet(
  spec: ContainerSpec,
  layers: ComposeLayers,
  options: ComposeOptions,
): Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> {
  const dir = 'ios/AppIcon.appiconset';
  const files = IOS_ROLES.map((role) => ({
    name: `${dir}/${role.name}.png`,
    bytes: iosPng(spec, role.size, layers, options),
  }));
  files.push({
    name: `${dir}/Contents.json`,
    bytes: new TextEncoder().encode(appIconContentsJson()),
  });
  files.push({ name: 'ios/README.txt', bytes: new TextEncoder().encode(IOS_README) });
  return files;
}

const IOS_README = `iOS app icon
============

Drag AppIcon.appiconset into your target's Assets.xcassets, replacing the
existing AppIcon set.

Two things about these files are deliberate and are what Apple's validation
actually checks:

  No alpha channel. App Store Connect rejects an app icon for carrying the
  channel at all, not only for containing transparent pixels, so these are
  encoded as truecolour RGB rather than the RGBA a canvas would produce. The
  1024px file is larger than a compressed PNG would be; Xcode re-encodes
  everything into Assets.car at build time, so nothing ships that size.

  Full bleed. iOS applies its own superellipse mask. An icon that arrives
  already inset gets masked a second time and ends up floating inside a
  visible margin, so the container is rendered edge to edge and the corners
  are filled with the base colour for the system to cut away.
`;
