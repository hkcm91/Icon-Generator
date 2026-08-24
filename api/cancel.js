import { API, authHeaders, requireToken } from './_replicate.js';

export default async function handler(request, response) {
  const token = requireToken(request, response);
  if (!token) return;
  const id = String(request.body?.id ?? '');
  if (!/^[A-Za-z0-9]+$/.test(id)) return response.status(400).json({ error: 'Provide a prediction id.' });
  try {
    const result = await fetch(`${API}/predictions/${id}/cancel`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) return response.status(result.status).json({ error: body.detail || `Replicate returned ${result.status}.` });
    response.json({ canceled: true, id });
  } catch (error) {
    response.status(502).json({ error: `Could not cancel generation: ${error.message}` });
  }
}
