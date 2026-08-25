import { describe, expect, it } from 'vitest';
import { buildConditioning, edgeSvg, maskSvg, shapeReferenceSvg } from '../src/core/condition';
import { containerPath } from '../src/core/geometry';
import { completeIconPrompt, glyphPrompt, modelConditioning, modelInput, openFramePrompt } from '../src/core/replicate';
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

  it('makes the requested subject authoritative over reference content and theme', () => {
    const prompt = glyphPrompt('home', 'iridescent glass', true, true, 'ghost', 'Halloween');
    expect(prompt).toContain('SUBJECT AUTHORITY: Create one home');
    expect(prompt).toContain('reference depicts ghost');
    expect(prompt).toContain('Do not draw it unless the requested subject explicitly asks for it');
    expect(prompt).toContain('never replace, disguise, or weaken the requested subject');
  });

  it('copies the reference subject treatment instead of the open frame treatment', () => {
    const prompt = glyphPrompt(
      'magnifying glass',
      '',
      true,
      true,
      'ghost',
      'Halloween',
      'milky opalescent filled volume',
      'clear hollow ribbons',
      true,
    );
    expect(prompt).toContain('REFERENCE SUBJECT TREATMENT: milky opalescent filled volume');
    expect(prompt).toContain("central reference subject's material");
    expect(prompt).toContain("Do not give it the surrounding frame's ribbon");
    expect(prompt).toContain('read immediately at 24px');
    expect(prompt).toContain('do not turn the whole glyph into a thin transparent outline');
    expect(prompt).toContain('instantly recognizable at 24px');
    expect(prompt).toContain('No ornamental bubbles, swirls, sparkles');
    expect(prompt).toContain('deliberately simplify');
  });
});

describe('complete icon prompt', () => {
  it('requires the container and explicitly forbids transparent output', () => {
    const prompt = completeIconPrompt('moon', 'pearl glass', true);
    expect(prompt).toContain('complete container and symbol together');
    expect(prompt).toContain('fully opaque PNG');
    expect(prompt).toContain('fill the square canvas edge to edge');
    expect(prompt).toContain('Zero extra outer padding');
    expect(prompt).toContain('luminous translucent glass rim');
    expect(prompt).toContain('same relative thickness');
    expect(prompt).toContain('belongs inside the container silhouette');
    expect(prompt).toContain('No black or dark keyline');
    expect(prompt).toContain('debug/template frame');
    expect(prompt).toContain('Never trace or reuse their coordinates');
    expect(prompt).toContain('No transparency');
  });

  it('adds an integral bevel without inventing an extra frame when no master exists', () => {
    const prompt = completeIconPrompt('menu', 'pearl glass', false);
    expect(prompt).toContain('cohesive material edge and softly lit bevel');
    expect(prompt).toContain('not a second inset card');
    expect(prompt).toContain('No black or dark keyline');
  });

  it('replaces the reference subject in complete-icon mode', () => {
    const prompt = completeIconPrompt('pumpkin', 'iridescent glass', true, 'ghost', 'Halloween');
    expect(prompt).toContain('depicting pumpkin');
    expect(prompt).toContain('It depicts ghost');
    expect(prompt).toContain('replace it with pumpkin');
  });

  it('gives each family revision a non-visible composition variation', () => {
    const prompt = recipePrompt('base', { variationKey: 'abc123' } as never);
    expect(prompt).toContain('Internal composition variation abc123');
    expect(prompt).toContain('Do not display or spell this key');
  });

  it('keeps style fidelity independent from decorative variation', () => {
    const prompt = recipePrompt('base', { styleFidelity: 95, detailVariation: 90 } as never);
    expect(prompt).toContain('style match 95%, decorative variation 90%');
    expect(prompt).toContain('Very high style fidelity');
    expect(prompt).toContain('Very high decorative variation');
    expect(prompt).toContain('variation must not weaken the locked style');
  });
});

describe('open frame prompt', () => {
  it('removes the sample subject while preserving real alpha holes', () => {
    const prompt = openFramePrompt('iridescent transparent gel', 'ghost', true);
    expect(prompt).toContain('Remove that subject completely');
    expect(prompt).toContain('reference subject is ghost');
    expect(prompt).toContain('OPEN FRAME, not a filled tile');
    expect(prompt).toContain('zero alpha');
    expect(prompt).toContain('No replacement subject');
  });
});
