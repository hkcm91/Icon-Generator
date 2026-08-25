import { MAX_CONCURRENCY, MAX_ITEMS, modelDefinition } from './catalog.mjs';

const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

function itemKey(value, index) {
  const safe = text(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return safe || `icon-${index + 1}`;
}

export function normalizeRecipe(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const model = text(raw.model || 'openai/gpt-image-2', 120);
  if (!modelDefinition(model)) throw coded('UNSUPPORTED_MODEL', `Unsupported model: ${model}`);
  const quality = ['low', 'medium', 'high'].includes(raw.quality) ? raw.quality : 'low';
  const outputMode = raw.output_mode === 'complete' ? 'complete' : 'transparent';
  const sourceItems = Array.isArray(raw.items) ? raw.items : [];
  if (!sourceItems.length) throw coded('EMPTY_FAMILY', 'Provide at least one icon item.');
  if (sourceItems.length > MAX_ITEMS) throw coded('TOO_MANY_ITEMS', `A family may contain at most ${MAX_ITEMS} items.`);

  const seen = new Set();
  const items = sourceItems.map((entry, index) => {
    const object = typeof entry === 'string' ? { name: entry } : (entry ?? {});
    const name = text(object.name || object.concept, 160);
    if (!name) throw coded('INVALID_ITEM', `Item ${index + 1} needs a name or concept.`);
    let key = itemKey(object.id || name, index);
    while (seen.has(key)) key = `${key}-${index + 1}`;
    seen.add(key);
    return {
      key,
      name,
      concept: text(object.concept || name, 500),
      role: text(object.role, 120),
      complexity: text(object.complexity, 120),
    };
  });

  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.round(Number(raw.concurrency) || 1)));
  const references = Array.isArray(raw.reference_urls)
    ? raw.reference_urls.map((url) => text(url, 8000)).filter(isHttpsUrl).slice(0, 6)
    : [];
  const master = isHttpsUrl(raw.master_url) ? text(raw.master_url, 8000) : '';

  return {
    name: text(raw.name || 'AI icon family', 160),
    model,
    quality,
    output_mode: outputMode,
    material: text(raw.material, 1500),
    glyph_style: text(raw.glyph_style, 1200),
    family_prompt: text(raw.family_prompt, 2000),
    negative_prompt: text(raw.negative_prompt, 2000),
    master_url: master,
    reference_urls: references,
    concurrency,
    items,
  };
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
}

export function coded(code, message, details = undefined) {
  return Object.assign(new Error(message), { code, details });
}

export function publicError(error) {
  return {
    code: error?.code || 'AUTOMATION_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: Boolean(error?.retryable),
    details: error?.details,
  };
}
