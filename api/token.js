import { checkToken } from './_replicate.js';

/**
 * Validate a key without storing it.
 *
 * Storing it server-side is not possible on serverless — each invocation is a
 * fresh process — so the browser keeps it and attaches it per request. This
 * endpoint exists so a bad key is reported when it is entered rather than
 * surfacing later as a failed generation.
 */
export default async function handler(request, response) {
  const { token } = request.body ?? {};
  if (typeof token !== 'string' || !token.trim()) {
    return response.status(400).json({ error: 'Paste your Replicate API token.' });
  }
  const trimmed = token.trim();
  if (!trimmed.startsWith('r8_')) {
    return response
      .status(400)
      .json({ error: 'Replicate tokens start with r8_. Copy it from your API tokens page.' });
  }

  try {
    const result = await checkToken(trimmed);
    if (!result.ok) return response.status(result.status ?? 400).json({ error: result.error });
    response.json({ connected: true, account: result.account });
  } catch (error) {
    response.status(502).json({ error: `Could not reach Replicate: ${error.message}` });
  }
}
