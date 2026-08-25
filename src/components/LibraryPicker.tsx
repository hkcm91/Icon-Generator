import { useEffect, useMemo, useState } from 'react';
import { makeItem, type IconItem } from '../core/library';
import {
  GLYPH_SECTIONS,
  glyphEntryKey,
  humanizeGlyphName,
  organizeGlyphEntries,
  type GlyphCatalogEntry as CatalogEntry,
  type GlyphCatalogId,
} from '../core/glyphCatalog';

interface Catalog {
  id: GlyphCatalogId;
  label: string;
  file: string;
  note?: string;
  source?: (entry: CatalogEntry) => string | undefined;
}

/**
 * Bundled libraries, fetched on demand rather than bundled into the JS.
 * Together they are ~400KB, which is fine to download when asked for and
 * wasteful to ship to someone who only wants four icons.
 */
const CATALOGS: Catalog[] = [
  {
    id: 'material',
    label: 'Everyday symbols',
    file: '/libraries/material-symbols.json',
    source: (entry) => entry.slug ? `/libraries/glyphs/material/${entry.slug}-fill.svg` : undefined,
  },
  {
    id: 'y2k',
    label: 'Curated concepts',
    file: '/libraries/y2k-dream.json',
  },
  {
    id: 'brands',
    label: 'Brand logos',
    file: '/libraries/simple-icons.json',
    source: (entry) => entry.slug ? `/libraries/glyphs/brands/${entry.slug}.svg` : undefined,
    note: 'Brand names are trademarks of their owners. See SIMPLE-ICONS-DISCLAIMER.md.',
  },
];

/** Rows rendered at once. The full list is thousands long; the DOM need not be. */
const VISIBLE_LIMIT = 150;

interface Props {
  existing: IconItem[];
  onAdd: (items: IconItem[]) => void;
  onClose: () => void;
}

export default function LibraryPicker({ existing, onAdd, onClose }: Props) {
  const [catalogId, setCatalogId] = useState(CATALOGS[0].id);
  const [sectionId, setSectionId] = useState(GLYPH_SECTIONS.material[0].id);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const catalog = CATALOGS.find((entry) => entry.id === catalogId) ?? CATALOGS[0];
  const already = useMemo(
    () => new Set(existing.map((item) => item.name.toLowerCase())),
    [existing],
  );
  const sections = GLYPH_SECTIONS[catalogId];
  const section = sections.find((candidate) => candidate.id === sectionId) ?? sections[0];

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setPicked(new Set());
    fetch(catalog.file)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${catalog.label}.`);
        return response.json();
      })
      .then((rows: CatalogEntry[]) => {
        if (!live) return;
        setEntries(rows);
        setCounts((current) => ({ ...current, [catalog.id]: rows.length }));
      })
      .catch((cause) => live && setError((cause as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [catalog]);

  const matches = useMemo(
    () => organizeGlyphEntries(entries, catalogId, sectionId, query),
    [entries, catalogId, sectionId, query],
  );

  const toItems = (rows: CatalogEntry[]): IconItem[] =>
    rows
      .filter((entry) => !already.has(humanizeGlyphName(entry.name, catalogId).toLowerCase()))
      .map((entry) =>
        makeItem(humanizeGlyphName(entry.name, catalogId), {
          concept: entry.concept ?? '',
          category: entry.category,
          keywords: entry.keywords,
          sourceUrl: catalog.source?.(entry),
          sourceMode: catalog.source?.(entry) ? 'exact' : 'styled',
        }),
      );

  const addAllMatching = () => {
    const items = toItems(matches);
    if (items.length) onAdd(items);
    onClose();
  };

  const addPicked = () => {
    const items = toItems(matches.filter((entry) => picked.has(glyphEntryKey(entry))));
    if (items.length) onAdd(items);
    setPicked(new Set());
  };

  const newMatches = matches.filter(
    (entry) => !already.has(humanizeGlyphName(entry.name, catalogId).toLowerCase()),
  ).length;

  return (
    <div className="picker">
      <div className="picker-tabs">
        {CATALOGS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === catalogId ? 'chip chip-on' : 'chip'}
            onClick={() => {
              setCatalogId(entry.id);
              setSectionId(GLYPH_SECTIONS[entry.id][0].id);
              setQuery('');
            }}
          >
            {entry.label}
            {counts[entry.id] ? ` (${counts[entry.id].toLocaleString()})` : ''}
          </button>
        ))}
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="picker-sections" aria-label={`${catalog.label} categories`}>
        {sections.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={candidate.id === section.id ? 'chip chip-on' : 'chip'}
            onClick={() => setSectionId(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <p className="picker-section-note">
        {query.trim() ? `Searching all ${catalog.label.toLowerCase()}.` : section.description}
      </p>

      <input
        type="search"
          placeholder={`Search all ${catalog.label.toLowerCase()}…`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {catalog.note && <p className="hint">{catalog.note}</p>}
      {error && <p className="status status-error">{error}</p>}

      {loading ? (
        <p className="hint">Loading {catalog.label}…</p>
      ) : (
        <>
          <p className="hint">
            {matches.length.toLocaleString()} match{matches.length === 1 ? '' : 'es'}
            {matches.length !== newMatches && ` · ${newMatches.toLocaleString()} not already added`}
            {matches.length > VISIBLE_LIMIT && ` · showing the first ${VISIBLE_LIMIT}`}
          </p>

          <div className="picker-list">
            {matches.slice(0, VISIBLE_LIMIT).map((entry) => {
              const displayName = humanizeGlyphName(entry.name, catalogId);
              const entryKey = glyphEntryKey(entry);
              const have = already.has(displayName.toLowerCase());
              return (
                <label key={entryKey} className={have ? 'picker-row picker-have' : 'picker-row'}>
                  <input
                    type="checkbox"
                    disabled={have}
                    checked={picked.has(entryKey)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(entryKey);
                        else next.delete(entryKey);
                        return next;
                      })
                    }
                  />
                  {catalog.source?.(entry) && (
                    <img className="picker-glyph" src={catalog.source(entry)} alt="" loading="lazy" />
                  )}
                  <span className="picker-name">{displayName}</span>
                  {have && <span className="badge">added</span>}
                  {entry.concept && <span className="picker-concept">{entry.concept}</span>}
                </label>
              );
            })}
          </div>

          <div className="row">
            <button type="button" onClick={addPicked} disabled={!picked.size}>
              Add {picked.size || ''} checked
            </button>
            <button type="button" className="ghost" onClick={addAllMatching} disabled={!newMatches}>
              Add all {newMatches.toLocaleString()}
              {query.trim() ? ' matching' : ''}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
