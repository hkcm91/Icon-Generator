import { describe, expect, it } from 'vitest';
import { buildConditioning, edgeSvg, maskSvg, shapeReferenceSvg } from '../src/core/condition';
import { containerPath } from '../src/core/geometry';
import { completeIconPrompt, glyphPrompt, modelConditioning, modelInput } from '../src/core/replicate';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../src/core/spec';
import { recipePrompt } from '../src/state/useGeneration';

const spec = (overrides: Partial<ContainerSpec> = {}) =>
  normalizeSpec({ ...DEFAULT_SPEC, ...overrides });

describe('conditioning images', () => {
  it('builds a mask that is white inside the container and black outside', () => {
    const subject = spec();
    const svg = maskSvg(subject);
    // FLUX Fill and friends repaint white and preserve black, so the container
    // must be the white region or the model would paint everywhere but it.
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain(`<path d="${containerPath(subject)}" fill="#ffffff"`);
  });

  it('draws the edge map as a stroke with no fill', () => {
    const svg = edgeSvg(spec());
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#ffffff"');
  });

  it('uses the exact container path in every conditioning image', () => {
    const subject = spec({ shape: 'superellipse', exponent: 6.5 });
    const path = containerPath(subject);
    for (const svg of [maskSvg(subject), edgeSvg(subject), shapeReferenceSvg(subject)]) {
      expect(svg).toContain(path);
    }
  });

  it('is deterministic, like the geometry it is built from', () => {
    const subject = spec({ exponent: 4.2 });
    expect(maskSvg(subject)).toBe(maskSvg(spec({ exponent: 4.2 })));
    expect(shapeReferenceSvg(subject)).toBe(shapeReferenceSvg(spec({ exponent: 4.2 })));
  });

  it('keeps the conditioning canvas square and matched to the spec', () => {
    const subject = spec({ size: 512 });
    expect(maskSvg(subject)).toContain('width="512" height="512"');
    expect(maskSvg(subject)).toContain('viewBox="0 0 512 512"');
  });

  it('returns nothing to send when conditioning is off', async () => {
    const result = await buildConditioning(spec(), 'off');
    expect(result.reference).toBeUndefined();
    expect(result.mask).toBeUndefined();
  });
});

describe('model capability lookup', () => {
  it('knows which models take a mask', () => {
    expect(modelConditioning('black-forest-labs/flux-fill-dev')).toBe('inpaint');
    expect(modelConditioning('google/nano-banana-pro')).toBe('edit');
    expect(modelConditioning('some/unknown-model')).toBe('none');
  });
});

describe('model input wiring', () => {
  const conditioning = { mode: 'masked-fill' as const, reference: 'data:image/png;base64,AAA', mask: 'data:image/png;base64,BBB' };

  it('sends image and mask to an inpainting model', () => {
    const input = modelInput('black-forest-labs/flux-fill-dev', 'p', 1024, [], conditioning);
    expect(input.image).toBe(conditioning.reference);
    expect(input.mask).toBe(conditioning.mask);
  });

  it('puts the shape plate first among reference images for edit models', () => {
    const input = modelInput('google/nano-banana-pro', 'p', 1024, ['data:image/png;base64,CCC'], {
      mode: 'reference',
      reference: conditioning.reference,
    });
    expect(input.image_input).toEqual([conditioning.reference, 'data:image/png;base64,CCC']);
  });

  it('sends no conditioning image when the mode is off', () => {
    const input = modelInput('google/nano-banana-pro', 'p', 1024, [], { mode: 'off' });
    expect(input.image_input).toBeUndefined();
  });

  it('still produces a valid input with no conditioning argument at all', () => {
    const input = modelInput('openai/gpt-image-2', 'p', 1024);
    expect(input.prompt).toBe('p');
    expect(input.input_images).toBeUndefined();
    expect(input.quality).toBe('low');
    expect(input.background).toBe('opaque');
  });

  it('does not teach edit models to reproduce a visible frame', () => {
    const svg = shapeReferenceSvg(spec());
    expect(svg).not.toContain('stroke=');
    expect(svg).not.toContain('fill="none"');
  });

  it('uses an explicitly selected GPT Image quality tier', () => {
    expect(modelInput('openai/gpt-image-2', 'p', 1024, [], undefined, false, 'high').quality).toBe('high');
  });

  it('sends transparent only when native-alpha output is selected', () => {
    expect(modelInput('openai/gpt-image-2', 'p', 1024, [], undefined, true).background).toBe('transparent');
    expect(modelInput('openai/gpt-image-2', 'p', 1024, [], undefined, false).background).toBe('opaque');
  });

  it('keeps a square frame so the compositor never centre-crops off-centre', () => {
    expect(modelInput('google/nano-banana', 'p', 1024).aspect_ratio).toBe('1:1');
    const seedream = modelInput('bytedance/seedream-4', 'p', 1024);
    expect(seedream.width).toBe(seedream.height);
  });
});

describe('glyph isolation prompt', () => {
  it('requires zero-alpha surroundings and forbids backing tiles for native transparency', () => {
    const prompt = glyphPrompt('moon', 'pearl', true, false);
    expect(prompt).toContain('zero alpha');
    expect(prompt).toContain('No opaque or translucent backing shape');
    expect(prompt).toContain('No container, tile');
  });

  it('uses chroma green when transparency is turned off', () => {
    expect(glyphPrompt('moon', 'pearl', false, false)).toContain('#00FF00');
  });
});

describe('complete icon prompt', () => {
  it('requires the container and explicitly forbids transparent output', () => {
    const prompt = completeIconPrompt('moon', 'pearl glass', true);
    expect(prompt).toContain('complete container and symbol together');
    expect(prompt).toContain('fully opaque PNG');
    expect(prompt).toContain('fill the square canvas edge to edge');
    expect(prompt).toContain('Zero extra outer padding');
    expect(prompt).toContain('no black keyline');
    expect(prompt).toContain('Never trace or reuse their coordinates');
    expect(prompt).toContain('No transparency');
  });

  it('gives each family revision a non-visible composition variation', () => {
    const prompt = recipePrompt('base', { variationKey: 'abc123' } as never);
    expect(prompt).toContain('Internal composition variation abc123');
    expect(prompt).toContain('Do not display or spell this key');
  });
});
