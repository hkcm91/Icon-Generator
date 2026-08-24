/**
 * Local dev server.
 *
 * Deliberately thin: it mounts the same handlers Vercel runs as serverless
 * functions, so `npm run dev` and a deployment exercise identical code. The
 * previous version was a standalone Express app, which is how the deployed
 * build ended up with no API at all.
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import describe from '../api/describe.js';
import generate from '../api/generate.js';
import image from '../api/image.js';
import prediction from '../api/prediction.js';
import status from '../api/status.js';
import token from '../api/token.js';

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
  // No .env is fine — a key can be supplied from the browser instead.
}

const app = express();
// Conditioning images travel inline as base64 data URIs, so a request can
// legitimately carry a couple of PNGs alongside the prompt.
app.use(express.json({ limit: '24mb' }));

app.get('/api/status', status);
app.post('/api/token', token);
app.post('/api/generate', generate);
app.get('/api/prediction', prediction);
app.post('/api/describe', describe);
app.get('/api/image', image);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  const source = process.env.REPLICATE_API_TOKEN
    ? 'token from .env'
    : 'no .env token — add one in the app';
  console.log(`API on http://127.0.0.1:${PORT} (${source})`);
});
