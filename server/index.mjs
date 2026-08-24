/**
 * Replicate proxy.
 *
 * Two jobs, both of which have to happen off the browser:
 *
 *  1. Hold the API token. A token in client JS is a published token.
 *  2. Re-serve generated images same-origin. Replicate's delivery CDN does not
 *     send permissive CORS headers, so drawing those URLs straight into a
 *     canvas taints it and every subsequent getImageData() throws — which
 *     would take out compositing, background keying and the determinism hash
 *     all at once.
 */

import express from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env reader: avoids a dependency for four lines of parsing.
try {
  const text = readFileSync(resolve(here, '..', '.env'), 'utf8');
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // No .env file is fine; the token may come from the real environment.
}

const app = express();
// Conditioning images travel inline as base64 data URIs, so a request can
// legitimately carry a couple of PNGs alongside the prompt.
app.use(express.json({ limit: '24mb' }));

const PORT = Number(process.env.PORT || 8787);
const API = 'https://api.replicate.com/v1';

/**
 * The token, held in memory once set from the UI so it never has to be typed
 * into a file. It is never sent back to the browser — only whether one exists
 * and which account it belongs to.
 */
let sessionToken = '';
const token = () => sessionToken || process.env.REPLICATE_API_TOKEN || '';
const tokenSource = () => (sessionToken ? 'session' : process.env.REPLICATE_API_TOKEN ? 'env' : 'none');
const authHeaders = () => ({
  Authorization: `Bearer ${token()}`,
  'Content-Type': 'application/json',
});

const requireToken = (res) => {
  if (!token()) {
    res
      .status(400)
      .json({ error: 'No REPLICATE_API_TOKEN set. Copy .env.example to .env and add your token.' });
    return false;
  }
  return true;
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Whether a token is present, and whose it is. Never the token itself. */
app.get('/api/status', async (_request, response) => {
  if (!token()) return response.json({ connected: false, source: 'none' });
  try {
    const result = await fetch(`${API}/account`, { headers: authHeaders() });
    const body = await result.json().catch(() => ({}));
    response.json({
      connected: result.ok,
      source: tokenSource(),
      account: result.ok ? body.username || body.name || 'connected' : undefined,
      error: result.ok ? undefined : 'The saved token was rejected by Replicate.',
    });
  } catch {
    response.json({ connected: false, source: tokenSource(), error: 'Could not reach Replicate.' });
  }
});

/**
 * Accept a token from the UI.
 *
 * Validated against Replicate before it is kept, so a typo is reported here
 * rather than surfacing later as a failed generation. `remember` additionally
 * writes it to .env; without it the token lives only as long as the process,
 * which is the right default for something pasted into a browser.
 */
app.post('/api/token', async (request, response) => {
  const { token: candidate, remember } = request.body ?? {};
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return response.status(400).json({ error: 'Paste your Replicate API token.' });
  }
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('r8_')) {
    return response
      .status(400)
      .json({ error: 'Replicate tokens start with r8_. Copy it from your API tokens page.' });
  }

  try {
    const result = await fetch(`${API}/account`, {
      headers: { Authorization: `Bearer ${trimmed}`, 'Content-Type': 'application/json' },
    });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) {
      return response.status(result.status).json({
        error:
          result.status === 401
            ? 'Replicate rejected that token. Create a fresh one and try again.'
            : body.detail || `Replicate returned ${result.status}.`,
      });
    }

    sessionToken = trimmed;
    let saved = false;
    if (remember) {
      try {
        const envPath = resolve(here, '..', '.env');
        let existing = '';
        try {
          existing = readFileSync(envPath, 'utf8');
        } catch {
          // No .env yet; one is about to be created.
        }
        const without = existing
          .split('\n')
          .filter((line) => !/^\s*REPLICATE_API_TOKEN\s*=/.test(line))
          .join('\n')
          .replace(/\n+$/, '');
        writeFileSync(
          envPath,
          `${without ? `${without}\n` : ''}REPLICATE_API_TOKEN=${trimmed}\n`,
          { mode: 0o600 },
        );
        saved = true;
      } catch (error) {
        // Failing to persist must not invalidate a token that already works.
        console.warn('Could not write .env:', error.message);
      }
    }

    response.json({
      connected: true,
      account: body.username || body.name || 'connected',
      saved,
    });
  } catch (error) {
    response.status(502).json({ error: `Could not reach Replicate: ${error.message}` });
  }
});

/** Forget a session token. */
app.post('/api/token/clear', (_request, response) => {
  sessionToken = '';
  response.json({ connected: Boolean(token()), source: tokenSource() });
});

/** Confirm the token works before the user spends a generation finding out. */
app.get('/api/account', async (_request, response) => {
  if (!requireToken(response)) return;
  try {
    const result = await fetch(`${API}/account`, { headers: authHeaders() });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) {
      return response.status(result.status).json({
        error:
          result.status === 401
            ? 'Replicate rejected this token. Create a fresh one on your API tokens page.'
            : body.detail || `Replicate returned ${result.status}.`,
      });
    }
    response.json({ account: body.username || body.name || 'connected' });
  } catch (error) {
    response.status(502).json({ error: `Could not reach Replicate: ${error.message}` });
  }
});

/**
 * Create a prediction and poll it to completion.
 *
 * Replicate throttles prediction creation aggressively on new accounts, and a
 * 429 there is routine rather than exceptional, so creation retries with
 * backoff that respects Retry-After instead of failing the request.
 */
