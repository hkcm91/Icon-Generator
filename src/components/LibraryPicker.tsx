import { useEffect, useMemo, useState } from 'react';
import { makeItem, type IconItem } from '../core/library';

interface CatalogEntry {
  name: string;
  concept?: string;
  category?: string;
  keywords?: string[];
}

interface Catalog {
  id: string;
  label: string;
  file: string;
  note?: string;
}

/**
 * Bundled libraries, fetched on demand rather than bundled into the JS.
 * Together they are ~400KB, which is fine to download when asked for and
 * wasteful to ship to someone who only wants four icons.
 */
const CATALOGS: Catalog[] = [
  { id: 'material', label: 'Material Symbols', file: '/libraries/material-symbols.json' },
  {
    id: 'brands',
    label: 'Brands',
    file: '/libraries/simple-icons.json',
    note: 'Brand names are trademarks of their owners. See SIMPLE-ICONS-DISCLAIMER.md.',
  },
  { id: 'y2k', label: 'Y2K Dream', file: '/libraries/y2k-dream.json' },
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

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.category?.toLowerCase().includes(needle) ||
        entry.keywords?.some((keyword) => keyword.toLowerCase().includes(needle)),
    );
  }, [entries, query]);

  const toItems = (rows: CatalogEntry[]): IconItem[] =>
    rows
      .filter((entry) => !already.has(entry.name.toLowerCase()))
      .map((entry) =>
        makeItem(entry.name, {
          concept: entry.concept ?? '',
          category: entry.category,
          keywords: entry.keywords,
        }),
      );

  const addAllMatching = () => {
    const items = toItems(matches);
    if (items.length) onAdd(items);
    onClose();
  };

  const addPicked = () => {
    const items = toItems(matches.filter((entry) => picked.has(entry.name)));
    if (items.length) onAdd(items);
    setPicked(new Set());
  };

  const newMatches = matches.filter((entry) => !already.has(entry.name.toLowerCase())).length;

  return (
    <div className="picker">
      <div className="picker-tabs">
        {CATALOGS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === catalogId ? 'chip chip-on' : 'chip'}
            onClick={() => setCatalogId(entry.id)}
          >
            {entry.label}
            {counts[entry.id] ? ` (${counts[entry.id].toLocaleString()})` : ''}
          </button>
        ))}
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
      </div>

      <input
        type="search"
        placeholder={`Search ${catalog.label}…`}
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
              const have = already.has(entry.name.toLowerCase());
              return (
                <label key={entry.name} className={have ? 'picker-row picker-have' : 'picker-row'}>
                  <input
                    type="checkbox"
                    disabled={have}
                    checked={picked.has(entry.name)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(entry.name);
                        else next.delete(entry.name);
                        return next;
                      })
                    }
                  />
                  <span className="picker-name">{entry.name}</span>
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
