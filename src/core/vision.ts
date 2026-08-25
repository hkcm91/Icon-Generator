/**
 * Naming the subject of an uploaded master.
 *
 * Semantic master analysis needs a model: palette and basic finish are still
 * measured locally, while subject identity and role-specific optical texture
 * descriptions are not recoverable from a histogram.
 *
 * The model slug is configurable rather than hardcoded. Vision models on
 * Replicate come and go, their input field names differ, and a wrong default
 * that fails silently is worse than one the user can correct — so a 404 is
 * reported plainly and the local description still stands on its own.
 */

import { describeImage } from './replicate';
import type { MaterialRecipe, MaterialRole } from './materialPalette';

export interface ThemeSuggestion {
  name: string;
  rationale: string;
  subjects: string[];
}

export interface ThemeIconIdea {
  /** Stable card/export label such as Home, Search, or Calendar. */
  name: string;
  /** The literal object to draw, which may differ from the export label. */
  concept: string;
  /** One concise, visibly themed interpretation of that object. */
  themeTreatment: string;
}

export interface ReferenceAnalysis {
  /** Literal object shown in the reference. Never becomes the next icon subject automatically. */
  subject: string;
  /** Transferable appearance only: material, palette, lighting, rendering and finish. */
  style: string;
  /** Material/opacity/volume treatment of the depicted central object only. */
  subjectStyle: string;
  /** Material/opacity/geometry treatment of surrounding frame decoration only. */
  frameStyle: string;
  /** Reusable material roles inferred once before family generation. */
  materials: MaterialRecipe[];
  /** Plausible set directions the user may opt into. */
  themes: ThemeSuggestion[];
  /** Visual construction suggested by the reference, separate from its theme. */
  construction: 'filled-container' | 'open-frame-with-subject' | 'isolated-subject' | 'unknown';
}

export const DEFAULT_VISION_MODEL = 'yorickvp/llava-13b';

/** Field name each family expects for its image input. */
function visionInput(model: string, prompt: string, image: string, maxTokens = 700): Record<string, unknown> {
  if (model.includes('llava') || model.includes('bakllava')) {
    return { image, prompt, max_tokens: maxTokens, temperature: 0.1 };
  }
  if (model.includes('qwen') || model.includes('internvl') || model.includes('moondream')) {
    return { image, prompt, max_new_tokens: maxTokens };
  }
  if (model.includes('gpt') || model.includes('claude') || model.includes('gemini')) {
    return { image_input: [image], prompt, max_tokens: maxTokens };
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
  '{"subject":"short literal noun phrase","style":"shared visual language","subjectStyle":"central subject treatment","frameStyle":"surrounding frame treatment","materials":[{"role":"base|glyph|frame|accent","name":"short material name","description":"texture and optical recipe","opacityMin":0,"opacityMax":100}],"construction":"filled-container|open-frame-with-subject|isolated-subject|unknown","themes":[{"name":"theme name","rationale":"short reason","subjects":["subject 1","subject 2"]}]}',
  'The subject is the literal depicted object, such as "ghost".',
  'The style must describe only transferable appearance: transparency, material, palette, iridescence, lighting, dimensionality, edge treatment, texture, camera and rendering technique.',
  'Do not repeat the depicted subject or its anatomy in the style field.',
  'subjectStyle must describe how the central depicted object itself is rendered, independently of what that object is. Be explicit about whether it is solid or hollow, filled or outline-only, its opacity, brightness, material, volume, edge thickness, highlights and contrast.',
  'frameStyle must separately describe the surrounding border, swirls, bubbles, ribbons or container decoration. Never collapse subjectStyle and frameStyle into the same treatment when they differ.',
  'Dissect the image into no more than four reusable materials. Use base for a filled container surface, glyph for the central subject, frame for border/ribbon decoration, and accent only for a genuinely separate highlight or particle material. Describe texture, translucency, gloss, thickness, refraction, iridescence, highlight shape and color behavior. Estimate opacityMin and opacityMax from 0 to 100 for the material interior, excluding anti-aliased edges, fully transparent exterior, and intentional holes. Use 100/100 for an opaque material. Omit roles that are not visibly present.',
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
  const text = await describeImage(model, visionInput(model, SYMBOL_PROMPT, imageDataUrl, 64));
  return cleanSymbolAnswer(text);
}

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';

/** Parse vision output defensively: caption models sometimes wrap otherwise valid JSON. */
export function parseReferenceAnalysis(text: string): ReferenceAnalysis {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { subject: cleanSymbolAnswer(text), style: '', subjectStyle: '', frameStyle: '', materials: [], themes: [], construction: 'unknown' };

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
    const allowedRoles = new Set<MaterialRole>(['base', 'glyph', 'frame', 'accent']);
    const materials = Array.isArray(raw.materials)
      ? raw.materials.slice(0, 4).flatMap((entry) => {
          const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
          const role = clean(item.role, 20) as MaterialRole;
          const description = clean(item.description, 700);
          if (!allowedRoles.has(role) || !description) return [];
          const opacityMin = Number(item.opacityMin);
          const opacityMax = Number(item.opacityMax);
          return [{
            role,
            name: clean(item.name, 80) || `${role} material`,
            description,
            opacityMin: Number.isFinite(opacityMin) ? Math.max(0, Math.min(100, opacityMin)) : undefined,
            opacityMax: Number.isFinite(opacityMax) ? Math.max(0, Math.min(100, opacityMax)) : undefined,
          }];
        })
      : [];
    return {
      subject: clean(raw.subject, 100),
      style: clean(raw.style, 700),
      subjectStyle: clean(raw.subjectStyle, 700),
      frameStyle: clean(raw.frameStyle, 700),
      materials,
      themes,
      construction:
        raw.construction === 'filled-container' ||
        raw.construction === 'open-frame-with-subject' ||
        raw.construction === 'isolated-subject'
          ? raw.construction
          : 'unknown',
    };
  } catch {
    return { subject: '', style: '', subjectStyle: '', frameStyle: '', materials: [], themes: [], construction: 'unknown' };
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

export function parseThemeFamilyIdeas(text: string): ThemeIconIdea[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const raw = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 24).flatMap((entry) => {
      const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const name = clean(item.name, 60);
      const concept = clean(item.concept, 100);
      const themeTreatment = clean(item.themeTreatment, 240);
      return name && concept && themeTreatment ? [{ name, concept, themeTreatment }] : [];
    });
  } catch {
    return [];
  }
}

/** Plan semantics before image generation so a theme cannot collapse into a palette adjective. */
export async function suggestThemeFamily(
  imageDataUrl: string,
  theme: string,
  model: string = DEFAULT_VISION_MODEL,
): Promise<ThemeIconIdea[]> {
  const prompt = [
    `Plan a coherent tiny app-icon family for the theme "${theme.trim()}" using the supplied image only as material/style evidence.`,
    'Return only a JSON array of 12 objects with exact keys name, concept, themeTreatment.',
    'name is the short app/export function such as Home, Search, Messages, Calendar, Camera or Settings.',
    'concept is the literal main object to draw and may differ from name, such as pumpkin for Home.',
    'themeTreatment is one concise visual transformation that makes the concept unmistakably fit the theme.',
    'Do not reuse the reference subject unless it is one varied choice among the family. Use one bold integrated motif per icon, no scenes, no clusters, and no tiny clutter. Keep every icon legible at 24px.',
  ].join(' ');
  const text = await describeImage(model, visionInput(model, prompt, imageDataUrl, 1200));
  return parseThemeFamilyIdeas(text);
}
