export const MODEL_CATALOG = Object.freeze({
  'openai/gpt-image-2': { label: 'GPT Image 2', costs: { low: 0.012, medium: 0.047, high: 0.128 }, alpha: true },
  'google/nano-banana-pro': { label: 'Nano Banana Pro', costs: { low: 0.15, medium: 0.15, high: 0.15 }, alpha: false },
  'google/nano-banana': { label: 'Nano Banana', costs: { low: 0.039, medium: 0.039, high: 0.039 }, alpha: false },
  'bytedance/seedream-4': { label: 'Seedream 4', costs: { low: 0.03, medium: 0.03, high: 0.03 }, alpha: false },
});

export const MAX_ITEMS = 300;
export const MAX_CONCURRENCY = 3;

export function modelDefinition(model) {
  return MODEL_CATALOG[model] ?? null;
}

export function estimateFamily(recipe) {
  const definition = modelDefinition(recipe.model);
  if (!definition) throw Object.assign(new Error(`Unsupported model: ${recipe.model}`), { code: 'UNSUPPORTED_MODEL' });
  const perOutput = definition.costs[recipe.quality];
  const paid = recipe.items.length;
  return {
    model: recipe.model,
    quality: recipe.quality,
    paid_outputs: paid,
    local_outputs: 0,
    estimated_cost_usd: Number((paid * perOutput).toFixed(4)),
    per_output_cost_usd: perOutput,
  };
}

export function capabilities() {
  return {
    version: 1,
    transport: 'streamable-http',
    max_items: MAX_ITEMS,
    max_concurrency: MAX_CONCURRENCY,
    output_modes: ['transparent', 'complete'],
    models: Object.entries(MODEL_CATALOG).map(([slug, value]) => ({ slug, ...value })),
    persistence: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'memory',
    generation_configured: Boolean(process.env.REPLICATE_API_TOKEN),
  };
}
