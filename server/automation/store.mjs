import { randomUUID } from 'node:crypto';

const memory = { jobs: new Map(), items: new Map() };

const configured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const api = (path) => `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
const headers = (prefer) => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  ...(prefer ? { Prefer: prefer } : {}),
});

async function request(path, options = {}) {
  const response = await fetch(api(path), { ...options, headers: { ...headers(options.prefer), ...(options.headers ?? {}) } });
  if (!response.ok) {
    const body = await response.text();
    throw Object.assign(new Error(`Job store request failed (${response.status}): ${body.slice(0, 500)}`), {
      code: 'JOB_STORE_ERROR', retryable: response.status >= 500,
    });
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export function storeKind() {
  return configured() ? 'supabase' : 'memory';
}

export async function createJob(job, items) {
  if (!configured()) {
    memory.jobs.set(job.id, structuredClone(job));
    memory.items.set(job.id, items.map((item) => structuredClone(item)));
    return job;
  }
  await request('icon_automation_jobs', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(job) });
  await request('icon_automation_items', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(items) });
  return job;
}

export async function findByIdempotency(ownerKey, idempotencyKey) {
  if (!idempotencyKey) return null;
  if (!configured()) {
    return [...memory.jobs.values()].find((job) => job.owner_key === ownerKey && job.idempotency_key === idempotencyKey) ?? null;
  }
  const rows = await request(`icon_automation_jobs?owner_key=eq.${encodeURIComponent(ownerKey)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`);
  return rows?.[0] ?? null;
}

export async function getJob(jobId, ownerKey = null) {
  if (!configured()) {
    const job = memory.jobs.get(jobId);
    return job && (!ownerKey || job.owner_key === ownerKey) ? structuredClone(job) : null;
  }
  const owner = ownerKey ? `&owner_key=eq.${encodeURIComponent(ownerKey)}` : '';
  const rows = await request(`icon_automation_jobs?id=eq.${encodeURIComponent(jobId)}${owner}&limit=1`);
  return rows?.[0] ?? null;
}

export async function getItems(jobId) {
  if (!configured()) return (memory.items.get(jobId) ?? []).map((item) => structuredClone(item));
  return request(`icon_automation_items?job_id=eq.${encodeURIComponent(jobId)}&order=ordinal.asc`);
}

export async function updateJob(jobId, patch) {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (!configured()) {
    const current = memory.jobs.get(jobId);
    if (!current) return null;
    Object.assign(current, next);
    return structuredClone(current);
  }
  const rows = await request(`icon_automation_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(next),
  });
  return rows?.[0] ?? null;
}

export async function updateItem(itemId, patch) {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (!configured()) {
    for (const entries of memory.items.values()) {
      const item = entries.find((entry) => entry.id === itemId);
      if (item) { Object.assign(item, next); return structuredClone(item); }
    }
    return null;
  }
  const rows = await request(`icon_automation_items?id=eq.${encodeURIComponent(itemId)}`, {
    method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(next),
  });
  return rows?.[0] ?? null;
}

export async function claimItems(jobId, limit) {
  if (!configured()) {
    const entries = memory.items.get(jobId) ?? [];
    const claimed = entries.filter((item) => item.status === 'queued').slice(0, limit);
    for (const item of claimed) {
      item.status = 'starting';
      item.attempt += 1;
      item.updated_at = new Date().toISOString();
    }
    return claimed.map((item) => structuredClone(item));
  }
  return request('rpc/icon_automation_claim_items', {
    method: 'POST', body: JSON.stringify({ p_job_id: jobId, p_limit: limit }),
  });
}

export async function cancelQueued(jobId) {
  if (!configured()) {
    for (const item of memory.items.get(jobId) ?? []) {
      if (item.status === 'queued' || item.status === 'starting') item.status = 'canceled';
    }
    return;
  }
  await request(`icon_automation_items?job_id=eq.${encodeURIComponent(jobId)}&status=in.(queued,starting)`, {
    method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'canceled', updated_at: new Date().toISOString() }),
  });
}

export async function failQueued(jobId, error) {
  if (!configured()) {
    for (const item of memory.items.get(jobId) ?? []) {
      if (item.status === 'queued' || item.status === 'starting') {
        Object.assign(item, { status: 'failed', error, updated_at: new Date().toISOString() });
      }
    }
    return;
  }
  await request(`icon_automation_items?job_id=eq.${encodeURIComponent(jobId)}&status=in.(queued,starting)`, {
    method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'failed', error, updated_at: new Date().toISOString() }),
  });
}

export async function requeueItems(jobId, keys) {
  const allowed = new Set(keys);
  if (!configured()) {
    let count = 0;
    for (const item of memory.items.get(jobId) ?? []) {
      if (item.status === 'failed' && (!allowed.size || allowed.has(item.item_key))) {
        Object.assign(item, { status: 'queued', error: null, provider_prediction_id: null, output_urls: [], updated_at: new Date().toISOString() });
        count++;
      }
    }
    return count;
  }
  const all = await getItems(jobId);
  const ids = all.filter((item) => item.status === 'failed' && (!allowed.size || allowed.has(item.item_key))).map((item) => item.id);
  if (!ids.length) return 0;
  await request(`icon_automation_items?id=in.(${ids.join(',')})`, {
    method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'queued', error: null, provider_prediction_id: null, output_urls: [], updated_at: new Date().toISOString() }),
  });
  return ids.length;
}

export function newItem(jobId, ordinal, payload) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), job_id: jobId, item_key: payload.key, ordinal, payload,
    status: 'queued', attempt: 0, provider_prediction_id: null, output_urls: [], error: null,
    created_at: now, updated_at: now,
  };
}

export function resetMemoryStore() {
  memory.jobs.clear();
  memory.items.clear();
}
