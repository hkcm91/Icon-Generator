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

import type { Conditioning } from './condition';

export interface GenerateResult {
  images: string[];
  predictionId: string;
}

/**
 * `conditioning` records what shape signal each model can actually receive:
 *  - 'edit'    takes a reference image it edits in place
 *  - 'inpaint' takes a base image plus a mask and repaints only the white area
 *  - 'none'    text only, so geometry can be enforced by clipping alone
 */
/**
 * `alpha` records whether the model can return a real alpha channel rather than
 * a painted-on background. Transparent backgrounds are in **preview** for
 * gpt-image-2 via `background: "transparent"` with a png or webp output format;
 * whether a given host exposes that preview is another matter, so every alpha
 * request degrades gracefully (see `generateImage`).
 */
export const MODELS = [
  { slug: 'google/nano-banana-pro', label: 'Nano Banana Pro', conditioning: 'edit', alpha: false },
  { slug: 'google/nano-banana', label: 'Nano Banana', conditioning: 'edit', alpha: false },
  { slug: 'openai/gpt-image-2', label: 'GPT Image 2', conditioning: 'edit', alpha: true },
  { slug: 'bytedance/seedream-4', label: 'Seedream 4', conditioning: 'edit', alpha: false },
  {
    slug: 'black-forest-labs/flux-fill-dev',
    label: 'FLUX Fill (masked)',
    conditioning: 'inpaint',
    alpha: false,
  },
] as const;

export type ModelSlug = (typeof MODELS)[number]['slug'];

export function modelConditioning(slug: string): 'edit' | 'inpaint' | 'none' {
  return MODELS.find((entry) => entry.slug === slug)?.conditioning ?? 'none';
}

export function modelSupportsAlpha(slug: string): boolean {
  return MODELS.find((entry) => entry.slug === slug)?.alpha ?? false;
}

const TOKEN_KEY = 'icon-generator-replicate-token';

/**
 * A key held in the browser, used when the deployment has no server-side one.
 *
 * On serverless there is nowhere else for it to live: functions are stateless,
 * so nothing "saved" in one invocation exists in the next. The trade is that
 * the key is in this browser's localStorage — acceptable for your own key on
 * your own machine, and the reason a shared deployment should set
 * REPLICATE_API_TOKEN server-side instead.
 */
/** Set when the user declined to persist: usable now, gone on refresh. */
let ephemeralToken = '';

