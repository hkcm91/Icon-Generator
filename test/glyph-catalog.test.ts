import { describe, expect, it } from 'vitest';
import { humanizeGlyphName, organizeGlyphEntries, type GlyphCatalogEntry } from '../src/core/glyphCatalog';

const rows: GlyphCatalogEntry[] = [
  { name: '10mp', slug: '10mp' },
  { name: 'calendar_month', slug: 'calendar_month' },
  { name: 'home', slug: 'home' },
  { name: 'shopping_cart', slug: 'shopping_cart' },
  { name: 'cloud', slug: 'cloud' },
];

describe('organized glyph catalog', () => {
  it('opens Material on useful essentials instead of the raw alphabetical inventory', () => {
    const result = organizeGlyphEntries(rows, 'material', 'essentials', '');
    expect(result.map((entry) => entry.slug)).toEqual(['home', 'calendar_month', 'shopping_cart', 'cloud']);
    expect(result.some((entry) => entry.slug === '10mp')).toBe(false);
  });

  it('searches the entire active library even when a curated section is selected', () => {
    expect(organizeGlyphEntries(rows, 'material', 'essentials', '10mp')).toHaveLength(1);
  });

  it('turns source slugs into card-ready names', () => {
    expect(humanizeGlyphName('calendar_month', 'material')).toBe('Calendar Month');
    expect(humanizeGlyphName('YouTube', 'brands')).toBe('YouTube');
  });
});
