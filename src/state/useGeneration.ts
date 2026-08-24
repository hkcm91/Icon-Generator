import { useCallback, useState } from 'react';
import { cleanGeneratedAlpha, hasNativeAlpha, keyOutBackground } from '../core/compose';
import { buildConditioning, type ConditioningMode } from '../core/condition';
import {
  conditionedMaterialPrompt,
  generateImage,
  glyphPrompt,
  loadImage,
  materialPrompt,
  modelConditioning,
  modelInput,
  modelSupportsAlpha,
} from '../core/replicate';
import type { ContainerSpec } from '../core/spec';

export type GenStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; message: string };

export interface GenerationOptions {
  spec: ContainerSpec;
  model: string;
  material: string;
  glyphSubject: string;
  glyphStyle: string;
  /** 'auto' picks the strongest conditioning the chosen model supports. */
  conditioning: ConditioningMode | 'auto';
  wantAlpha: boolean;
  /**
   * The approved master, as a data URL. Passed as a reference to *every*
   * generation so the whole family inherits one look, which is the entire
   * point of having a master rather than a mood board.
   */
  master?: string | null;
}

/**
 * Resolve 'auto' to the best mode the model can actually use.
 *
 * This exists so the simple view can omit the choice entirely: there is a
 * correct answer per model, and making the user learn the difference between
 * an image reference and an inpainting mask to get an icon is not a good
 * trade.
 */
export function resolveConditioning(
  model: string,
  requested: ConditioningMode | 'auto',
): ConditioningMode {
  const supports = modelConditioning(model);
  if (requested === 'auto') {
    if (supports === 'inpaint') return 'masked-fill';
    if (supports === 'edit') return 'reference';
    return 'off';
  }
  if (supports === 'none') return 'off';
  if (requested === 'masked-fill' && supports !== 'inpaint') return 'reference';
  return requested;
}

/**
 * Shared generation logic for both the guided and the full views, so the alpha
 * handling and conditioning wiring cannot drift between them.
 */
export function useGeneration() {
  const [status, setStatus] = useState<GenStatus>({ kind: 'idle' });

  const runMaterial = useCallback(async (options: GenerationOptions) => {
    const mode = resolveConditioning(options.model, options.conditioning);
    const conditioning = await buildConditioning(options.spec, mode);
    const prompt =
      mode === 'off' ? materialPrompt(options.material) : conditionedMaterialPrompt(options.material);

    const references = options.master ? [options.master] : [];
    const result = await generateImage(
      options.model,
      modelInput(options.model, prompt, options.spec.size, references, conditioning),
    );
    return loadImage(result.images[0]);
  }, []);

  const runGlyph = useCallback(async (options: GenerationOptions, subject?: string) => {
    const wantAlpha = options.wantAlpha && modelSupportsAlpha(options.model);
    const references = options.master ? [options.master] : [];
    // Never shape-condition the glyph: showing it the container silhouette is
    // an invitation to draw a container. The master still goes in as a style
    // reference — that is a different thing from a shape plate.
    const result = await generateImage(
      options.model,
      modelInput(
        options.model,
        glyphPrompt(
          subject ?? options.glyphSubject,
          options.glyphStyle,
          wantAlpha,
          Boolean(options.master),
        ),
        options.spec.size,
        references,
        undefined,
        wantAlpha,
      ),
    );

    const image = await loadImage(result.images[0]);
    const native = result.alphaAccepted && hasNativeAlpha(image);
    return {
      layer: native
        ? cleanGeneratedAlpha(image, options.spec.size)
        : keyOutBackground(image, options.spec.size),
      native,
    };
  }, []);

  const generateMaterial = useCallback(
    async (options: GenerationOptions, onMaterial: (image: CanvasImageSource) => void) => {
      setStatus({ kind: 'busy', what: 'Painting the surface' });
      try {
        onMaterial(await runMaterial(options));
        setStatus({ kind: 'ok', message: 'Surface applied.' });
      } catch (error) {
        setStatus({ kind: 'error', message: (error as Error).message });
      }
    },
    [runMaterial],
  );

  const generateGlyph = useCallback(
    async (options: GenerationOptions, onGlyph: (image: CanvasImageSource) => void) => {
      setStatus({ kind: 'busy', what: 'Drawing the symbol' });
      try {
        const { layer } = await runGlyph(options);
        onGlyph(layer);
        setStatus({ kind: 'ok', message: 'Symbol applied.' });
      } catch (error) {
        setStatus({ kind: 'error', message: (error as Error).message });
      }
    },
    [runGlyph],
  );

  /** One press, both layers — what the guided view uses. */
  const generateIcon = useCallback(
    async (
      options: GenerationOptions,
      onMaterial: (image: CanvasImageSource) => void,
      onGlyph: (image: CanvasImageSource) => void,
    ) => {
      try {
        setStatus({ kind: 'busy', what: 'Painting the surface (1 of 2)' });
        onMaterial(await runMaterial(options));

        // Only generate a symbol if one was asked for; a plain material tile is
        // a legitimate result.
        if (options.glyphSubject.trim()) {
          setStatus({ kind: 'busy', what: 'Drawing the symbol (2 of 2)' });
          const { layer } = await runGlyph(options);
          onGlyph(layer);
        }
        setStatus({ kind: 'ok', message: 'Done. The shape is exactly as specified.' });
      } catch (error) {
        setStatus({ kind: 'error', message: (error as Error).message });
      }
    },
    [runMaterial, runGlyph],
  );

  /**
   * Glyph for one library card. Kept separate from `generateGlyph` because the
   * batch runner drives its own status and error reporting per card, and a
   * shared status string cannot represent twelve cards at once.
   */
  const generateForItem = useCallback(
    async (options: GenerationOptions, subject: string) => (await runGlyph(options, subject)).layer,
    [runGlyph],
  );

  return { status, setStatus, generateMaterial, generateGlyph, generateIcon, generateForItem };
}
