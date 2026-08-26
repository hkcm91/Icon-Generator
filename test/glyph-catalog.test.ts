import { describe, expect, it } from 'vitest';
import materialCatalog from '../public/libraries/material-symbols.json';
import {
  MATERIAL_ESSENTIALS,
  MOBILE_ICON_GROUPS,
  humanizeGlyphName,
  organizeGlyphEntries,
  type GlyphCatalogEntry,
} from '../src/core/glyphCatalog';

const rows: GlyphCatalogEntry[] = [
  { name: '10mp', slug: '10mp' },
  { name: 'calendar_month', slug: 'calendar_month' },
  { name: 'home', slug: 'home' },
  { name: 'shopping_cart', slug: 'shopping_cart' },
  { name: 'cloud', slug: 'cloud' },
];

describe('organized glyph catalog', () => {
  it('provides exactly 250 unique mobile essentials that exist in the bundled library', () => {
    const available = new Set(materialCatalog.map((entry) => entry.slug));

    expect(MATERIAL_ESSENTIALS).toHaveLength(250);
    expect(new Set(MATERIAL_ESSENTIALS).size).toBe(250);
    expect(MATERIAL_ESSENTIALS.filter((slug) => !available.has(slug))).toEqual([]);
  });

  it('organizes the mobile set as phone-focused categories without generic layout controls', () => {
    expect(Object.values(MOBILE_ICON_GROUPS).map((group) => group.length)).toEqual([
      35, 35, 30, 35, 30, 30, 30, 25,
    ]);
    expect(MATERIAL_ESSENTIALS).toContain('phone_in_talk');
    expect(MATERIAL_ESSENTIALS).toContain('grocery');
    expect(MATERIAL_ESSENTIALS).toContain('medication');
    expect(MATERIAL_ESSENTIALS).not.toContain('first_page');
    expect(MATERIAL_ESSENTIALS).not.toContain('view_sidebar');
    expect(MATERIAL_ESSENTIALS).not.toContain('toggle_on');
  });

  it('opens the mobile library on useful essentials instead of the raw inventory', () => {
    const result = organizeGlyphEntries(rows, 'mobile', 'all', '');
    expect(result.map((entry) => entry.slug)).toEqual(['home', 'calendar_month', 'cloud', 'shopping_cart']);
    expect(result.some((entry) => entry.slug === '10mp')).toBe(false);
  });

  it('keeps mobile search inside the 250-icon collection', () => {
    expect(organizeGlyphEntries(rows, 'mobile', 'all', '10mp')).toHaveLength(0);
    expect(organizeGlyphEntries(rows, 'material', 'all', '10mp')).toHaveLength(1);
  });

  it('turns source slugs into card-ready names', () => {
    expect(humanizeGlyphName('calendar_month', 'material')).toBe('Calendar Month');
    expect(humanizeGlyphName('YouTube', 'brands')).toBe('YouTube');
  });
});
