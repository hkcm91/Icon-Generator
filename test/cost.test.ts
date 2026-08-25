import { describe, expect, it } from 'vitest';
import { estimateGlyphBatch, modelOutputCost } from '../src/core/cost';
import { makeItem } from '../src/core/library';
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

  it('does not restore a legacy high-cost front-page tier', () => {
    expect(hydrateProject({ quality: 'high', premiumAllowed: true }).quality).toBe('low');
  });

  it("persists the user's native-transparency choice", () => {
    expect(hydrateProject({ glyphTransparency: false }).glyphTransparency).toBe(false);
  });
});
