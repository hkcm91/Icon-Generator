/**
 * Shared Replicate helpers for the API routes.
 *
 * These run in two places: as Vercel serverless functions in `api/`, and mounted
 * into the local Express server for `npm run dev`. Both give an Express-shaped
 * (req, res), so the handlers are written once and adapted at the edges.
 *
 * The underscore prefix keeps this file out of Vercel's route table.
 */

export const API = 'https://api.replicate.com/v1';

/**
 * Resolve the token for this request.
 *
 * Two supported models, in priority order:
 *
 *  1. `REPLICATE_API_TOKEN` in the environment — the deployment owner's key.
 *     Everyone using that deployment spends the owner's credits, which is right
 *     for a private deployment and wrong for a public one.
 *  2. An `x-replicate-token` header sent by the browser — each visitor brings
 *     their own key. Necessary on serverless anyway: functions are stateless,
 *     so a token "saved" in one invocation does not exist in the next.
 */
export function resolveToken(request) {
  const header = request.headers?.['x-replicate-token'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  return process.env.REPLICATE_API_TOKEN || '';
}

export const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

export function requireToken(request, response) {
  const token = resolveToken(request);
  if (!token) {
    response.status(401).json({
      error: 'No Replicate API key. Add one with the key button in the header.',
      needsKey: true,
    });
    return null;
  }
  return token;
}

/** Confirm a token works and say who it belongs to. */
export async function checkToken(token) {
  const result = await fetch(`${API}/account`, { headers: authHeaders(token) });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error:
        result.status === 401
          ? 'Replicate rejected that token. Create a fresh one and try again.'
          : body.detail || `Replicate returned ${result.status}.`,
    };
  }
  return { ok: true, account: body.username || body.name || 'connected' };
}

/**
 * Create a prediction and return immediately.
 *
 * Deliberately does NOT wait for the result. A serverless function is capped
 * well below the minutes an image model can take, so anything that polls to
 * completion inside one request works locally and times out when deployed. The
 * client polls `/api/prediction` instead.
 */
export async function createPrediction(token, model, input) {
  const [owner, ...rest] = model.split('/');
  const endpoint = `${API}/models/${owner}/${rest.join('/')}/predictions`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const created = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ input: input ?? {} }),
    });
    const prediction = await created.json().catch(() => ({}));

    if (created.ok) return { ok: true, prediction };
    if (created.status === 401) {
      return { ok: false, status: 401, error: 'Replicate rejected the API token.' };
    }
    if (created.status === 404) {
      return {
        ok: false,
        status: 404,
        error: `Replicate has no model called "${model}".`,
      };
    }
    if (created.status !== 429) {
      return {
        ok: false,
        status: created.status,
        error: prediction.detail || prediction.error || `Replicate returned ${created.status}.`,
      };
    }
    // Rate limited on creation is routine on new accounts. Retry briefly — but
    // only briefly, since this request has a hard ceiling when deployed.
    const retryAfter = Number(created.headers.get('retry-after')) * 1000;
    await new Promise((done) => setTimeout(done, Math.max(1200, retryAfter || attempt * 1200)));
  }

  return { ok: false, status: 429, error: 'Replicate stayed rate limited. Try again shortly.' };
}

/** Rewrite delivery URLs through our own origin so canvases stay untainted. */
export const proxied = (url) => `/api/image?url=${encodeURIComponent(url)}`;

export function normalizeOutput(prediction) {
  const output = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
  const images = output.filter((entry) => typeof entry === 'string' && /^https?:\/\//.test(entry));
  if (images.length) {
    return { kind: 'images', images: images.map(proxied), raw: images };
  }
  // Token-streaming text models return an array of fragments.
  const text = Array.isArray(prediction.output)
    ? prediction.output.join('')
    : String(prediction.output ?? '');
  return { kind: 'text', text: text.trim() };
}
