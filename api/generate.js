import { createPrediction, requireToken } from './_replicate.js';

/**
 * Front Icon exposes GPT tiers explicitly, but always creates one output.
 * Invalid or omitted qualities fall back to Low at the API boundary.
 */
export function clampFrontIconCost(model, input) {
  const safe = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  if (model === 'openai/gpt-image-2' || model === 'openai/gpt-image-1.5') {
    safe.quality = ['low', 'medium', 'high'].includes(safe.quality) ? safe.quality : 'low';
    safe.number_of_images = 1;
  }
  return safe;
}

/** Start a prediction and hand back its id. The client polls /api/prediction. */
export default async function handler(request, response) {
  const token = requireToken(request, response);
  if (!token) return;

  const { model, input } = request.body ?? {};
  if (typeof model !== 'string' || !model.includes('/')) {
    return response.status(400).json({ error: 'Provide a model slug like "owner/name".' });
  }

  try {
    const created = await createPrediction(token, model, clampFrontIconCost(model, input));
    if (!created.ok) return response.status(created.status ?? 502).json({ error: created.error });
    response.json({ id: created.prediction.id, status: created.prediction.status });
  } catch (error) {
    response.status(502).json({ error: `Could not start generation: ${error.message}` });
  }
}
