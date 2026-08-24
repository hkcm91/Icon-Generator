import { API, authHeaders, normalizeOutput, requireToken } from './_replicate.js';

/**
 * One poll of a prediction.
 *
 * Returns immediately whatever the current state is, so no request is ever
 * long-lived. Waiting is the client's job, which is what keeps this inside a
 * serverless function's time limit however long the model takes.
 */
export default async function handler(request, response) {
  const token = requireToken(request, response);
  if (!token) return;

  const id = String(request.query?.id ?? '');
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    return response.status(400).json({ error: 'Provide a prediction id.' });
  }

  try {
    const result = await fetch(`${API}/predictions/${id}`, { headers: authHeaders(token) });
    const prediction = await result.json().catch(() => ({}));
    if (!result.ok) {
      return response
        .status(result.status)
        .json({ error: prediction.detail || `Replicate returned ${result.status}.` });
    }

    if (prediction.status === 'succeeded') {
      return response.json({ status: 'succeeded', ...normalizeOutput(prediction) });
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return response.json({
        status: prediction.status,
        error: prediction.error || `Generation ${prediction.status}.`,
      });
    }
    response.json({ status: prediction.status || 'processing' });
  } catch (error) {
    response.status(502).json({ error: `Could not check generation: ${error.message}` });
  }
}
