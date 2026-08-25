import { randomUUID } from 'node:crypto';
import { API, authHeaders, createPrediction } from '../../api/_replicate.js';
import { capabilities, estimateFamily } from './catalog.mjs';
import { persistRemoteAsset } from './assets.mjs';
import { providerInput } from './prompts.mjs';
import { coded, normalizeRecipe, publicError } from './recipe.mjs';
import { signPayload, verifyPayload, verifyWebhook, webhookToken } from './security.mjs';
import {
  cancelQueued, claimItems, createJob, failQueued, findByIdempotency, getItems, getJob, newItem,
  requeueItems, storeKind, updateItem, updateJob,
} from './store.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function publicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${Number(process.env.PORT || 8787)}`;
}

function providerToken() {
  if (!process.env.REPLICATE_API_TOKEN) throw coded('GENERATION_NOT_CONFIGURED', 'REPLICATE_API_TOKEN is required for unattended MCP generation.');
  return process.env.REPLICATE_API_TOKEN;
}

export function getCapabilities() {
  return { ...capabilities(), job_store: storeKind() };
}

export function planFamily(input) {
  const recipe = normalizeRecipe(input);
  const estimate = estimateFamily(recipe);
  const plan = {
    kind: 'icon-family-plan', plan_id: randomUUID(), recipe, estimate,
    created_at: Date.now(), expires_at: Date.now() + 30 * 60 * 1000,
  };
  return { plan_id: plan.plan_id, plan_token: signPayload(plan), expires_at: new Date(plan.expires_at).toISOString(), recipe, estimate };
}

export async function startFamily({ plan_token: planToken, max_cost_usd: maxCostUsd, idempotency_key: idempotencyKey }, ownerKey = 'default') {
  providerToken();
  if (storeKind() === 'memory' && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
    throw coded('PERSISTENCE_NOT_CONFIGURED', 'Supabase persistence is required for production MCP generation.');
  }
  const plan = verifyPayload(planToken);
  if (plan.kind !== 'icon-family-plan') throw coded('INVALID_PLAN', 'That token is not an icon-family plan.');
  const estimate = Number(plan.estimate.estimated_cost_usd);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < estimate) {
    throw coded('BUDGET_NOT_APPROVED', `This plan is estimated at $${estimate.toFixed(2)}; max_cost_usd must approve at least that amount.`, { estimate });
  }
  const safeIdempotency = String(idempotencyKey || '').trim().slice(0, 160);
  if (!safeIdempotency) throw coded('IDEMPOTENCY_REQUIRED', 'Provide a stable idempotency_key so retries cannot duplicate paid work.');
  const existing = await findByIdempotency(ownerKey, safeIdempotency);
  if (existing) return jobView(existing, await getItems(existing.id));

  const now = new Date().toISOString();
  const id = randomUUID();
  const job = {
    id, owner_key: ownerKey, idempotency_key: safeIdempotency, name: plan.recipe.name,
    status: 'queued', recipe: plan.recipe, estimate: plan.estimate, max_cost_usd: maxCostUsd,
    error: null, created_at: now, updated_at: now, completed_at: null,
  };
  const items = plan.recipe.items.map((item, ordinal) => newItem(id, ordinal, item));
  await createJob(job, items);
  await fillSlots(id);
  return getJobView(id, ownerKey);
}

export async function fillSlots(jobId) {
  const job = await getJob(jobId);
  if (!job || job.status === 'canceling' || TERMINAL.has(job.status)) return;
  const all = await getItems(jobId);
  const active = all.filter((item) => item.status === 'starting' || item.status === 'running').length;
  const available = Math.max(0, job.recipe.concurrency - active);
  if (!available) return;
  const claimed = await claimItems(jobId, available);
  if (!claimed.length) return refreshJob(jobId);
  await updateJob(jobId, { status: 'running' });

  let startFailures = 0;
  await Promise.all(claimed.map(async (item) => {
    try {
      const token = webhookToken(jobId, item.id);
      const webhook = `${publicBaseUrl()}/api/automation-webhook?job=${encodeURIComponent(jobId)}&item=${encodeURIComponent(item.id)}&token=${encodeURIComponent(token)}`;
      const created = await createPrediction(providerToken(), job.recipe.model, providerInput(job.recipe, item.payload), {
        webhook, webhookEventsFilter: ['completed'],
      });
      if (!created.ok) throw Object.assign(new Error(created.error), {
        code: created.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_START_FAILED',
        retryable: created.status === 429 || Number(created.status) >= 500,
      });
      await updateItem(item.id, { status: 'running', provider_prediction_id: created.prediction.id });
    } catch (error) {
      startFailures++;
      await updateItem(item.id, { status: 'failed', error: publicError(error) });
    }
  }));
  if (startFailures) {
    await failQueued(jobId, {
      code: 'BATCH_START_STOPPED',
      message: 'Remaining queued items were not started because the provider rejected an earlier start. Retry the failed items when the provider is available.',
      retryable: true,
    });
  }
  await refreshJob(jobId);
}

