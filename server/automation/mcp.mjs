import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  cancelJob, exportManifest, getCapabilities, getJobView, listErrors, planFamily,
  retryItems, startFamily, waitForJob,
} from './service.mjs';
import { publicError } from './recipe.mjs';

const itemSchema = z.object({
  id: z.string().optional().describe('Stable icon id, such as weather-rain.'),
  name: z.string().min(1).describe('Human-readable icon name.'),
  concept: z.string().optional().describe('What the glyph should depict.'),
  role: z.string().optional().describe('Optional UI role, such as navigation or status.'),
  complexity: z.string().optional().describe('Optional detail direction, such as simple or ornate.'),
});

const recipeSchema = {
  name: z.string().optional().describe('Icon-family name.'),
  model: z.string().optional().describe('Supported image model slug. Omit to use GPT Image 2.'),
  quality: z.enum(['low', 'medium', 'high']).optional().describe('Paid output quality. Low is the safe default.'),
  output_mode: z.enum(['transparent', 'complete']).optional().describe('Transparent generates isolated glyph assets; complete asks the model for finished opaque icons.'),
  material: z.string().optional().describe('Family material, surface, palette, and lighting description.'),
  glyph_style: z.string().optional().describe('Shared glyph rendering style.'),
  family_prompt: z.string().optional().describe('Additional instructions shared by every icon.'),
  negative_prompt: z.string().optional().describe('Elements every output must avoid.'),
  master_url: z.string().url().optional().describe('HTTPS URL of the approved master reference.'),
  reference_urls: z.array(z.string().url()).max(6).optional().describe('Additional HTTPS appearance references.'),
  concurrency: z.number().int().min(1).max(3).optional().describe('Concurrent paid predictions. Default 1; maximum 3.'),
  items: z.array(itemSchema).min(1).max(300).describe('Icons to generate.'),
};

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const paidWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const stateWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function success(value, summary) {
  return { content: [{ type: 'text', text: summary || JSON.stringify(value) }], structuredContent: value };
}

function failure(error) {
  const value = publicError(error);
  return { content: [{ type: 'text', text: `${value.code}: ${value.message}` }], structuredContent: { error: value }, isError: true };
}

const safe = (handler) => async (args) => {
  try { return await handler(args); } catch (error) { return failure(error); }
};

