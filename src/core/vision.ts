/**
 * Naming the subject of an uploaded master.
 *
 * This is the only part of master analysis that needs a model: palette,
 * gradient, finish and glyph presence are all measurable from the pixels, but
 * "a paper plane" is not recoverable from a histogram.
 *
 * The model slug is configurable rather than hardcoded. Vision models on
 * Replicate come and go, their input field names differ, and a wrong default
 * that fails silently is worse than one the user can correct — so a 404 is
 * reported plainly and the local description still stands on its own.
 */

export const DEFAULT_VISION_MODEL = 'yorickvp/llava-13b';

/** Field name each family expects for its image input. */
function visionInput(model: string, prompt: string, image: string): Record<string, unknown> {
  if (model.includes('llava') || model.includes('bakllava')) {
    return { image, prompt, max_tokens: 64, temperature: 0.1 };
  }
  if (model.includes('qwen') || model.includes('internvl') || model.includes('moondream')) {
    return { image, prompt, max_new_tokens: 64 };
  }
  if (model.includes('gpt') || model.includes('claude') || model.includes('gemini')) {
    return { image_input: [image], prompt, max_tokens: 64 };
  }
  return { image, prompt };
}

const SYMBOL_PROMPT = [
  'Look only at the symbol or pictogram in the centre of this app icon.',
  'Reply with a short noun phrase naming that symbol and nothing else.',
  'For example: "a paper plane", "a gear", "two overlapping speech bubbles".',
  'Do not mention the background, the container shape, colours, or style.',
  'If there is no symbol, reply exactly: none.',
].join(' ');

/**
 * Trim a model's answer down to the noun phrase.
 *
 * Caption models routinely wrap the answer in scaffolding ("The symbol in the
 * image appears to be a paper plane.") and adding that to a generation prompt
 * would describe an *image of a description*.
 */
export function cleanSymbolAnswer(text: string): string {
  let answer = text.trim().split('\n')[0].trim();
  answer = answer.replace(/^["'`]|["'`.]$/g, '').trim();
  answer = answer.replace(
    /^(the\s+)?(symbol|icon|image|pictogram)[^.]*?\b(is|shows|depicts|appears to be|contains)\b\s*/i,
    '',
  );
  answer = answer.replace(/^(it|this)\s+(is|shows|depicts)\s+/i, '');
  answer = answer.replace(/[.]+$/, '').trim();

  if (/^none$/i.test(answer) || answer.length < 2) return '';
  // A sentence, not a noun phrase — better to hand back nothing than noise.
  if (answer.split(/\s+/).length > 10) return '';
  return answer;
}

export async function nameSymbol(
  imageDataUrl: string,
  model: string = DEFAULT_VISION_MODEL,
): Promise<string> {
  const response = await fetch('/api/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: visionInput(model, SYMBOL_PROMPT, imageDataUrl) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Could not describe the image.');
  return cleanSymbolAnswer(String(payload.text ?? ''));
}
