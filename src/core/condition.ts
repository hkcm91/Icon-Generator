/**
 * Shape conditioning — sending the container geometry *to* the model.
 *
 * Clipping alone guarantees the silhouette but leaves the model blind to it:
 * it paints an unbounded texture, code cuts a shape out, and the highlights,
 * bevels and falloff inside that shape have no idea where the corners are. The
 * result is correct in outline and flat in body.
 *
 * Conditioning fixes that by rendering the spec into an image the model can
 * actually see — a base plate, an inpainting mask, or an edge map — so its
 * lighting agrees with the geometry. The clip still runs afterwards, so the
 * outline stays exact even when the model ignores the hint.
 *
 * Every builder here returns SVG text, which keeps them pure and testable in
 * Node; rasterisation to a data URL happens separately, in the browser.
 */

import { containerPath, innerBox } from './geometry';
import type { ContainerSpec } from './spec';

export type ConditioningMode = 'off' | 'reference' | 'masked-fill';

/**
 * Inpainting mask, in the convention FLUX Fill and most SD-derived inpainting
 * models use: **white is repainted, black is preserved**. White inside the
 * container means "put the material here and nowhere else".
 */
export function maskSvg(spec: ContainerSpec): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.size}" height="${spec.size}"`,
    ` viewBox="0 0 ${spec.size} ${spec.size}">`,
    `<rect width="${spec.size}" height="${spec.size}" fill="#000000"/>`,
    `<path d="${containerPath(spec)}" fill="#ffffff" fill-rule="evenodd"/>`,
    '</svg>',
  ].join('');
}

/**
 * Base plate for image-to-image conditioning.
 *
 * Deliberately more than a flat fill: a soft top-down gradient and an inner rim
 * give the model a legible sense of which way is up and where the surface turns
 * over, which is what makes it light the real corners rather than inventing new
 * ones. Kept low-contrast so it reads as a hint, not as art to preserve.
 */
export function shapeReferenceSvg(spec: ContainerSpec, baseColor = '#8a8f98'): string {
  const path = containerPath(spec);
  const { edge } = innerBox(spec);
  const rim = Math.max(1, edge * 0.012);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.size}" height="${spec.size}"`,
    ` viewBox="0 0 ${spec.size} ${spec.size}">`,
    '<defs>',
    '<linearGradient id="body" x1="0" y1="0" x2="0" y2="1">',
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/>`,
    `<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="#000000" stop-opacity="0.28"/>`,
    '</linearGradient>',
    `<clipPath id="shell"><path d="${path}"/></clipPath>`,
    '</defs>',
    // Neutral surround: mid-grey rather than white or black, so the model does
    // not read the background as part of the subject's lighting.
    `<rect width="${spec.size}" height="${spec.size}" fill="#3d4048"/>`,
    `<path d="${path}" fill="${baseColor}" fill-rule="evenodd"/>`,
    `<path d="${path}" fill="url(#body)" fill-rule="evenodd"/>`,
    `<g clip-path="url(#shell)">`,
    `<path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="${rim * 2}"/>`,
    '</g>',
    '</svg>',
  ].join('');
}

/** Contour-only edge map, for models that take a structural control image. */
export function edgeSvg(spec: ContainerSpec): string {
  const stroke = Math.max(1.5, spec.size / 340);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.size}" height="${spec.size}"`,
    ` viewBox="0 0 ${spec.size} ${spec.size}">`,
    `<rect width="${spec.size}" height="${spec.size}" fill="#000000"/>`,
    `<path d="${containerPath(spec)}" fill="none" stroke="#ffffff" stroke-width="${stroke}"/>`,
    '</svg>',
  ].join('');
}

/**
 * Rasterise SVG text to a PNG data URL at `size`.
 *
 * Conditioning images are rendered smaller than the working canvas by default:
 * they travel to the API as base64 inside a JSON body, and a full 1024px plate
 * costs roughly a megabyte per request for detail no conditioning signal needs.
 */
export function rasterizeSvg(svg: string, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('This browser did not provide a 2D canvas context.'));
      ctx.drawImage(image, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('Could not rasterise the conditioning image.'));
    // A data URL keeps the canvas untainted, so toDataURL stays callable.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Longest edge used for conditioning images sent to the API. */
export const CONDITION_SIZE = 768;

export interface Conditioning {
  mode: ConditioningMode;
  reference?: string;
  mask?: string;
}

export async function buildConditioning(
  spec: ContainerSpec,
  mode: ConditioningMode,
): Promise<Conditioning> {
  if (mode === 'off') return { mode };

  const size = Math.min(CONDITION_SIZE, spec.size);
  const reference = await rasterizeSvg(shapeReferenceSvg(spec), size);
  if (mode === 'reference') return { mode, reference };

  return { mode, reference, mask: await rasterizeSvg(maskSvg(spec), size) };
}