export function createIconMcpServer(ownerKey = 'default') {
  const server = new McpServer(
    { name: 'front-icon-automation', version: '0.1.0' },
    { instructions: 'Plan before spending. Call icons_plan_family first, show its exact estimate to the user, and only call icons_start_family after approval. Always reuse a stable idempotency_key. For long jobs, call icons_wait_for_job or icons_get_job; inspect icons_list_job_errors before retrying. Transparent mode returns isolated glyph assets; complete mode returns model-rendered finished icons.' },
  );

  server.registerTool('icons_get_capabilities', {
    title: 'Get icon generator capabilities', description: 'List supported models, costs, output modes, limits, persistence, and configuration status.', inputSchema: {}, annotations: readOnly,
  }, safe(async () => {
    const value = getCapabilities();
    return success(value, `Icon automation supports ${value.models.length} models and up to ${value.max_items} items per family.`);
  }));

  server.registerTool('icons_plan_family', {
    title: 'Plan an icon family', description: 'Validate a complete icon-family recipe and return a signed 30-minute plan plus exact estimated maximum model cost. This does not start or charge for generation.', inputSchema: recipeSchema, annotations: readOnly,
  }, safe(async (args) => {
    const value = planFamily(args);
    return success(value, `Plan ${value.plan_id}: ${value.recipe.items.length} paid outputs, estimated $${value.estimate.estimated_cost_usd.toFixed(2)}. No generation has started.`);
  }));

  server.registerTool('icons_start_family', {
    title: 'Start an approved icon family', description: 'Start the exact signed plan after cost approval. Requires a stable idempotency key; repeating the same key returns the existing job instead of duplicating paid work.',
    inputSchema: {
      plan_token: z.string().min(20).describe('Signed token returned by icons_plan_family.'),
      max_cost_usd: z.number().nonnegative().describe('User-approved maximum cost; must cover the plan estimate.'),
      idempotency_key: z.string().min(3).max(160).describe('Stable unique key for this intended run.'),
    }, annotations: paidWrite,
  }, safe(async (args) => {
    const value = await startFamily(args, ownerKey);
    return success(value, `Started icon job ${value.job_id}; status ${value.status}.`);
  }));

  server.registerTool('icons_get_job', {
    title: 'Get icon job', description: 'Return current job progress, every item state, output links, prediction ids, and structured errors.',
    inputSchema: { job_id: z.string().uuid() }, annotations: readOnly,
  }, safe(async ({ job_id }) => {
    const value = await getJobView(job_id, ownerKey);
    return success(value, `Job ${job_id} is ${value.status}: ${value.progress.succeeded}/${value.progress.total} succeeded, ${value.progress.failed} failed.`);
  }));

  server.registerTool('icons_wait_for_job', {
    title: 'Wait for an icon job update', description: 'Long-poll for a job change for up to 50 seconds. Use after starting a job so provider failures surface without aggressive polling.',
    inputSchema: {
      job_id: z.string().uuid(), timeout_seconds: z.number().int().min(1).max(50).optional(),
      after_updated_at: z.string().optional().describe('Previous updated_at value. The call returns when it changes.'),
    }, annotations: readOnly,
  }, safe(async ({ job_id, timeout_seconds, after_updated_at }) => {
    const value = await waitForJob(job_id, ownerKey, timeout_seconds, after_updated_at);
    return success(value, `Job ${job_id} is ${value.status}: ${value.progress.succeeded}/${value.progress.total} succeeded, ${value.progress.failed} failed.`);
  }));

  server.registerTool('icons_list_job_errors', {
    title: 'List icon job errors', description: 'Return only actionable, structured per-icon errors from a job.',
    inputSchema: { job_id: z.string().uuid() }, annotations: readOnly,
  }, safe(async ({ job_id }) => {
    const value = await listErrors(job_id, ownerKey);
    return success(value, `${value.errors.length} failed item${value.errors.length === 1 ? '' : 's'} in job ${job_id}.`);
  }));

  server.registerTool('icons_retry_items', {
    title: 'Retry failed icons', description: 'Requeue selected failed icon keys, or every failed icon when item_keys is empty. Successful icons are never regenerated.',
    inputSchema: { job_id: z.string().uuid(), item_keys: z.array(z.string()).optional() }, annotations: paidWrite,
  }, safe(async ({ job_id, item_keys }) => {
    const value = await retryItems(job_id, item_keys ?? [], ownerKey);
    return success(value, `Retried failed items in job ${job_id}; status ${value.status}.`);
  }));

  server.registerTool('icons_cancel_job', {
    title: 'Cancel icon job', description: 'Cancel queued items and request cancellation of active provider predictions. Completed outputs are retained.',
    inputSchema: { job_id: z.string().uuid() }, annotations: stateWrite,
  }, safe(async ({ job_id }) => {
    const value = await cancelJob(job_id, ownerKey);
    return success(value, `Cancellation requested for job ${job_id}; status ${value.status}.`);
  }));

  server.registerTool('icons_export_manifest', {
    title: 'Export icon manifest', description: 'Return a portable JSON manifest containing completed persistent asset URLs and any item errors.',
    inputSchema: { job_id: z.string().uuid() }, annotations: readOnly,
  }, safe(async ({ job_id }) => {
    const value = await exportManifest(job_id, ownerKey);
    return success(value, `Manifest contains ${value.icons.length} completed icon${value.icons.length === 1 ? '' : 's'}.`);
  }));

  return server;
}
