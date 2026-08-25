import { describe, expect, it } from 'vitest';
import {
  materialPalettePrompt,
  mergeMaterialPalette,
  normalizeMaterialPalette,
} from '../src/core/materialPalette';

describe('material palettes', () => {
  it('keeps measured colors and one ordered recipe per visual role', () => {
    const palette = mergeMaterialPalette(
      [{ hex: '#0a141e', name: 'deep blue', weight: 0.7 }],
      [
        { role: 'frame', name: 'Ribbon', description: 'clear iridescent gel' },
        { role: 'glyph', name: 'Opal', description: 'milky filled volume' },
        { role: 'glyph', name: 'Duplicate', description: 'must be ignored' },
      ],
      { base: 'glossy blue', glyph: '', frame: '' },
    );
    expect(palette.colors[0].hex).toBe('#0a141e');
    expect(palette.recipes.map((recipe) => recipe.role)).toEqual(['base', 'glyph', 'frame']);
    expect(palette.recipes.find((recipe) => recipe.role === 'glyph')?.name).toBe('Opal');
  });

  it('writes role boundaries into every generation prompt', () => {
    const prompt = materialPalettePrompt({
      colors: [{ hex: '#dccfff', name: 'pale violet', weight: 1 }],
      recipes: [
        { role: 'glyph', name: 'Pearl', description: 'bright filled opal' },
        { role: 'frame', name: 'Glass', description: 'clear hollow ribbon' },
      ],
    });
    expect(prompt).toContain('APPROVED MATERIAL PALETTE');
    expect(prompt).toContain('Glyph material — Pearl');
    expect(prompt).toContain('Frame material — Glass');
    expect(prompt).toContain('do not swap');
  });

  it('never carries a filled base recipe into an open or isolated construction', () => {
    const recipes = [
      { role: 'base' as const, name: 'Wrong fill', description: 'opaque full tile' },
      { role: 'glyph' as const, name: 'Pearl', description: 'filled symbol' },
      { role: 'frame' as const, name: 'Ribbon', description: 'hollow border' },
    ];
    const open = mergeMaterialPalette([], recipes, { base: 'fallback fill', glyph: '', frame: '' }, 'open-frame-with-subject');
    expect(open.recipes.map((recipe) => recipe.role)).toEqual(['glyph', 'frame']);
    const isolated = mergeMaterialPalette([], recipes, { base: 'fallback fill', glyph: '', frame: 'fallback frame' }, 'isolated-subject');
    expect(isolated.recipes.map((recipe) => recipe.role)).toEqual(['glyph']);
  });

  it('sanitizes imported project palettes', () => {
    expect(normalizeMaterialPalette({
      colors: [{ hex: '#ABCDEF', name: ' sky ', weight: 8 }, { hex: 'bad' }],
      recipes: [
        { role: 'glyph', name: ' Pearl ', description: ' filled ' },
        { role: 'glyph', name: 'Duplicate', description: 'ignored' },
        { role: 'unknown', description: 'ignored' },
      ],
    })).toEqual({
      colors: [{ hex: '#abcdef', name: 'sky', weight: 1 }],
      recipes: [{ role: 'glyph', name: 'Pearl', description: 'filled' }],
    });
  });
});
