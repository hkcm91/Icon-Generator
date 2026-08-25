import { usesAiGeneration, type IconItem } from './library';

export type ImageQuality = 'low' | 'medium' | 'high';

export function modelOutputCost(model: string, quality: ImageQuality = 'low'): number | null {
  if (model === 'openai/gpt-image-2') return { low: 0.012, medium: 0.047, high: 0.128 }[quality];
  if (model === 'google/nano-banana-pro') return 0.15;
  if (model === 'google/nano-banana') return 0.039;
  if (model === 'bytedance/seedream-4') return 0.03;
  return null;
}

/** Exact brand/custom artwork is local; built-in shape glyphs always use the image API. */
export function needsPaidGeneration(item: IconItem): boolean {
  return usesAiGeneration(item);
}

export function estimateGlyphBatch(
  items: IconItem[],
  model: string,
  quality: ImageQuality = 'low',
): { paid: number; local: number; outputs: number; cost: number | null } {
  const paid = items.filter(needsPaidGeneration).length;
  const perOutput = modelOutputCost(model, quality);
  return {
    paid,
    local: items.length - paid,
    outputs: paid,
    cost: perOutput === null ? null : paid * perOutput,
  };
}
