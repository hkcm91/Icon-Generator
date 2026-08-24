/**
 * Canvas compositing.
 *
 * The pipeline is deliberately one-directional:
 *
 *   geometry (exact, from spec)  ──┐
 *                                  ├─►  clip  ──► composite ──► icon
 *   material + glyph (from model) ─┘
 *
 * The model's output never decides where an edge is. It supplies colour and
 * texture inside a silhouette that code already fixed. That inversion is the
 * whole fix for corner-radius drift.
 */

import { containerPath, glyphSafePath, innerBox } from './geometry';
import type { ContainerSpec } from './spec';

export interface ComposeLayers {
  /** Full-bleed surface texture. Cropped to fill, then clipped to the path. */
  material?: CanvasImageSource | null;
  /** Glyph art on a transparent or flat background. */
  glyph?: CanvasImageSource | null;
}

export interface ComposeOptions {
  /** Flat colour drawn under the material. Also the fallback when none. */
  baseColor: string;
  /** Analytic rim drawn along the exact contour, in px. 0 disables it. */
  rimWidth: number;
  rimColor: string;
  /** Contact shadow beneath the container. 0 disables it. */
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetY: number;
  /** Scale applied to the glyph inside its safe area. */
  glyphScale: number;
  /** Optical offsets as a percentage of the container edge. */
  glyphOffsetX: number;
  glyphOffsetY: number;
}

export const DEFAULT_COMPOSE: ComposeOptions = {
  baseColor: '#1d4ed8',
  rimWidth: 0,
  rimColor: '#ffffff',
  shadowBlur: 0,
  shadowColor: 'rgba(15, 23, 42, 0.35)',
  shadowOffsetY: 0,
  glyphScale: 1,
  glyphOffsetX: 0,
  glyphOffsetY: 0,
};

export function createCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  return ctx;
}

/**
 * Draw an image so it covers the whole box, centre-cropped — the same rule CSS
 * `object-fit: cover` uses. Never letterboxes, so the material can't introduce
 * transparent bands that would read as a change in silhouette.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth =
    (image as HTMLImageElement).naturalWidth ||
    (image as HTMLCanvasElement).width ||
    width;
  const sourceHeight =
    (image as HTMLImageElement).naturalHeight ||
    (image as HTMLCanvasElement).height ||
    height;

  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

/** Draw an image scaled to fit entirely inside the box, centred. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth =
    (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width || width;
  const sourceHeight =
    (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height || height;

  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

/**
 * The container silhouette as an opaque white mask on transparent black.
 * Exported on its own because it is genuinely useful as an Android adaptive
 * icon mask and as a QA artefact.
 */
export function renderMask(spec: ContainerSpec, scale = 1): HTMLCanvasElement {
  const canvas = createCanvas(spec.size);
  const ctx = context2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(containerPath(spec, scale)), 'evenodd');
  return canvas;
}

export function composeIcon(
  spec: ContainerSpec,
  layers: ComposeLayers,
  options: ComposeOptions = DEFAULT_COMPOSE,
): HTMLCanvasElement {
  const canvas = createCanvas(spec.size);
  const ctx = context2d(canvas);
  const box = innerBox(spec);
  const outline = new Path2D(containerPath(spec));

  // 1. Contact shadow, cast by the exact contour rather than by the artwork.
  if (options.shadowBlur > 0) {
    ctx.save();
    ctx.shadowColor = options.shadowColor;
    ctx.shadowBlur = options.shadowBlur;
    ctx.shadowOffsetY = options.shadowOffsetY;
    ctx.fillStyle = '#000000';
    ctx.fill(outline, 'evenodd');
    ctx.restore();
  }

  // 2. Container body. Everything from here on is clipped to the contour, so
  //    no downstream layer can extend the silhouette by a single pixel.
  ctx.save();
  ctx.clip(outline, 'evenodd');

  ctx.fillStyle = options.baseColor;
  ctx.fillRect(0, 0, spec.size, spec.size);

  if (layers.material) {
    drawCover(ctx, layers.material, box.x, box.y, box.edge, box.edge);
  }

  // 3. Glyph, clipped again to the safe area so it can never touch the rim.
  if (layers.glyph) {
    ctx.save();
    ctx.clip(new Path2D(glyphSafePath(spec)), 'evenodd');
    const safeEdge = box.edge * (1 - spec.glyphInset / 100) * options.glyphScale;
    drawContain(
      ctx,
      layers.glyph,
      box.cx - safeEdge / 2 + box.edge * options.glyphOffsetX / 100,
      box.cy - safeEdge / 2 + box.edge * options.glyphOffsetY / 100,
      safeEdge,
      safeEdge,
    );
    ctx.restore();
  }

  ctx.restore();

  // 4. Analytic rim. Stroked on the same path, so the highlight follows the
  //    true corner curvature instead of whatever the model drew.
  if (options.rimWidth > 0) {
    ctx.save();
    ctx.clip(outline, 'evenodd'); // keep the stroke's outer half inside
    ctx.strokeStyle = options.rimColor;
    ctx.lineWidth = options.rimWidth * 2;
    ctx.stroke(outline);
    ctx.restore();
  }

  return canvas;
}

