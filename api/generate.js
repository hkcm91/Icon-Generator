import { createPrediction, requireToken } from './_replicate.js';

/** Start a prediction and hand back its id. The client polls /api/prediction. */
export default async function handler(request, response) {
  const token = requireToken(request, response);
  if (!token) return;

  const { model, input } = request.body ?? {};
  if (typeof model !== 'string' || !model.includes('/')) {
    return response.status(400).json({ error: 'Provide a model slug like "owner/name".' });
  }

  try {
    const created = await createPrediction(token, model, input);
    if (!created.ok) return response.status(created.status ?? 502).json({ error: created.error });
    response.json({ id: created.prediction.id, status: created.prediction.status });
  } catch (error) {
    response.status(502).json({ error: `Could not start generation: ${error.message}` });
  }
}