export async function acceptWebhook({ jobId, itemId, token, prediction }) {
  if (!verifyWebhook(token, jobId, itemId)) throw coded('INVALID_WEBHOOK', 'Webhook authentication failed.');
  const status = prediction?.status;
  if (!TERMINAL.has(status)) return { accepted: true, terminal: false };
  const item = (await getItems(jobId)).find((entry) => entry.id === itemId);
  if (!item) throw coded('ITEM_NOT_FOUND', 'The webhook item no longer exists.');
  if (TERMINAL.has(item.status)) return { accepted: true, terminal: true, duplicate: true };

  if (status === 'succeeded') {
    const raw = (Array.isArray(prediction.output) ? prediction.output : [prediction.output])
      .filter((entry) => typeof entry === 'string' && /^https:\/\//.test(entry));
    if (!raw.length) {
      await updateItem(itemId, { status: 'failed', error: { code: 'NO_IMAGE_OUTPUT', message: 'The provider completed without returning an image.', retryable: true } });
    } else {
      try {
        const urls = await Promise.all(raw.map((url, index) => persistRemoteAsset(url, `${jobId}/${item.item_key}-${index + 1}.png`)));
        await updateItem(itemId, { status: 'succeeded', output_urls: urls, error: null });
      } catch (error) {
        await updateItem(itemId, { status: 'failed', error: publicError(error) });
      }
    }
  } else {
    await updateItem(itemId, {
      status,
      error: status === 'failed'
        ? { code: 'PROVIDER_FAILED', message: String(prediction.error || 'The provider reported a generation failure.'), retryable: true }
        : { code: 'CANCELED', message: 'Generation was canceled.', retryable: false },
    });
  }
  await refreshJob(jobId);
  await fillSlots(jobId);
  return { accepted: true, terminal: true };
}

export async function refreshJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return null;
  const items = await getItems(jobId);
  const counts = countStates(items);
  let status = job.status;
  if (counts.running || counts.starting || counts.queued) status = job.status === 'canceling' ? 'canceling' : 'running';
  else if (counts.failed && counts.succeeded) status = 'partial';
  else if (counts.failed) status = 'failed';
  else if (counts.canceled && !counts.succeeded) status = 'canceled';
  else status = 'succeeded';
  const terminal = ['partial', 'failed', 'canceled', 'succeeded'].includes(status);
  return updateJob(jobId, { status, completed_at: terminal ? new Date().toISOString() : null });
}

export async function getJobView(jobId, ownerKey = 'default') {
  const job = await getJob(jobId, ownerKey);
  if (!job) throw coded('JOB_NOT_FOUND', 'No accessible icon-generation job has that id.');
  return jobView(job, await getItems(jobId));
}

export async function waitForJob(jobId, ownerKey = 'default', timeoutSeconds = 45, after = '') {
  const deadline = Date.now() + Math.max(1, Math.min(50, timeoutSeconds)) * 1000;
  for (;;) {
    const view = await getJobView(jobId, ownerKey);
    if (!after || view.updated_at !== after || ['partial', 'failed', 'canceled', 'succeeded'].includes(view.status) || Date.now() >= deadline) return view;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function cancelJob(jobId, ownerKey = 'default') {
  const job = await getJob(jobId, ownerKey);
  if (!job) throw coded('JOB_NOT_FOUND', 'No accessible icon-generation job has that id.');
  await updateJob(jobId, { status: 'canceling' });
  await cancelQueued(jobId);
  const running = (await getItems(jobId)).filter((item) => item.status === 'running' && item.provider_prediction_id);
  await Promise.allSettled(running.map((item) => fetch(`${API}/predictions/${item.provider_prediction_id}/cancel`, { method: 'POST', headers: authHeaders(providerToken()) })));
  await refreshJob(jobId);
  return getJobView(jobId, ownerKey);
}

export async function retryItems(jobId, keys, ownerKey = 'default') {
  const job = await getJob(jobId, ownerKey);
  if (!job) throw coded('JOB_NOT_FOUND', 'No accessible icon-generation job has that id.');
  const count = await requeueItems(jobId, Array.isArray(keys) ? keys : []);
  if (!count) throw coded('NOTHING_TO_RETRY', 'No matching failed items were found.');
  await updateJob(jobId, { status: 'queued', completed_at: null });
  await fillSlots(jobId);
  return getJobView(jobId, ownerKey);
}

export async function listErrors(jobId, ownerKey = 'default') {
  const view = await getJobView(jobId, ownerKey);
  return { job_id: jobId, status: view.status, errors: view.items.filter((item) => item.error).map((item) => ({ item_key: item.item_key, name: item.name, attempt: item.attempt, ...item.error })) };
}

export async function exportManifest(jobId, ownerKey = 'default') {
  const view = await getJobView(jobId, ownerKey);
  return {
    schema_version: 1, generated_at: new Date().toISOString(), job_id: jobId,
    family_name: view.name, status: view.status, model: view.model, quality: view.quality,
    output_mode: view.output_mode,
    icons: view.items.filter((item) => item.output_urls.length).map((item) => ({ id: item.item_key, name: item.name, files: item.output_urls })),
    errors: view.items.filter((item) => item.error).map((item) => ({ id: item.item_key, error: item.error })),
  };
}

function countStates(items) {
  const counts = { queued: 0, starting: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

function jobView(job, items) {
  return {
    job_id: job.id, name: job.name, status: job.status, model: job.recipe.model, quality: job.recipe.quality,
    output_mode: job.recipe.output_mode, estimate: job.estimate, max_cost_usd: job.max_cost_usd,
    created_at: job.created_at, updated_at: job.updated_at, completed_at: job.completed_at,
    progress: { total: items.length, ...countStates(items) },
    items: items.map((item) => ({
      item_key: item.item_key, name: item.payload.name, status: item.status, attempt: item.attempt,
      prediction_id: item.provider_prediction_id, output_urls: item.output_urls ?? [], error: item.error,
    })),
  };
}
