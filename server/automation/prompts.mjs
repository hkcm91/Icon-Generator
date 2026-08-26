import { modelDefinition } from './catalog.mjs';

function subject(item) {
  return [item.concept || item.name, item.role && `${item.role} icon`, item.complexity && `${item.complexity} detail`]
    .filter(Boolean).join(', ');
}

function recipeSuffix(recipe, item) {
  return [
    recipe.family_prompt,
    `Internal composition variation ${item.key}: choose a distinct arrangement of decorative microdetails. Do not display or spell this key.`,
    recipe.negative_prompt ? `Avoid: ${recipe.negative_prompt}` : '',
  ].filter(Boolean).join('\n');
}

export function itemPrompt(recipe, item) {
  const glyph = subject(item);
  if (recipe.output_mode === 'complete') {
    return [
      `Create one polished app icon depicting ${glyph}.`,
      recipe.material ? `Container material and finish: ${recipe.material}.` : '',
      recipe.glyph_style ? `Glyph style: ${recipe.glyph_style}.` : '',
      recipe.master_url ? 'Match the supplied approved master closely for shape, palette, material, lighting, camera, and proportions.' : '',
      'Single forward-facing centered icon. No contact sheet, text, label, watermark, device, hand, scene, or mockup.',
      recipeSuffix(recipe, item),
    ].filter(Boolean).join(' ');
  }
  return [
    `Create only an isolated glyph depicting ${glyph}.`,
    recipe.glyph_style ? `Style: ${recipe.glyph_style}.` : '',
    recipe.material ? `Use this material language: ${recipe.material}.` : '',
    recipe.master_url ? 'Match the supplied master for colour, finish, lighting, and visual language, but do not reproduce its container.' : '',
    'Transparent exterior background. No container, tile, frame, squircle, circle, shadow plate, text, label, watermark, scene, device, or mockup.',
    recipeSuffix(recipe, item),
  ].filter(Boolean).join(' ');
}

export function providerInput(recipe, item) {
  const prompt = itemPrompt(recipe, item);
  const references = [recipe.master_url, ...recipe.reference_urls].filter(Boolean);
  const base = { prompt };
  if (recipe.model.startsWith('openai/gpt-image')) {
    return {
      ...base,
      aspect_ratio: '1:1',
      quality: recipe.quality,
      output_format: 'png',
      background: recipe.output_mode === 'transparent' && modelDefinition(recipe.model)?.alpha ? 'transparent' : 'opaque',
      ...(references.length ? { input_images: references } : {}),
    };
  }
  if (recipe.model.startsWith('google/nano-banana')) {
    return { ...base, aspect_ratio: '1:1', output_format: 'png', ...(references.length ? { image_input: references } : {}) };
  }
  if (recipe.model.startsWith('bytedance/seedream')) {
    return { ...base, size: 'custom', width: 1024, height: 1024, ...(references.length ? { image_input: references } : {}) };
  }
  return { ...base, aspect_ratio: '1:1', ...(references.length ? { image_input: references } : {}) };
}
