/**
 * Read an uploaded master and describe it, so the prompt fields arrive
 * pre-filled instead of blank.
 *
 * Almost all of this needs no model. Palette, gradient direction, finish and
 * whether a glyph is present are measurable properties of the pixels, and
 * measuring them is faster, free, offline, and repeatable in a way a caption
 * model is not. The one thing genuinely requiring a vision model is *naming*
 * the subject — "a paper plane" is not recoverable from a histogram — so that
 * is the only part that makes an API call, and its absence degrades to a
 * prompt the user can finish in three words.
 */

import { boundingBox, contourPoints, subPixelBox, toMask, type RGBAImage } from './measure';

export interface Swatch {
  r: number;
  g: number;
  b: number;
  /** Share of sampled pixels belonging to this cluster, 0-1. */
  weight: number;
  hex: string;
  name: string;
}

export interface MasterDescription {
  /** Dominant container colour as hex, for the base-colour control. */
  baseColor: string;
  palette: Swatch[];
  /** Prompt text for the container surface. */
  material: string;
  /** Human summary of what was detected, shown next to the fields. */
  notes: string[];
  glyph: {
    present: boolean;
    /** Share of the safe area the glyph occupies, 0-1. */
    coverage: number;
    color: string;
    colorName: string;
  };
  finish: {
    gradient: 'none' | 'vertical' | 'horizontal' | 'diagonal';
    /** 0-1, how strong the luminance ramp is across the container. */
    gradientStrength: number;
    glossy: boolean;
    contrast: number;
  };
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function toHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;

  return { h: (hue * 60 + 360) % 360, s: saturation, l: lightness };
}

/** Hue buckets chosen so the common icon colours get distinct, usable words. */
const HUES: Array<{ upTo: number; name: string }> = [
  { upTo: 12, name: 'red' },
  { upTo: 38, name: 'orange' },
  { upTo: 52, name: 'amber' },
  { upTo: 68, name: 'yellow' },
  { upTo: 95, name: 'lime' },
  // 160 rather than 150: a lot of "green" icons sit at 150-160, and calling
  // those teal reads as wrong even though the hue is technically borderline.
  { upTo: 160, name: 'green' },
  // Teal and cyan share a hue and differ by lightness, so this bucket is
  // resolved below rather than split here.
  { upTo: 200, name: 'teal' },
  { upTo: 220, name: 'sky blue' },
  { upTo: 245, name: 'blue' },
  { upTo: 265, name: 'indigo' },
  { upTo: 285, name: 'violet' },
  { upTo: 310, name: 'purple' },
  { upTo: 335, name: 'magenta' },
  { upTo: 350, name: 'pink' },
  { upTo: 361, name: 'red' },
];

/**
 * Turn a colour into words a prompt can use.
 *
 * Deliberately coarse. "deep indigo" steers an image model usefully; a precise
 * name like "#3B2F8C" does not, and a hex code in a prompt is mostly ignored.
 */
export function nameColor(r: number, g: number, b: number): string {
  const { h, s, l } = toHsl(r, g, b);

  if (l < 0.06) return 'near-black';
  if (l > 0.95 && s < 0.12) return 'white';

  if (s < 0.1) {
    if (l < 0.22) return 'charcoal';
    if (l < 0.42) return 'dark grey';
    if (l < 0.62) return 'mid grey';
    if (l < 0.82) return 'light grey';
    return 'off-white';
  }

  let hue = HUES.find((entry) => h < entry.upTo)?.name ?? 'blue';
  // "Teal" is dark cyan; the same hue read light is just cyan.
  if (hue === 'teal' && l > 0.58) hue = 'cyan';
  const vivid = s > 0.72;

  if (l < 0.24) return `deep ${hue}`;
  if (l < 0.42) return vivid ? `rich ${hue}` : `dark ${hue}`;
  if (l < 0.62) return vivid ? `vivid ${hue}` : hue;
  if (l < 0.8) return `light ${hue}`;
  return `pale ${hue}`;
}

