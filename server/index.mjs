/**
 * Local dev server.
 *
 * Deliberately thin: it mounts the same handlers Vercel runs as serverless
 * functions, so `npm run dev` and a deployment exercise identical code. The
 * previous version was a standalone Express app, which is how the deployed
 * build ended up with no API at all.
 */

import express from 'express';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';

import describe from '../api/describe.js';
import cancel from '../api/cancel.js';
import generate from '../api/generate.js';
import image from '../api/image.js';
import prediction from '../api/prediction.js';
import status from '../api/status.js';
import token from '../api/token.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const codexJobsDirectory = resolve(root, 'codex-jobs');

function safeSegment(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
}

function safeSlug(value) {
  return String(value || 'icon-family')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'icon-family';
}

function referenceExtension(mime) {
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/jpeg') return '.jpg';
  return '.png';
}

function writeDataUrl(source, targetWithoutExtension) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(source || ''));
  if (!match || !match[1].startsWith('image/')) throw new Error('A Codex reference was not a valid image data URL.');
  const target = `${targetWithoutExtension}${referenceExtension(match[1])}`;
  writeFileSync(target, Buffer.from(match[2], 'base64'));
  return target;
}

function readCodexJob(jobId) {
  if (!safeSegment(jobId)) return null;
  const directory = resolve(codexJobsDirectory, jobId);
  const manifestPath = resolve(directory, 'job.json');
  if (!existsSync(manifestPath)) return null;
  return { directory, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) };
}

function codexJobStatus(jobId) {
  const job = readCodexJob(jobId);
  if (!job) return null;
  const resultsDirectory = resolve(job.directory, 'results');
  const files = existsSync(resultsDirectory)
    ? readdirSync(resultsDirectory).filter((name) => /^[-a-zA-Z0-9_]+\.(?:png|webp|jpe?g)$/i.test(name))
    : [];
  const cards = Array.isArray(job.manifest.cards) ? job.manifest.cards : [];
  const results = cards.flatMap((card) => {
    const filename = files.find((name) => name.replace(/\.[^.]+$/, '').toLowerCase() === String(card.id).toLowerCase());
    return filename ? [{
      id: card.id,
      filename,
      // Keep the browser on its current origin. In development Vite proxies
      // this path to port 8787; an absolute API-port URL would taint canvases
      // and make previews, persistence, and export fail.
      url: `/api/codex-local/jobs/${jobId}/results/${filename}`,
    }] : [];
  });
  return {
    id: jobId,
    path: job.directory,
    total: cards.length,
    ready: results.length,
    complete: cards.length > 0 && results.length === cards.length,
    cards: cards.map(({ id, name, outputMode, nextRevision }) => ({ id, name, outputMode, nextRevision })),
    results,
  };
}

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
app.use(express.json({ limit: '64mb' }));

app.get('/api/status', status);
app.post('/api/token', token);
app.post('/api/generate', generate);
app.post('/api/cancel', cancel);
app.get('/api/prediction', prediction);
app.post('/api/describe', describe);
app.get('/api/image', image);

// Local-only handoff for Codex/ChatGPT image generation. These routes exist in
// the development server, never in the Vercel serverless API. A selected batch
// is written into the repository, and the browser imports correctly named files
// from the job's results folder as they appear.
app.get('/api/codex-local/health', (_request, response) => {
  mkdirSync(codexJobsDirectory, { recursive: true });
  response.json({ available: true, jobsDirectory: codexJobsDirectory });
});

app.post('/api/codex-local/jobs', (request, response) => {
  try {
    const incoming = request.body;
    if (!incoming || incoming.version !== 1 || !Array.isArray(incoming.cards) || !incoming.cards.length) {
      response.status(400).json({ error: 'A local Codex job needs at least one selected card.' });
      return;
    }
    if (incoming.cards.length > 300) {
      response.status(400).json({ error: 'A local Codex job can contain at most 300 cards.' });
      return;
    }
    if (incoming.cards.some((card) => !safeSegment(card.id))) {
      response.status(400).json({ error: 'One or more card ids cannot be used as safe result filenames.' });
      return;
    }

    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const jobId = `${stamp}-${safeSlug(incoming.familyName)}`;
    const directory = resolve(codexJobsDirectory, jobId);
    const referencesDirectory = resolve(directory, 'references');
    const resultsDirectory = resolve(directory, 'results');
    mkdirSync(referencesDirectory, { recursive: true });
    mkdirSync(resultsDirectory, { recursive: true });

    const references = (Array.isArray(incoming.references) ? incoming.references : []).map((reference, index) => {
      const base = `${String(index + 1).padStart(2, '0')}-${safeSlug(reference.name || reference.role || 'reference')}`;
      const written = writeDataUrl(reference.dataUrl, resolve(referencesDirectory, base));
      return {
        name: reference.name,
        role: reference.role,
        file: `references/${written.split(/[\\/]/).pop()}`,
      };
    });
    const manifest = { ...incoming, id: jobId, references };
    writeFileSync(resolve(directory, 'job.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeFileSync(resolve(directory, 'README.txt'), [
      'ICON GENERATOR LOCAL CODEX JOB',
      '',
      'Ask Codex to process job.json with image generation.',
      'Save one image for every card at its exact outputFile path.',
      'Keep this Icon Generator page open; completed files are imported automatically.',
      '',
      `Cards: ${incoming.cards.length}`,
    ].join('\n'), 'utf8');

    response.json(codexJobStatus(jobId));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Could not create local Codex job.' });
  }
});

app.get('/api/codex-local/jobs/:jobId', (request, response) => {
  const status = codexJobStatus(request.params.jobId);
  if (!status) {
    response.status(404).json({ error: 'Local Codex job not found.' });
    return;
  }
  response.set('cache-control', 'no-store').json(status);
});

app.get('/api/codex-local/jobs/:jobId/results/:filename', (request, response) => {
  if (!safeSegment(request.params.jobId) || !/^[-a-zA-Z0-9_]+\.(?:png|webp|jpe?g)$/i.test(request.params.filename)) {
    response.status(400).end();
    return;
  }
  const job = readCodexJob(request.params.jobId);
  if (!job) {
    response.status(404).end();
    return;
  }
  const target = resolve(job.directory, 'results', request.params.filename);
  if (!existsSync(target) || !['.png', '.webp', '.jpg', '.jpeg'].includes(extname(target).toLowerCase())) {
    response.status(404).end();
    return;
  }
  response.set('cache-control', 'no-store').sendFile(target);
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  const source = process.env.REPLICATE_API_TOKEN
    ? 'token from .env'
    : 'no .env token — add one in the app';
  console.log(`API on http://127.0.0.1:${PORT} (${source})`);
});
