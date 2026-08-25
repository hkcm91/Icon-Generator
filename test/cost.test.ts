import { describe, expect, it } from 'vitest';
import { estimateGlyphBatch, modelOutputCost } from '../src/core/cost';
import { makeItem, repairedTransparentOutputMode, resolveIconOutputMode } from '../src/core/library';
import { hydrateProject } from '../src/state/useProject';

describe('generation cost controls', () => {
  it('prices GPT Image 2 by quality', () => {
    expect(modelOutputCost('openai/gpt-image-2', 'low')).toBe(0.012);
    expect(modelOutputCost('openai/gpt-image-2', 'high')).toBe(0.128);
  });

  it('charges only AI-styled glyphs', () => {
    const exact = makeItem('Exact', { sourceUrl: '/glyph.svg', sourceMode: 'exact' });
    const styled = makeItem('Styled', { sourceUrl: '/glyph.svg', sourceMode: 'styled' });
    const named = makeItem('Named');
    expect(estimateGlyphBatch([exact, styled, named], 'openai/gpt-image-2', 'low')).toEqual({
      paid: 2, local: 1, outputs: 2, cost: 0.024,
    });
  });

  it('persists the explicitly selected GPT model tier', () => {
    expect(hydrateProject({ quality: 'high', qualitySelectionVersion: 1, premiumAllowed: true }).quality).toBe('high');
    expect(hydrateProject({ quality: 'automatic' as never }).quality).toBe('low');
  });

  it('migrates an old implicit High selection back to Low', () => {
    expect(hydrateProject({ quality: 'high', premiumAllowed: true }).quality).toBe('low');
  });

  it("persists the user's native-transparency choice", () => {
    expect(hydrateProject({ glyphTransparency: false }).glyphTransparency).toBe(false);
  });

  it('freezes legacy finished cards in their saved rendering mode', () => {
    const transparent = makeItem('Transparent', { status: 'ready', revision: 1 });
    const complete = makeItem('Complete', { status: 'ready', revision: 1 });
    const exact = makeItem('Exact', {
      status: 'ready', revision: 1, sourceUrl: '/glyph.svg', sourceMode: 'exact',
    });

    expect(hydrateProject({ glyphTransparency: true, items: [transparent] }).items[0].outputMode)
      .toBe('transparent');
    const opaque = hydrateProject({ glyphTransparency: false, items: [complete, exact] }).items;
    expect(opaque.map((item) => item.outputMode)).toEqual(['complete', 'composed']);
  });

  it('never lets the global toggle restyle a finished card', () => {
    const transparent = makeItem('Transparent', { outputMode: 'transparent' });
    const complete = makeItem('Complete', { outputMode: 'complete' });
    expect(resolveIconOutputMode(transparent, false)).toBe('transparent');
    expect(resolveIconOutputMode(complete, true)).toBe('complete');
  });

  it('removes added containers from existing AI results with real alpha', () => {
    const generated = makeItem('Generated', { status: 'ready', revision: 1, outputMode: 'complete' });
    const exact = makeItem('Exact', {
      status: 'ready', revision: 1, outputMode: 'composed', sourceUrl: '/glyph.svg', sourceMode: 'exact',
    });
    expect(repairedTransparentOutputMode(generated, true)).toBe('transparent');
    expect(repairedTransparentOutputMode(generated, false)).toBe('complete');
    expect(repairedTransparentOutputMode(exact, true)).toBe('composed');
  });

  it('clears legacy template rims but preserves a newly selected rim', () => {
    expect(hydrateProject({ compose: { rimWidth: 8 } as never }).compose.rimWidth).toBe(0);
    expect(hydrateProject({ borderlessVersion: 1, compose: { rimWidth: 8 } as never }).compose.rimWidth).toBe(8);
  });
});
