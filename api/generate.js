import { createPrediction, requireToken } from './_replicate.js';

/**
 * Front Icon is a scale workflow, so GPT generation is always one Low output.
 * Enforce this at the API boundary as well as in React: an old open tab or
 * stale localStorage value must never be able to restore $0.128 High calls.
 */
export function clampFrontIconCost(model, input) {
  const safe = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  if (model === 'openai/gpt-image-2' || model === 'openai/gpt-image-1.5') {
    safe.quality = 'low';
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
