import { describe, expect, it } from 'vitest';
import { estimateGlyphBatch, modelOutputCost, needsPaidGeneration } from '../src/core/cost';
import {
  containerGenerationUsesAlpha,
  frameVariantTarget,
  makeItem,
  repairedTransparentOutputMode,
  resolveIconOutputMode,
  shouldMaskGeneratedCatalogSubject,
  stableFrameIndex,
} from '../src/core/library';
import { hydrateProject } from '../src/state/useProject';

describe('generation cost controls', () => {
  it('makes construction authoritative over legacy transparency state', () => {
    expect(containerGenerationUsesAlpha('filled')).toBe(false);
    expect(containerGenerationUsesAlpha('open-frame')).toBe(true);
    expect(containerGenerationUsesAlpha('isolated')).toBe(true);
  });

  it('never cuts a complete filled tile down to the catalog glyph silhouette', () => {
    expect(shouldMaskGeneratedCatalogSubject('filled')).toBe(false);
    expect(shouldMaskGeneratedCatalogSubject('open-frame')).toBe(true);
    expect(shouldMaskGeneratedCatalogSubject('isolated')).toBe(true);
  });

  it('bounds decorative frame pools from one to six reusable variants', () => {
    expect(frameVariantTarget(-20)).toBe(1);
    expect(frameVariantTarget(0)).toBe(1);
    expect(frameVariantTarget(70)).toBe(5);
    expect(frameVariantTarget(100)).toBe(6);
    expect(frameVariantTarget(500)).toBe(6);
  });

  it('assigns frame variants deterministically per icon', () => {
    expect(stableFrameIndex('search', 5)).toBe(stableFrameIndex('search', 5));
    expect(stableFrameIndex('search', 1)).toBe(0);
    expect(stableFrameIndex('search', 5)).toBeGreaterThanOrEqual(0);
    expect(stableFrameIndex('search', 5)).toBeLessThan(5);
  });

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

  it('always routes built-in Material glyphs through paid AI generation', () => {
    const staleExact = makeItem('Home', {
      sourceUrl: '/libraries/glyphs/material/home-fill.svg',
      sourceMode: 'exact',
    });
    expect(needsPaidGeneration(staleExact)).toBe(true);
    expect(estimateGlyphBatch([staleExact], 'openai/gpt-image-2', 'low')).toEqual({
      paid: 1, local: 0, outputs: 1, cost: 0.012,
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

  it('routes new open-frame cards through framed alpha composition', () => {
    const draft = makeItem('Home');
    expect(resolveIconOutputMode(draft, true, 'open-frame')).toBe('framed');
    expect(resolveIconOutputMode(draft, true, 'isolated')).toBe('transparent');
    expect(resolveIconOutputMode(draft, true, 'filled')).toBe('composed');
  });

  it('removes added containers from existing AI results with real alpha', () => {
    const generated = makeItem('Generated', { status: 'draft', revision: 1, outputMode: 'complete' });
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

  it('defaults and clamps independent style controls on saved projects', () => {
    expect(hydrateProject({}).styleFidelity).toBe(90);
    expect(hydrateProject({}).detailVariation).toBe(70);
    expect(hydrateProject({ styleFidelity: 140, detailVariation: -5 })).toMatchObject({
      styleFidelity: 100,
      detailVariation: 0,
    });
    expect(hydrateProject({ styleFidelity: Number.NaN, detailVariation: Number.NaN })).toMatchObject({
      styleFidelity: 90,
      detailVariation: 70,
    });
  });
});
