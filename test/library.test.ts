import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyGenerationItemPatch,
  dedupe,
  defaultGlyphSourceMode,
  makeItem,
  modelGlyphReferenceSource,
  parseLibrary,
  repairedTransparentOutputMode,
  repairLegacyBuiltinGlyphModes,
  resetBuiltinGlyphModelResults,
  resetIdCounter,
  resolveGenerationContainerMode,
  resolveIconOutputMode,
} from '../src/core/library';
import { runPool } from '../src/core/queue';

beforeEach(() => resetIdCounter());

describe('generation card updates', () => {
  it('preserves a live selection while applying ready-state progress', () => {
    const item = makeItem('Moon', { selected: true, status: 'generating' });
    const updated = applyGenerationItemPatch([item], item.id, {
      status: 'ready',
      revision: 1,
      activeRevision: 1,
    });

    expect(updated[0]).toMatchObject({ selected: true, status: 'ready', revision: 1 });
  });
});

describe('optional open-frame preparation', () => {
  it('falls back to one-pass complete icons until a reusable frame exists', () => {
    expect(resolveGenerationContainerMode('open-frame', false)).toBe('filled');
    expect(resolveGenerationContainerMode('open-frame', true)).toBe('open-frame');
    expect(resolveGenerationContainerMode('isolated', false)).toBe('isolated');
    expect(resolveGenerationContainerMode('filled', false)).toBe('filled');
  });
});

