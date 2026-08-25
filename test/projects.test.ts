import { describe, expect, it } from 'vitest';
import { upsertProjectSummary, type SavedProjectSummary } from '../src/core/projectLibrary';
import { hydrateProject } from '../src/state/useProject';

const summary = (id: string, updatedAt: string, name = id): SavedProjectSummary => ({
  id,
  name,
  updatedAt,
  iconCount: 1,
});

describe('saved icon sets', () => {
  it('keeps multiple sets and orders the most recently saved first', () => {
    const first = upsertProjectSummary([], summary('a', '2026-01-01T00:00:00.000Z'));
    const both = upsertProjectSummary(first, summary('b', '2026-02-01T00:00:00.000Z'));
    expect(both.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('updates one saved set without duplicating it', () => {
    const existing = [summary('a', '2026-01-01T00:00:00.000Z', 'Old')];
    const updated = upsertProjectSummary(existing, summary('a', '2026-03-01T00:00:00.000Z', 'New'));
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('New');
  });
});

describe('project catalog migration', () => {
  it('marks legacy projects for one-time stored-glyph repair', () => {
    expect(hydrateProject({ items: [] }).builtinGlyphStyleVersion).toBe(0);
  });

  it('does not repeat the repair after catalog mode v1 was saved', () => {
    expect(hydrateProject({ items: [], builtinGlyphStyleVersion: 1 }).builtinGlyphStyleVersion).toBe(1);
  });
});
