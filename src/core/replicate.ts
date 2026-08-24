/**
 * Replicate client + prompt construction.
 *
 * The prompts below are the other half of the drift fix. The old pipeline sent
 * the model lines like `radius 30%; shape squircle; padding 8%` — numbers a
 * diffusion model has no mechanism to honour, so each run reinterpreted them
 * and the silhouette moved. Here the model is never asked about geometry at
 * all. It is asked for an edge-to-edge material, or a centred glyph on a flat
 * field, and code supplies the shape.
 */

export interface GenerateResult {
  images: string[];
  predictionId: string;
}

export const MODELS = [
  { slug: 'google/nano-banana-pro', label: 'Nano Banana Pro' },
  { slug: 'google/nano-banana', label: 'Nano Banana' },
  { slug: 'openai/gpt-image-2', label: 'GPT Image 2' },
  { slug: 'bytedance/seedream-4', label: 'Seedream 4' },
] as const;

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

export async function testConnection(): Promise<string> {
  const response = await fetch('/api/account');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Connection test failed.');
  return payload.account as string;
}

export function generate(model: string, input: Record<string, unknown>) {
  return post<GenerateResult>('/api/generate', { model, input });
}

/**
 * Prompt for the container's surface.
 *
 * Asks for a full-bleed texture with no subject and no edges. Anything the
 * model draws outside the container contour is discarded by the clip, so an
 * over-generous texture costs nothing while a texture with its own silhouette
 * would fight the geometry.
 */
export function materialPrompt(description: string): string {
  return [
    'A seamless full-bleed material surface that completely fills the entire square frame,',
    'edge to edge, with no border, no margin, and no background visible anywhere.',
    `Material: ${description.trim() || 'smooth polished gradient'}.`,
    'Flat front-facing orthographic view, evenly lit, consistent across the whole frame.',
    'This is a texture swatch, not an object: no icon, no symbol, no glyph, no logo,',
    'no rounded corners, no card, no tile, no button, no frame, no shadow, no perspective,',
    'no text, no watermark, and no shape of any kind.',
  ].join(' ');
}

/**
 * Prompt for the glyph.
 *
 * A flat chroma field is requested rather than transparency because most image
 * models silently ignore alpha requests; `keyOutBackground` recovers the alpha
 * afterwards, which works whether or not the model cooperated.
 */
export function glyphPrompt(subject: string, style: string): string {
  return [
    `A single centered ${subject.trim() || 'symbol'} icon glyph.`,
    style.trim() ? `Style: ${style.trim()}.` : '',
    'Isolated on a completely flat uniform #00FF00 chroma-green background',
    'with no gradient, no vignette, and no color spill.',
    'The glyph is fully visible, centered, with generous even margin on all four sides.',
    'Front-facing orthographic view.',
    'No container, tile, badge, frame, card, rounded rectangle, circle backing, border,',
    'text, label, watermark, mockup, or scene.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Per-model input shaping. Each model names its parameters differently, and
 * getting a square aspect ratio matters here — a non-square frame would be
 * centre-cropped by the compositor and shift the material off-centre.
 */
export function modelInput(
  model: string,
  prompt: string,
  size: number,
  references: string[] = [],
): Record<string, unknown> {
  const base: Record<string, unknown> = { prompt };

  if (model.startsWith('openai/gpt-image')) {
    base.aspect_ratio = '1:1';
    base.quality = 'high';
    base.output_format = 'png';
    if (references.length) base.input_images = references;
    return base;
  }

  if (model.startsWith('google/nano-banana')) {
    base.aspect_ratio = '1:1';
    base.output_format = 'png';
    if (references.length) base.image_input = references;
    return base;
  }

  if (model.startsWith('bytedance/seedream')) {
    base.size = 'custom';
    base.width = Math.min(4096, size);
    base.height = Math.min(4096, size);
    if (references.length) base.image_input = references;
    return base;
  }

  base.aspect_ratio = '1:1';
  if (references.length) base.image_input = references;
  return base;
}

/** Load a URL into an <img> that the canvas will accept. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Same-origin via the proxy, but set explicitly so a future absolute URL
    // with proper CORS headers also stays untainted.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));
    image.src = src;
  });
}