describe('parsing an icon list', () => {
  it('reads one name per line', () => {
    const items = parseLibrary('Settings\nMessages\nCamera');
    expect(items.map((i) => i.name)).toEqual(['Settings', 'Messages', 'Camera']);
    expect(items.every((i) => i.selected)).toBe(true);
    expect(items.every((i) => i.status === 'draft')).toBe(true);
  });

  it('splits "Name — concept" and "Name: concept"', () => {
    const items = parseLibrary('Weather — a sun behind a cloud\nMusic: a quaver');
    expect(items[0]).toMatchObject({ name: 'Weather', concept: 'a sun behind a cloud' });
    expect(items[1]).toMatchObject({ name: 'Music', concept: 'a quaver' });
  });

  it('reads a CSV with a header in any column order', () => {
    const items = parseLibrary('concept,name\na rising bar chart,Analytics\na gear,Settings');
    expect(items[0]).toMatchObject({ name: 'Analytics', concept: 'a rising bar chart' });
    expect(items[1]).toMatchObject({ name: 'Settings', concept: 'a gear' });
  });

  it('reads a headerless CSV positionally', () => {
    const items = parseLibrary('Analytics,a rising bar chart\nSettings,a gear', 'list.csv');
    expect(items[0]).toMatchObject({ name: 'Analytics', concept: 'a rising bar chart' });
  });

  it('honours quoted CSV cells containing commas', () => {
    const items = parseLibrary('name,concept\nMessages,"two bubbles, overlapping"');
    expect(items[0].concept).toBe('two bubbles, overlapping');
  });

  it('handles doubled quotes inside a quoted cell', () => {
    const items = parseLibrary('name,concept\nQuote,"a ""smart"" quote mark"');
    expect(items[0].concept).toBe('a "smart" quote mark');
  });

  it('reads a JSON array of objects', () => {
    const items = parseLibrary(
      JSON.stringify([{ name: 'Camera', concept: 'a lens', category: 'Media' }]),
    );
    expect(items[0]).toMatchObject({ name: 'Camera', concept: 'a lens', category: 'Media' });
  });

  it('reads the manifest form with an icons key', () => {
    const items = parseLibrary(
      JSON.stringify({ icons: [{ label: 'Analytics', concept: 'three columns' }] }),
    );
    expect(items[0]).toMatchObject({ name: 'Analytics', concept: 'three columns' });
  });

  it('reads the Simple Icons metadata shape', () => {
    // {title, slug, hex} — no concept field at all.
    const items = parseLibrary(JSON.stringify([{ title: 'GitHub', slug: 'github', hex: '181717' }]));
    expect(items[0].name).toBe('GitHub');
    expect(items[0].concept).toBe('');
  });

  it('reads the y2k library shape, preferring name over symbol', () => {
    const items = parseLibrary(
      JSON.stringify([
        {
          symbol: 'star_shine',
          name: 'Sparkle Cluster',
          category: 'Y2K Celestial',
          concept: 'One large four-point sparkle',
          keywords: ['y2k', 'sparkle'],
        },
      ]),
    );
    expect(items[0]).toMatchObject({ name: 'Sparkle Cluster', concept: 'One large four-point sparkle' });
    expect(items[0].keywords).toEqual(['y2k', 'sparkle']);
  });

  it('reads a JSON array of bare strings', () => {
    expect(parseLibrary('["Settings","Camera"]').map((i) => i.name)).toEqual(['Settings', 'Camera']);
  });

  it('drops duplicates by name, case-insensitively', () => {
    // Concatenated lists routinely repeat; two "Settings" cards would produce
    // two icons that then disagree with each other.
    const items = parseLibrary('Settings\nsettings\nSETTINGS\nCamera');
    expect(items.map((i) => i.name)).toEqual(['Settings', 'Camera']);
  });

  it('gives every item a distinct id', () => {
    const items = parseLibrary('Settings\nCamera\nMusic');
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it('returns nothing for empty input rather than throwing', () => {
    expect(parseLibrary('')).toEqual([]);
    expect(parseLibrary('   \n  ')).toEqual([]);
  });

  it('reports unusable JSON clearly', () => {
    expect(() => parseLibrary('{"nope": 1}')).toThrow(/no icon list/i);
  });

  it('scales to a large list', () => {
    const many = Array.from({ length: 300 }, (_v, i) => `Icon ${i}`).join('\n');
    expect(parseLibrary(many)).toHaveLength(300);
  });
});

describe('dedupe', () => {
  it('keeps the first occurrence', () => {
    const kept = dedupe([makeItem('A', { concept: 'first' }), makeItem('A', { concept: 'second' })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].concept).toBe('first');
  });
});

describe('built-in glyph generation mode', () => {
  it('routes bundled Material and brand subjects to AI but preserves uploads', () => {
    expect(defaultGlyphSourceMode('/libraries/glyphs/material/home-fill.svg')).toBe('styled');
    expect(defaultGlyphSourceMode('/libraries/glyphs/brands/github.svg')).toBe('styled');
    expect(defaultGlyphSourceMode('data:image/png;base64,abc')).toBe('exact');
    expect(defaultGlyphSourceMode()).toBe('styled');
  });

  it('never sends built-in SVG pixels to the image model', () => {
    const material = makeItem('Home', {
      sourceUrl: '/libraries/glyphs/material/home-fill.svg',
      sourceMode: 'styled',
    });
    const upload = makeItem('Custom', {
      sourceUrl: 'data:image/png;base64,abc',
      sourceMode: 'styled',
    });
    expect(modelGlyphReferenceSource(material)).toBeNull();
    expect(modelGlyphReferenceSource(upload)).toBe(upload.sourceUrl);
  });

  it('invalidates catalog results generated from raw SVG model inputs', () => {
    const material = makeItem('Home', {
      sourceUrl: '/libraries/glyphs/material/home-fill.svg',
      sourceMode: 'styled',
      status: 'ready',
      selected: true,
      revision: 2,
      outputMode: 'transparent',
    });
    const ordinary = makeItem('Cloud', { status: 'ready', revision: 1 });
    const repair = resetBuiltinGlyphModelResults([material, ordinary]);
    expect(repair.clearedIds).toEqual([material.id]);
    expect(repair.items[0]).toMatchObject({
      status: 'draft', selected: true, revision: 0, sourceMode: 'styled',
    });
    expect(repair.items[0].outputMode).toBeUndefined();
    expect(repair.items[1]).toBe(ordinary);
  });

  it('clears legacy pasted Material and brand results without changing batch selection', () => {
    const material = makeItem('Home', {
      sourceUrl: '/libraries/glyphs/material/home-fill.svg',
      sourceMode: 'exact',
      status: 'ready',
      selected: false,
      revision: 3,
      activeRevision: 3,
      outputMode: 'transparent',
      approved: true,
    });
    const brand = makeItem('GitHub', {
      sourceUrl: '/libraries/glyphs/brands/github.svg',
      sourceMode: 'exact',
      status: 'ready',
      selected: false,
      revision: 1,
    });
    const repair = repairLegacyBuiltinGlyphModes([material, brand]);

    expect(repair.clearedIds).toEqual([material.id, brand.id]);
    expect(repair.items[0]).toMatchObject({
      sourceMode: 'styled',
      status: 'draft',
      selected: false,
      revision: 0,
      approved: false,
    });
    expect(repair.items[0].outputMode).toBeUndefined();
    expect(repair.items[1]).toMatchObject({
      sourceMode: 'styled',
      status: 'draft',
      selected: false,
      revision: 0,
      approved: false,
    });
    expect(repair.items[1].outputMode).toBeUndefined();
  });
});

describe('BYOC output mode', () => {
  it('keeps a finished glass overlay when the global container choice changes', () => {
    const item = makeItem('Search', { status: 'ready', outputMode: 'overlay' });
    expect(resolveIconOutputMode(item, true, 'isolated')).toBe('overlay');
    expect(resolveIconOutputMode(item, false, 'filled')).toBe('overlay');
    expect(resolveIconOutputMode(item, true, 'open-frame')).toBe('overlay');
  });

  it('does not strip an explicit glass overlay during legacy alpha repair', () => {
    const item = makeItem('Search', {
      sourceMode: 'styled',
      status: 'ready',
      outputMode: 'overlay',
    });
    expect(repairedTransparentOutputMode(item, true)).toBe('overlay');
  });

  it('does not reclassify a complete transparent tile as an isolated subject', () => {
    const item = makeItem('Disc', {
      sourceMode: 'styled',
      status: 'ready',
      outputMode: 'complete',
    });
    expect(repairedTransparentOutputMode(item, true)).toBe('complete');
  });
});

describe('worker pool', () => {
  it('processes every item', async () => {
    const items = Array.from({ length: 20 }, (_v, i) => i);
    const results = await runPool(items, 4, async (n) => n * 2);
    expect(results).toHaveLength(20);
    expect(results.map((r) => r.result)).toEqual(items.map((n) => n * 2));
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await runPool(Array.from({ length: 30 }, (_v, i) => i), 5, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((done) => setTimeout(done, 1));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it('isolates a failure instead of losing the whole batch', async () => {
    const results = await runPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('nope');
      return n;
    });
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(results.filter((r) => r.result !== undefined)).toHaveLength(2);
  });

  it('reports progress that ends complete', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4], 2, async (n) => n, (p) => seen.push(p.completed));
    expect(seen[seen.length - 1]).toBe(4);
  });

  it('counts failures in progress', async () => {
    let last = { total: 0, completed: 0, active: 0, failed: 0 };
    await runPool([1, 2, 3], 1, async (n) => {
      if (n !== 3) throw new Error('no');
      return n;
    }, (p) => { last = p; });
    expect(last.failed).toBe(2);
  });

  it('stops taking new work when asked', async () => {
    let started = 0;
    await runPool(Array.from({ length: 50 }, (_v, i) => i), 2, async () => {
      started++;
      await new Promise((done) => setTimeout(done, 1));
    }, undefined, () => started >= 6);
    expect(started).toBeLessThan(20);
  });

  it('handles an empty list', async () => {
    expect(await runPool([], 4, async () => 1)).toEqual([]);
  });
});