app.post('/api/generate', async (request, response) => {
  if (!requireToken(response)) return;

  const { model, input } = request.body ?? {};
  if (typeof model !== 'string' || !model.includes('/')) {
    return response.status(400).json({ error: 'Provide a model slug like "owner/name".' });
  }

  const [owner, ...rest] = model.split('/');
  const endpoint = `${API}/models/${owner}/${rest.join('/')}/predictions`;

  try {
    let prediction = null;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const created = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ input: input ?? {} }),
      });
      prediction = await created.json().catch(() => ({}));

      if (created.ok) break;
      if (created.status === 401) {
        return response.status(401).json({ error: 'Replicate rejected the saved API token.' });
      }
      if (created.status !== 429) {
        return response.status(created.status).json({
          error: prediction.detail || prediction.error || `Replicate returned ${created.status}.`,
        });
      }
      if (attempt === 8) {
        return response.status(429).json({ error: 'Replicate stayed rate limited after 8 retries.' });
      }
      const retryAfter = Number(created.headers.get('retry-after')) * 1000;
      await sleep(Math.max(1500, retryAfter || attempt * 2000));
    }

    const pollUrl = prediction?.urls?.get ?? `${API}/predictions/${prediction?.id}`;
    const deadline = Date.now() + 5 * 60 * 1000;

    while (prediction && (prediction.status === 'starting' || prediction.status === 'processing')) {
      if (Date.now() > deadline) {
        return response.status(504).json({ error: 'Generation timed out after 5 minutes.' });
      }
      await sleep(1200);
      const poll = await fetch(pollUrl, { headers: authHeaders() });
      prediction = await poll.json().catch(() => prediction);
    }

    if (!prediction || prediction.status !== 'succeeded') {
      return response
        .status(502)
        .json({ error: prediction?.error || `Generation ${prediction?.status ?? 'failed'}.` });
    }

    const output = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
    const images = output.filter((entry) => typeof entry === 'string');
    if (!images.length) {
      return response.status(502).json({ error: 'The model returned no image URL.' });
    }

    // Hand back same-origin URLs so the canvas stays untainted.
    response.json({
      images: images.map((url) => `/api/image?url=${encodeURIComponent(url)}`),
      raw: images,
      predictionId: prediction.id,
    });
  } catch (error) {
    response.status(502).json({ error: `Generation failed: ${error.message}` });
  }
});

/**
 * Run a vision-language model and return its text, not an image.
 *
 * Kept separate from /api/generate because the shapes differ: text models
 * stream their output as an array of token strings that must be joined, and
 * they have no image URL to proxy. Folding both into one handler made the
 * "did we get an image or a caption" check the caller's problem.
 */
app.post('/api/describe', async (request, response) => {
  if (!requireToken(response)) return;

  const { model, input } = request.body ?? {};
  if (typeof model !== 'string' || !model.includes('/')) {
    return response.status(400).json({ error: 'Provide a vision model slug like "owner/name".' });
  }

  const [owner, ...rest] = model.split('/');
  try {
    const created = await fetch(`${API}/models/${owner}/${rest.join('/')}/predictions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ input: input ?? {} }),
    });
    let prediction = await created.json().catch(() => ({}));

    if (!created.ok) {
      return response.status(created.status).json({
        error:
          created.status === 404
            ? `Replicate has no model called "${model}". Set a different vision model in All controls.`
            : prediction.detail || prediction.error || `Replicate returned ${created.status}.`,
      });
    }

    const pollUrl = prediction?.urls?.get ?? `${API}/predictions/${prediction?.id}`;
    const deadline = Date.now() + 90 * 1000;
    while (prediction && (prediction.status === 'starting' || prediction.status === 'processing')) {
      if (Date.now() > deadline) {
        return response.status(504).json({ error: 'The vision model timed out.' });
      }
      await sleep(1000);
      const poll = await fetch(pollUrl, { headers: authHeaders() });
      prediction = await poll.json().catch(() => prediction);
    }

    if (!prediction || prediction.status !== 'succeeded') {
      return response
        .status(502)
        .json({ error: prediction?.error || `Description ${prediction?.status ?? 'failed'}.` });
    }

    // Token-streaming models return an array of fragments; single-shot models
    // return one string.
    const output = prediction.output;
    const text = Array.isArray(output) ? output.join('') : String(output ?? '');
    response.json({ text: text.trim() });
  } catch (error) {
    response.status(502).json({ error: `Description failed: ${error.message}` });
  }
});

/** Re-serve a generated image from our own origin. */
app.get('/api/image', async (request, response) => {
  const url = String(request.query.url ?? '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return response.status(400).json({ error: 'Invalid image URL.' });
  }
  // Allowlist: this endpoint must not become a general-purpose fetcher.
  const allowed = ['replicate.delivery', 'replicate.com'];
  if (parsed.protocol !== 'https:' || !allowed.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    return response.status(403).json({ error: 'Only Replicate-hosted images may be proxied.' });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) return response.status(upstream.status).end();
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.status(502).json({ error: `Could not fetch the image: ${error.message}` });
  }
});

app.listen(PORT, () => {
  const state = token() ? 'token loaded' : 'NO TOKEN — set REPLICATE_API_TOKEN in .env';
  console.log(`Replicate proxy on http://127.0.0.1:${PORT} (${state})`);
});
