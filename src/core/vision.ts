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

import { describeImage } from './replicate';

export interface ThemeSuggestion {
  name: string;
  rationale: string;
  subjects: string[];
}

export interface ReferenceAnalysis {
  /** Literal object shown in the reference. Never becomes the next icon subject automatically. */
  subject: string;
  /** Transferable appearance only: material, palette, lighting, rendering and finish. */
  style: string;
  /** Plausible set directions the user may opt into. */
  themes: ThemeSuggestion[];
  /** Visual construction suggested by the reference, separate from its theme. */
  construction: 'filled-container' | 'open-frame-with-subject' | 'isolated-subject' | 'unknown';
}

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

const REFERENCE_PROMPT = [
  'Analyze this image as a style reference for a cohesive icon family.',
  'Return only valid JSON with this exact shape:',
  '{"subject":"short literal noun phrase","style":"transferable visual style","construction":"filled-container|open-frame-with-subject|isolated-subject|unknown","themes":[{"name":"theme name","rationale":"short reason","subjects":["subject 1","subject 2"]}]}',
  'The subject is the literal depicted object, such as "ghost".',
  'The style must describe only transferable appearance: transparency, material, palette, iridescence, lighting, dimensionality, edge treatment, texture, camera and rendering technique.',
  'Do not repeat the depicted subject or its anatomy in the style field.',
  'Use open-frame-with-subject when a finished example has a recognizable outer container envelope made from rims, swirls, bubbles or decoration while substantial interior areas remain truly transparent.',
  'Suggest 2 to 4 distinct plausible icon-set themes. Include an obvious semantic theme when appropriate, but also broader aesthetic or era-based themes such as Y2K or Frutiger Aero when visually supported.',
  'For every theme, suggest 6 to 10 varied objects that belong in that set. Do not make every suggestion a variation of the reference subject.',
  'No markdown fences and no commentary outside the JSON.',
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
  const text = await describeImage(model, visionInput(model, SYMBOL_PROMPT, imageDataUrl));
  return cleanSymbolAnswer(text);
}

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';

/** Parse vision output defensively: caption models sometimes wrap otherwise valid JSON. */
export function parseReferenceAnalysis(text: string): ReferenceAnalysis {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { subject: cleanSymbolAnswer(text), style: '', themes: [], construction: 'unknown' };

  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const themes = Array.isArray(raw.themes)
      ? raw.themes.slice(0, 4).map((entry) => {
          const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
          return {
            name: clean(item.name, 60),
            rationale: clean(item.rationale, 180),
            subjects: Array.isArray(item.subjects)
              ? item.subjects.map((subject) => clean(subject, 80)).filter(Boolean).slice(0, 10)
              : [],
          };
        }).filter((theme) => theme.name)
      : [];
    return {
      subject: clean(raw.subject, 100),
      style: clean(raw.style, 700),
      themes,
      construction:
        raw.construction === 'filled-container' ||
        raw.construction === 'open-frame-with-subject' ||
        raw.construction === 'isolated-subject'
          ? raw.construction
          : 'unknown',
    };
  } catch {
    return { subject: '', style: '', themes: [], construction: 'unknown' };
  }
}

/** One vision call separates what the reference depicts from what should transfer. */
export async function analyzeReference(
  imageDataUrl: string,
  model: string = DEFAULT_VISION_MODEL,
): Promise<ReferenceAnalysis> {
  const text = await describeImage(model, visionInput(model, REFERENCE_PROMPT, imageDataUrl));
  return parseReferenceAnalysis(text);
}
