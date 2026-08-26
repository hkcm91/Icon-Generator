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

export interface GenerationQueuePlan {
  paid: number;
  local: number;
  totalCost: number | null;
  batchCost: number | null;
  requestedBatchSize: number;
  effectiveBatchSize: number;
  batches: number;
  blocked: boolean;
  limitAdjusted: boolean;
}

/**
 * Plan a large selection as a queue of bounded concurrent batches.
 *
 * The safety limit applies to work running at once, not to the lifetime cost
 * of the whole queue. If the requested width would exceed that limit, the
 * queue narrows automatically. It blocks only when one paid output by itself
 * costs more than the configured per-batch limit.
 */
export function planGenerationQueue(
  items: IconItem[],
  model: string,
  quality: ImageQuality,
  requestedBatchSize: number,
  maxBatchCost: number,
): GenerationQueuePlan {
  const estimate = estimateGlyphBatch(items, model, quality);
  const requested = Math.max(1, Math.floor(requestedBatchSize) || 1);
  const perOutput = modelOutputCost(model, quality);
  const paidCapacity = perOutput === null
    ? requested
    : Math.max(0, Math.floor((Math.max(0, maxBatchCost) + Number.EPSILON) / perOutput));
  const blocked = estimate.paid > 0 && paidCapacity < 1;
  const effectiveBatchSize = estimate.paid === 0 || perOutput === null
    ? requested
    : Math.max(1, Math.min(requested, paidCapacity));

  return {
    paid: estimate.paid,
    local: estimate.local,
    totalCost: estimate.cost,
    batchCost: perOutput === null ? null : Math.min(estimate.paid, effectiveBatchSize) * perOutput,
    requestedBatchSize: requested,
    effectiveBatchSize,
    batches: items.length ? Math.ceil(items.length / effectiveBatchSize) : 0,
    blocked,
    limitAdjusted: effectiveBatchSize < requested,
  };
}