/**
 * k-means over sampled pixels.
 *
 * Seeded deterministically by spreading initial centroids across the sampled
 * range rather than picking at random, so the same master always yields the
 * same palette — the app's whole premise is that repeat runs agree.
 */
function kmeans(pixels: number[][], k: number, iterations = 12): Swatch[] {
  if (!pixels.length) return [];
  const count = Math.min(k, pixels.length);

  const sorted = [...pixels].sort(
    (a, b) => luminance(a[0], a[1], a[2]) - luminance(b[0], b[1], b[2]),
  );
  let centroids = Array.from({ length: count }, (_unused, index) => {
    const at = Math.floor(((index + 0.5) / count) * sorted.length);
    return [...sorted[Math.min(at, sorted.length - 1)]];
  });

  let assignment = new Array<number>(pixels.length).fill(0);

  for (let round = 0; round < iterations; round++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const distance =
          (pixels[i][0] - centroids[c][0]) ** 2 +
          (pixels[i][1] - centroids[c][1]) ** 2 +
          (pixels[i][2] - centroids[c][2]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      if (assignment[i] !== best) moved = true;
      assignment[i] = best;
    }

    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const at = assignment[i];
      sums[at][0] += pixels[i][0];
      sums[at][1] += pixels[i][1];
      sums[at][2] += pixels[i][2];
      sums[at][3]++;
    }
    centroids = centroids.map((centroid, index) =>
      sums[index][3] === 0
        ? centroid
        : [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]],
    );

    if (!moved) break;
  }

  const counts = centroids.map(() => 0);
  for (const at of assignment) counts[at]++;

  return centroids
    .map((centroid, index) => ({
      r: centroid[0],
      g: centroid[1],
      b: centroid[2],
      weight: counts[index] / pixels.length,
      hex: hex(centroid[0], centroid[1], centroid[2]),
      name: nameColor(centroid[0], centroid[1], centroid[2]),
    }))
    .filter((swatch) => swatch.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Describe an uploaded master.
 *
 * `glyphInset` mirrors the spec field: the inner region is where a glyph would
 * live, and comparing it against the container's dominant colour is what makes
 * "there is a symbol here" measurable rather than guessed.
 */
export function describeMaster(image: RGBAImage, glyphInset = 18): MasterDescription {
  const mask = toMask(image);
  const box = subPixelBox(contourPoints(mask, boundingBox(mask)));
  const { data } = image;

  const inside: number[][] = [];
  const innerPixels: number[][] = [];
  const outerPixels: number[][] = [];

  // Sample on a grid rather than every pixel: a 1024px master is a million
  // pixels and k-means over all of them buys no extra accuracy here.
  const step = Math.max(1, Math.floor(Math.min(box.width, box.height) / 96));
  const innerHalf = (Math.min(box.width, box.height) / 2) * (1 - glyphInset / 100);

  let topSum = 0;
  let topCount = 0;
  let bottomSum = 0;
  let bottomCount = 0;
  let leftSum = 0;
  let leftCount = 0;
  let rightSum = 0;
  let rightCount = 0;
  const lums: number[] = [];

  for (let y = Math.floor(box.y0); y <= Math.ceil(box.y1); y += step) {
    for (let x = Math.floor(box.x0); x <= Math.ceil(box.x1); x += step) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      if (mask.coverage[y * mask.width + x] < 200) continue;

      const at = (y * image.width + x) * 4;
      const pixel = [data[at], data[at + 1], data[at + 2]];
      inside.push(pixel);

      const l = luminance(pixel[0], pixel[1], pixel[2]);
      lums.push(l);
      if (y < box.cy) {
        topSum += l;
        topCount++;
      } else {
        bottomSum += l;
        bottomCount++;
      }
      if (x < box.cx) {
        leftSum += l;
        leftCount++;
      } else {
        rightSum += l;
        rightCount++;
      }

      const central = Math.abs(x - box.cx) < innerHalf && Math.abs(y - box.cy) < innerHalf;
      (central ? innerPixels : outerPixels).push(pixel);
    }
  }

  if (!inside.length) throw new Error('Could not read any pixels from that image.');

  const palette = kmeans(inside, 4);
  const containerSwatches = kmeans(outerPixels.length > 20 ? outerPixels : inside, 2);
  const base = containerSwatches[0] ?? palette[0];

  // Finish: luminance ramp across the container, and how wide its range is.
  const vertical = topCount && bottomCount ? (topSum / topCount - bottomSum / bottomCount) / 255 : 0;
  const horizontal = leftCount && rightCount ? (leftSum / leftCount - rightSum / rightCount) / 255 : 0;
  lums.sort((a, b) => a - b);
  const p05 = lums[Math.floor(lums.length * 0.05)] ?? 0;
  const p95 = lums[Math.floor(lums.length * 0.95)] ?? 0;
  const contrast = (p95 - p05) / 255;

  const absV = Math.abs(vertical);
  const absH = Math.abs(horizontal);
  const GRADIENT_FLOOR = 0.04;
  let gradient: MasterDescription['finish']['gradient'] = 'none';
  if (absV > GRADIENT_FLOOR && absH > GRADIENT_FLOOR) gradient = 'diagonal';
  else if (absV > GRADIENT_FLOOR) gradient = 'vertical';
  else if (absH > GRADIENT_FLOOR) gradient = 'horizontal';

  // A bright, small, high-luminance tail reads as a specular highlight.
  const brightTail = lums.filter((l) => l > p95).length / Math.max(1, lums.length);
  const glossy = contrast > 0.35 && brightTail < 0.12;

  // Glyph: does the inner region hold a colour meaningfully unlike the shell?
  let glyphPixels = 0;
  const glyphSamples: number[][] = [];
  for (const pixel of innerPixels) {
    const distance = Math.hypot(pixel[0] - base.r, pixel[1] - base.g, pixel[2] - base.b);
    if (distance > 60) {
      glyphPixels++;
      glyphSamples.push(pixel);
    }
  }
  const coverage = innerPixels.length ? glyphPixels / innerPixels.length : 0;
  const present = coverage > 0.03 && glyphSamples.length > 12;
  const glyphSwatch = present ? kmeans(glyphSamples, 1)[0] : null;

  // Built as clauses and joined with commas: concatenating them with spaces
  // produced "blue with a top-lit vertical gradient glossy with a soft
  // specular highlight", which reads as one run-on phrase.
  const clauses: string[] = [base.name];
  if (gradient !== 'none') {
    const direction =
      gradient === 'vertical'
        ? vertical > 0 ? 'top-lit vertical gradient' : 'bottom-lit vertical gradient'
        : gradient === 'horizontal'
          ? 'side-lit gradient'
          : 'soft diagonal gradient';
    clauses.push(`with a ${direction}`);
  }
  if (glossy) clauses.push('glossy with a soft specular highlight');
  else if (contrast < 0.16) clauses.push('flat matte finish');

  const notes: string[] = [
    `Container colour ${base.name} (${base.hex}).`,
    gradient === 'none' ? 'No obvious gradient.' : `Detected a ${gradient} gradient.`,
    glossy ? 'Looks glossy.' : contrast < 0.16 ? 'Looks matte.' : 'Moderate surface contrast.',
  ];
  notes.push(
    present
      ? `Found a ${glyphSwatch?.name ?? 'contrasting'} symbol covering ${(coverage * 100).toFixed(0)}% of the safe area — describe what it is.`
      : 'No separate symbol detected inside the container.',
  );

  return {
    baseColor: base.hex,
    palette,
    material: clauses.join(', '),
    notes,
    glyph: {
      present,
      coverage,
      color: glyphSwatch?.hex ?? '#ffffff',
      colorName: glyphSwatch?.name ?? 'white',
    },
    finish: { gradient, gradientStrength: Math.max(absV, absH), glossy, contrast },
  };
}
