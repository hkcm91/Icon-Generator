import { describe, expect, it } from 'vitest';
import materialCatalog from '../public/libraries/material-symbols.json';
import brandCatalog from '../public/libraries/simple-icons.json';
import {
  BRAND_CURATED,
  MATERIAL_ESSENTIALS,
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

  it('opens the mobile library on useful essentials instead of the raw inventory', () => {
    const result = organizeGlyphEntries(rows, 'mobile', 'all', '');
    expect(result.map((entry) => entry.slug)).toEqual(['home', 'calendar_month', 'cloud', 'shopping_cart']);
    expect(result.some((entry) => entry.slug === '10mp')).toBe(false);
  });

  it('keeps mobile search inside the 250-icon collection', () => {
    expect(organizeGlyphEntries(rows, 'mobile', 'all', '10mp')).toHaveLength(0);
    expect(organizeGlyphEntries(rows, 'material', 'all', '10mp')).toHaveLength(1);
  });

  it('curates only brands that still ship in the bundled Simple Icons inventory', () => {
    // Simple Icons removes brands on trademark request, which turns a curated slug
    // into a card that renders nothing. Catch that here rather than in the picker.
    const available = new Set(brandCatalog.map((entry) => entry.slug));

    expect(BRAND_CURATED.filter((slug) => !available.has(slug))).toEqual([]);
    expect(new Set(BRAND_CURATED).size).toBe(BRAND_CURATED.length);
  });

  it('orders brand sections by demand and leaves the long tail alphabetical', () => {
    const brands: GlyphCatalogEntry[] = [
      { name: 'Zapier', slug: 'zapier' },
      { name: 'Reddit', slug: 'reddit' },
      { name: 'Instagram', slug: 'instagram' },
      { name: 'Airbnb', slug: 'airbnb' },
      { name: 'TikTok', slug: 'tiktok' },
    ];

    expect(organizeGlyphEntries(brands, 'brands', 'all', '').map((entry) => entry.slug))
      .toEqual(['instagram', 'tiktok', 'reddit', 'airbnb', 'zapier']);
  });

  it('keeps brands dropped from Simple Icons out of the popular section', () => {
    const popular = organizeGlyphEntries(
      brandCatalog as GlyphCatalogEntry[],
      'brands',
      'popular',
      '',
    );

    expect(popular.map((entry) => entry.slug).slice(0, 5))
      .toEqual(['instagram', 'tiktok', 'youtube', 'facebook', 'x']);
    expect(popular.every((entry) => entry.slug !== undefined)).toBe(true);
  });

  it('surfaces social marks the old keyword list missed', () => {
    const social = organizeGlyphEntries(brandCatalog as GlyphCatalogEntry[], 'brands', 'social', '');
    const slugs = social.map((entry) => entry.slug);

    for (const slug of ['x', 'line', 'bluesky', 'messenger', 'signal']) {
      expect(slugs).toContain(slug);
    }
  });

  it('turns source slugs into card-ready names', () => {
    expect(humanizeGlyphName('calendar_month', 'material')).toBe('Calendar Month');
    expect(humanizeGlyphName('YouTube', 'brands')).toBe('YouTube');
  });
});