export function readStoredToken(): string {
  if (ephemeralToken) return ephemeralToken;
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * `persist` is honoured rather than decorative: unticked really does mean the
 * key is gone on refresh, which is the difference between a checkbox and a lie.
 */
export function storeToken(token: string | null, persist = true) {
  ephemeralToken = token && !persist ? token : '';
  try {
    if (token && persist) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: fall back to memory for this tab.
    if (token) ephemeralToken = token;
  }
}

function authHeaders(): Record<string, string> {
  const token = readStoredToken();
  return token ? { 'x-replicate-token': token } : {};
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

export async function testConnection(): Promise<string> {
  const response = await fetch('/api/status', { headers: authHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!payload.connected) throw new Error(payload.error || 'No API key set.');
  return payload.account as string;
}

interface Started {
  id: string;
}

interface Polled {
  status: string;
  images?: string[];
  raw?: string[];
  text?: string;
  error?: string;
}

const activePredictions = new Set<string>();

/** Cancel every prediction created by this browser tab that has not finished yet. */
export async function cancelActiveGenerations(): Promise<number> {
  const ids = [...activePredictions];
  await Promise.allSettled(ids.map((id) => post('/api/cancel', { id })));
  return ids.length;
}

/** Poll interval. Image models take tens of seconds; sub-second polling is waste. */
const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * Wait for a prediction the client started.
 *
 * Waiting happens here rather than inside the API route because a serverless
 * function is capped well below the minutes an image model can take. Polling
 * from the browser keeps every individual request short.
 */
async function waitFor(id: string): Promise<Polled> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    await new Promise((done) => setTimeout(done, POLL_MS));
    if (Date.now() > deadline) throw new Error('Generation timed out after six minutes.');

    const response = await fetch(`/api/prediction?id=${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    });
    const payload = (await response.json().catch(() => ({}))) as Polled;
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);

    if (payload.status === 'succeeded') return payload;
    if (payload.status === 'failed' || payload.status === 'canceled') {
      throw new Error(payload.error || `Generation ${payload.status}.`);
    }
  }
}

export async function generate(
  model: string,
  input: Record<string, unknown>,
  onStarted?: (id: string) => void,
): Promise<GenerateResult> {
  const started = await post<Started>('/api/generate', { model, input });
  onStarted?.(started.id);
  activePredictions.add(started.id);
  try {
    const finished = await waitFor(started.id);
    if (!finished.images?.length) throw new Error('The model returned no image.');
    return { images: finished.images, predictionId: started.id };
  } finally {
    activePredictions.delete(started.id);
  }
}

/** Resume a prediction created before a page refresh without paying again. */
export async function resumeGeneration(id: string): Promise<GenerateResult> {
  activePredictions.add(id);
  try {
    const finished = await waitFor(id);
    if (!finished.images?.length) throw new Error('The model returned no image.');
    return { images: finished.images, predictionId: id };
  } finally {
    activePredictions.delete(id);
  }
}

/** Run a vision model and return its text. */
export async function describeImage(
  model: string,
  input: Record<string, unknown>,
): Promise<string> {
  const started = await post<Started>('/api/describe', { model, input });
  activePredictions.add(started.id);
  try {
    const finished = await waitFor(started.id);
    return finished.text ?? '';
  } finally {
    activePredictions.delete(started.id);
  }
}

/**
 * Generate, retrying without the transparency request if the host rejects it.
 *
 * Transparent background is a preview feature and support varies by model
 * snapshot: some pinned versions return an error for
 * `background: "transparent"` outright. Rather than making the user discover
 * that as a failed run, the request is retried once without the flag and the
 * caller is told which path succeeded, so it can fall back to chroma keying.
 */
export async function generateImage(
  model: string,
  input: Record<string, unknown>,
  onStarted?: (id: string) => void,
): Promise<GenerateResult & { alphaRequested: boolean; alphaAccepted: boolean }> {
  const wantsAlpha = input.background === 'transparent';
  try {
    const result = await generate(model, input, onStarted);
    return { ...result, alphaRequested: wantsAlpha, alphaAccepted: wantsAlpha };
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (!wantsAlpha || !/background|transparent|unsupported|invalid/i.test(message)) throw error;

    const { background: _background, ...withoutAlpha } = input;
    const result = await generate(model, withoutAlpha, onStarted);
    return { ...result, alphaRequested: true, alphaAccepted: false };
  }
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
 * Material prompt for a shape-conditioned run.
 *
 * The difference from the unconditioned version is the whole point: here the
 * model is shown the silhouette and asked to light *that* object, so bevels and
 * falloff land on the real corners. It is still never told the radius as a
 * number, and the output is still clipped to the exact path afterwards — the
 * reference is a lighting cue, not a promise.
 */
export function conditionedMaterialPrompt(description: string): string {
  return [
    'Render the shape shown in the reference image as a solid physical object,',
    `finished in this material: ${description.trim() || 'smooth polished gradient'}.`,
    'Preserve the reference silhouette exactly: identical outline, identical corner curvature,',
    'identical proportions, identical position and scale in frame.',
    'Light it so highlights, bevels and shading follow that exact contour.',
    'Front-facing orthographic view. Keep the surrounding background flat and empty.',
    'Do not introduce a black or near-black technical keyline outside the reference silhouette.',
    'This exclusion applies only to an accidental dark upload/template artifact. Preserve any intentional bright, colored, translucent, pearlescent, glass, gel, beveled, layered, or decorative rim visible in the reference, including its thickness and highlights.',
    'Do not redraw, reshape, straighten, round, or resize the outline.',
    'No glyph, symbol, logo, text, badge, second object, scene, or mockup.',
  ].join(' ');
}

/**
 * Prompt for the glyph.
 *
 * A flat chroma field is requested rather than transparency because most image
 * models silently ignore alpha requests; `keyOutBackground` recovers the alpha
 * afterwards, which works whether or not the model cooperated.
 */
export function glyphPrompt(
  subject: string,
  style: string,
  nativeAlpha = false,
  hasMaster = false,
  referenceSubject = '',
  theme = '',
  themeTreatment = '',
  subjectStyle = '',
  frameStyle = '',
  referenceHasSeparateFrame = false,
): string {
  const requested = subject.trim() || 'symbol';
  return [
    `SUBJECT AUTHORITY: Create one ${requested}. The requested subject in this sentence overrides every reference image and every theme cue.`,
    `A single centered ${requested} icon glyph.`,
    style.trim() ? `Style: ${style.trim()}.` : '',
    subjectStyle.trim() ? `REFERENCE SUBJECT TREATMENT: ${subjectStyle.trim()}.` : '',
    theme.trim()
      ? `THEME TRANSFORMATION: The family theme is ${theme.trim()}. Keep the requested icon function instantly recognizable while you reinterpret its visual concept. Use one restrained cue integrated into the main silhouette; the theme is never permission to add a collection of decorative objects.`
      : '',
    themeTreatment.trim()
      ? `APPROVED THEME TREATMENT: ${themeTreatment.trim()}. Follow this treatment while preserving the requested icon's readable identity.`
      : '',
    // With a real alpha channel the background must not be described at all:
    // naming one invites the model to draw it despite the transparency flag.
    nativeAlpha
      ? 'Return a transparent PNG containing only the isolated glyph pixels. Everything outside the glyph must have zero alpha. No opaque or translucent backing shape, color field, tile, or plate.'
      : 'Isolated on a completely flat uniform #00FF00 chroma-green background with no gradient, no vignette, and no color spill.',
    'The glyph is fully visible, centered, with generous even margin on all four sides.',
    `SMALL-ICON SIMPLIFICATION: ${requested} must remain instantly recognizable at 24px. Use one clean bold silhouette with the minimum canonical parts required to identify it. Use smooth broad surfaces, thick members, simple holes and crisp separation. No ornamental bubbles, swirls, sparkles, particles, tendrils, secondary objects, busy internal texture, filigree, or clusters of tiny highlights. Material variation belongs inside the large simple form; it must never change the form's geometry.`,
    'Front-facing orthographic view.',
    // With a master supplied, the reference is the authority on *style* only.
    // Saying so explicitly is what stops the model copying its subject, which
    // is the usual failure when a reference image is present.
    hasMaster
      ? `REFERENCE ROLE — APPEARANCE ONLY: Match material, transparency, palette, iridescence, lighting direction, stroke weight and camera, but deliberately simplify the reference's detail for a tiny utility glyph. The reference depicts ${referenceSubject.trim() || 'a different object'}; that object is source content, not a reusable motif. Do not draw it unless the requested subject explicitly asks for it. Do not copy or trace the reference silhouette, anatomy, facial features, or the positions of bubbles, sparkles, particles, highlights, or other decorative accents.`
      : '',
    referenceHasSeparateFrame
      ? `The reference contains TWO DIFFERENT VISUAL ROLES. Render the new ${requested} with the central reference subject's material, opacity, brightness, filled volume, edge treatment and contrast. Do not give it the surrounding frame's ribbon, tendril, hollow-outline or border construction${frameStyle.trim() ? ` (${frameStyle.trim()})` : ''}. Transfer how the reference subject is rendered, never what it depicts.`
      : '',
    referenceHasSeparateFrame
      ? `LEGIBILITY: ${requested} must read immediately at 24px against transparency. Use a bold, thick, materially filled silhouette with broad illuminated surfaces. Preserve only holes required to recognize the symbol; do not turn the whole glyph into a thin transparent outline.`
      : '',
    'No container, tile, badge, frame, card, rounded rectangle, circle backing, border,',
    'text, label, watermark, mockup, or scene.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** One-pass artwork used when the user asks the model to include the container. */
export function completeIconPrompt(
  subject: string,
  material: string,
  hasMaster = false,
  referenceSubject = '',
  theme = '',
  themeTreatment = '',
  frameStyle = '',
): string {
  const requested = subject.trim() || 'a simple symbol';
  return [
    `SUBJECT AUTHORITY: Create one complete finished app icon depicting ${requested}. The requested subject overrides every reference image and theme cue.`,
    material.trim() ? `Material and finish: ${material.trim()}.` : '',
    theme.trim()
      ? `THEME TRANSFORMATION: The family theme is ${theme.trim()}. Reinterpret ${requested} with one restrained, integrated theme-specific cue. Keep the main subject unmistakable and legible at tiny size.`
      : '',
    themeTreatment.trim() ? `APPROVED THEME TREATMENT: ${themeTreatment.trim()}.` : '',
    hasMaster
      ? `REFERENCE ROLE — APPEARANCE ONLY: Use the reference as authoritative for container silhouette, material vocabulary, palette, lighting, camera, and proportions, but not for content. It depicts ${referenceSubject.trim() || 'a different object'}; remove that source subject completely and replace it with ${requested}. Do not retain its silhouette, face, anatomy, pose, or recognizable fragments.`
      : 'Include a polished, fully visible icon container behind the symbol.',
    'Return one PNG containing the complete container and symbol together. Never return only the isolated symbol.',
    'The area outside the finished container must have zero alpha. Preserve partial alpha through translucent glass, gel, and clear rim materials instead of flattening them onto an opaque matte.',
    hasMaster
      ? "Match the reference container's exact scale and position, including its transparent exterior margin. Never crop the outer shell or shrink it into a smaller icon."
      : 'Keep the complete container fully visible at large app-icon scale without cropping its outer edge.',
    hasMaster
      ? "Preserve the reference container's outer-edge construction. If it has a luminous translucent glass rim, bright pearlescent bevel, or layered clear border, reproduce that integral edge treatment with the same relative thickness, material, highlights, and depth."
      : 'Give the container a cohesive material edge and softly lit bevel that belongs to the object.',
    hasMaster
      ? `OUTER FRAME AUTHORITY: Reproduce the master container's visible outer shell as a separate material role${frameStyle.trim() ? `, following this detected treatment: ${frameStyle.trim()}` : ''}. When the master shell is glass, it must remain a distinct, thick, dimensional transparent-glass frame around the filled inner tile—not a thin outline, faint bevel, or edge color change. Do not invent a glass shell when the master has none.`
      : '',
    'The luminous bevel and outer rim are essential parts of the container. Keep them fully visible at the reference thickness; do not crop, thin, flatten, fade, recolor, or omit them.',
    `SMALL-ICON CLARITY: ${requested} must remain instantly readable at 24px. Use broad clean forms, a clear silhouette, and quiet negative space. The functional subject—not decoration—must receive most of the visual attention.`,
    hasMaster
      ? 'Remove only an unintended black or near-black technical keyline introduced by the upload/template outside the true container edge. This exclusion must never remove or weaken an intentional bright, colored, translucent, pearlescent, glass, gel, beveled, layered, or decorative border from the reference.'
      : 'Do not add a separate black technical outline outside the finished container. Keep the intentional material edge and bevel fully visible.',
    'Keep decorative microdetail density at or below the reference. Reposition only the material details needed to avoid an exact copy; never add filler to prove the theme. Never trace or reuse their coordinates from a reference image or another icon. Do not repeat a seasonal motif around the container rim.',
    'No isolated glyph, chroma screen, contact sheet, text, label, watermark, device, or mockup.',
  ].filter(Boolean).join(' ');
}

/** Create one reusable alpha-bearing frame from a finished reference sample. */
export function openFramePrompt(
  material: string,
  referenceSubject: string,
  nativeAlpha = true,
  frameStyle = '',
): string {
  return [
    'DIRECT IMAGE EDIT: Create a reusable subject-free decorative app-icon frame by editing the supplied reference. Do not return the reference unchanged.',
    'SUBJECT REMOVAL IS THE PRIMARY REQUIREMENT. The returned PNG must visibly differ from the input by containing true transparency exactly where the subject was removed.',
    `The reference subject is ${referenceSubject.trim() || 'the central object'}. Remove that subject completely: no silhouette, face, eyes, anatomy, pose, or recognizable fragments may remain.`,
    material.trim() ? `Preserve this material and finish: ${material.trim()}.` : '',
    frameStyle.trim() ? `FRAME TREATMENT AUTHORITY: ${frameStyle.trim()}.` : '',
    'CANVAS REGISTRATION: Keep the decorative frame at the reference image\'s exact outer pixel bounds, scale, center, position and transparent exterior margin. Never zoom, enlarge, shrink, crop or recenter it when removing the subject.',
    'PIXEL-PRESERVATION PRIORITY: Preserve every non-subject frame element from the reference, including its exact outer envelope, inward extensions, material vocabulary, iridescent palette, transparent gel, bubbles, swirls, highlights, lighting, camera and dimensionality. Do not simplify, thin, crop, move, repaint, or erase those details.',
    'This is an OPEN FRAME, not a filled tile. Make only the pixels formerly occupied by the named subject truly transparent. Do not enlarge that cleared region beyond the removed subject and do not apply a generic circular, square, or percentage-based center cut.',
    'Decorative frame elements may enter the interior and must remain where they are. Preserve every intentional transparent gap between swirl, bubble and rim elements.',
    nativeAlpha
      ? 'Return a transparent PNG. Everything outside the decorative frame pixels and every intentional interior hole must have zero alpha.'
      : 'Render on a completely flat uniform #00FF00 chroma-green background with no gradient or color spill.',
    'No replacement subject, glyph, logo, text, label, opaque backing plate, solid color fill, checkerboard pattern, mockup, scene, device, or drop shadow.',
  ].filter(Boolean).join(' ');
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
  conditioning?: Conditioning,
  wantAlpha = false,
  quality: 'low' | 'medium' | 'high' = 'low',
): Record<string, unknown> {
  const base: Record<string, unknown> = { prompt };
  // Replicate accepts data URIs wherever it accepts a file input, so the
  // conditioning plate travels inline and never needs an upload round trip.
  const shape = conditioning && conditioning.mode !== 'off' ? conditioning.reference : undefined;
  const images = shape ? [shape, ...references] : references;

  if (model.startsWith('black-forest-labs/flux-fill')) {
    // Mask convention: white is repainted, black is preserved. The mask built
    // from the spec is white inside the container, so the model paints the
    // material into the silhouette and leaves everything outside untouched.
    if (shape) base.image = shape;
    if (conditioning?.mask) base.mask = conditioning.mask;
    base.output_format = 'png';
    base.num_inference_steps = 28;
    base.guidance = 30;
    return base;
  }

  if (model.startsWith('openai/gpt-image')) {
    base.aspect_ratio = '1:1';
    base.quality = quality;
    // png (or webp) is required alongside a transparent background; jpeg is not
    // a valid pairing.
    base.output_format = 'png';
    base.background = wantAlpha && modelSupportsAlpha(model) ? 'transparent' : 'opaque';
    if (images.length) base.input_images = images;
    return base;
  }

  if (model.startsWith('google/nano-banana')) {
    base.aspect_ratio = '1:1';
    base.output_format = 'png';
    if (images.length) base.image_input = images;
    return base;
  }

  if (model.startsWith('bytedance/seedream')) {
    base.size = 'custom';
    base.width = Math.min(4096, size);
    base.height = Math.min(4096, size);
    if (images.length) base.image_input = images;
    return base;
  }

  base.aspect_ratio = '1:1';
  if (images.length) base.image_input = images;
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