/**
 * Remove a flat background matte from generated glyph art.
 *
 * Image models routinely ignore "transparent background" and return a solid
 * field instead. Sampling the four corners and keying out colours within
 * `tolerance` of the dominant one recovers usable alpha without needing the
 * model to cooperate.
 */
export function keyOutBackground(
  image: CanvasImageSource,
  size: number,
  tolerance = 28,
): HTMLCanvasElement {
  const canvas = createCanvas(size);
  const ctx = context2d(canvas);
  drawContain(ctx, image, 0, 0, size, size);

  const frame = ctx.getImageData(0, 0, size, size);
  const data = frame.data;

  const corners = [
    0,
    (size - 1) * 4,
    (size - 1) * size * 4,
    ((size - 1) * size + (size - 1)) * 4,
  ];
  // If the art already carries alpha, leave it alone.
  if (corners.every((index) => data[index + 3] < 8)) return canvas;

  let r = 0;
  let g = 0;
  let b = 0;
  for (const index of corners) {
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
  }
  r /= corners.length;
  g /= corners.length;
  b /= corners.length;

  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);
    if (distance <= tolerance) {
      data[i + 3] = 0;
    } else if (distance <= tolerance * 2) {
      // Feather the transition band so the cut edge is not a hard staircase.
      const ratio = (distance - tolerance) / tolerance;
      data[i + 3] = Math.round(data[i + 3] * ratio);
    }
  }

  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/**
 * Clean up alpha that arrived from a model rather than from a keying pass.
 *
 * Two artefacts are documented against gpt-image-2's transparent-background
 * preview, and both bite here:
 *
 *  1. Fully-opaque areas come back at alpha 252-254 rather than 255. Left
 *     alone, every "solid" pixel is faintly transparent, which shows up as a
 *     wash once the icon is composited over a real background.
 *  2. A thin grey halo rings the subject, because edge pixels keep a blend of
 *     the background that was notionally removed.
 *
 * The first is fixed by snapping near-opaque alpha to solid. The second by
 * repainting partially-transparent pixels with the colour of their opaque
 * neighbours, so the edge fades out in the subject's own colour instead of
 * through grey.
 */
export function cleanGeneratedAlpha(
  image: CanvasImageSource,
  size: number,
  opaqueFloor = 250,
): HTMLCanvasElement {
  const canvas = createCanvas(size);
  const ctx = context2d(canvas);
  drawContain(ctx, image, 0, 0, size, size);

  const frame = ctx.getImageData(0, 0, size, size);
  const data = frame.data;
  const original = new Uint8ClampedArray(data);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const alpha = data[at + 3];

      if (alpha >= opaqueFloor && alpha < 255) {
        data[at + 3] = 255;
        continue;
      }
      if (alpha === 0 || alpha === 255) continue;

      // Partially transparent: borrow colour from opaque neighbours so the
      // fringe carries the subject's hue rather than the old background's.
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const near = (ny * size + nx) * 4;
          if (original[near + 3] < opaqueFloor) continue;
          r += original[near];
          g += original[near + 1];
          b += original[near + 2];
          weight++;
        }
      }
      if (weight) {
        data[at] = Math.round(r / weight);
        data[at + 1] = Math.round(g / weight);
        data[at + 2] = Math.round(b / weight);
      }
    }
  }

  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/** True when the image carries meaningful alpha, i.e. its corners are clear. */
export function hasNativeAlpha(image: CanvasImageSource, size = 64): boolean {
  const canvas = createCanvas(size);
  const ctx = context2d(canvas);
  drawContain(ctx, image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const corners = [0, (size - 1) * 4, (size - 1) * size * 4, ((size - 1) * size + size - 1) * 4];
  return corners.every((index) => data[index + 3] < 8);
}
