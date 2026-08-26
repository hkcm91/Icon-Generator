// @ts-nocheck -- automation service is runtime JavaScript shared with serverless handlers.
import { beforeEach, describe, expect, it } from 'vitest';
import { estimateFamily } from '../server/automation/catalog.mjs';
import { normalizeRecipe } from '../server/automation/recipe.mjs';
import { signPayload, verifyPayload, verifyWebhook, webhookToken } from '../server/automation/security.mjs';
import { createJob, findByIdempotency, getItems, newItem, resetMemoryStore } from '../server/automation/store.mjs';
import { planFamily } from '../server/automation/service.mjs';

beforeEach(() => resetMemoryStore());

describe('automation recipe', () => {
  it('normalizes a family and produces stable unique item keys', () => {
    const recipe = normalizeRecipe({ items: [{ name: 'Rain' }, { name: 'Rain' }], concurrency: 99 });
    expect(recipe.items.map((item) => item.key)).toEqual(['rain', 'rain-2']);
    expect(recipe.concurrency).toBe(3);
    expect(recipe.quality).toBe('low');
  });

  it('rejects unknown models before any paid request', () => {
    expect(() => normalizeRecipe({ model: 'made/up', items: [{ name: 'Rain' }] })).toThrow(/Unsupported model/);
  });

  it('calculates the entire paid batch cost', () => {
    const recipe = normalizeRecipe({ model: 'openai/gpt-image-2', quality: 'medium', items: ['One', 'Two', 'Three'] });
    expect(estimateFamily(recipe).estimated_cost_usd).toBe(0.141);
  });
});

describe('signed plans and webhooks', () => {
  it('round trips signed payloads and rejects tampering', () => {
    const token = signPayload({ hello: 'world' });
    expect(verifyPayload(token)).toEqual({ hello: 'world' });
    expect(() => verifyPayload(`${token}x`)).toThrow(/invalid/i);
  });

  it('binds a webhook token to one exact job item', () => {
    const token = webhookToken('job-a', 'item-a');
    expect(verifyWebhook(token, 'job-a', 'item-a')).toBe(true);
    expect(verifyWebhook(token, 'job-a', 'item-b')).toBe(false);
  });

  it('creates a costed plan without starting generation', () => {
    const plan = planFamily({ name: 'Weather', items: [{ name: 'Sun' }, { name: 'Rain' }] });
    expect(plan.recipe.items).toHaveLength(2);
    expect(plan.estimate.estimated_cost_usd).toBe(0.024);
    expect(verifyPayload(plan.plan_token).kind).toBe('icon-family-plan');
  });
});

describe('memory job store', () => {
  it('enforces idempotency lookup and keeps per-item state', async () => {
    const now = new Date().toISOString();
    const job = { id: crypto.randomUUID(), owner_key: 'default', idempotency_key: 'weather-v1', created_at: now };
    const item = newItem(job.id, 0, { key: 'sun', name: 'Sun' });
    await createJob(job, [item]);
    expect((await findByIdempotency('default', 'weather-v1')).id).toBe(job.id);
    expect((await getItems(job.id))[0].item_key).toBe('sun');
  });
});
