/**
 * Glyph library import.
 *
 * A family is a list of icons, and typing 250 of them into a text box is not a
 * workflow. This accepts the shapes such lists actually arrive in — the icon
 * manifests the desktop studio used, Simple Icons metadata, a CSV exported from
 * a spreadsheet, or a plain list of names pasted from anywhere — and turns them
 * all into the same card.
 *
 * Parsing is format-sniffed rather than selected by the user, because "which of
 * six importers is this file" is a question the file can answer itself.
 */

export type ItemStatus = 'draft' | 'queued' | 'generating' | 'ready' | 'failed';
export type IconOutputMode = 'transparent' | 'framed' | 'composed' | 'complete';
export type ContainerMode = 'isolated' | 'open-frame' | 'filled';

/** The construction picker is authoritative over legacy alpha preferences. */
export function containerGenerationUsesAlpha(mode: ContainerMode): boolean {
  return mode !== 'filled';
}

/**
 * Subject masks belong only to layered constructions. Applying one to a
 * complete filled-tile result would cut the generated container back off.
 */
export function shouldMaskGeneratedCatalogSubject(mode: ContainerMode): boolean {
  return mode !== 'filled';
}

/** 0% reuses one frame; 100% spreads the family across six approved frames. */
export function frameVariantTarget(detailVariation: number): number {
  const value = Math.max(0, Math.min(100, Number(detailVariation) || 0));
  return 1 + Math.round(value / 20);
}

/** Stable assignment: the same card keeps its frame across refreshes and exports. */
export function stableFrameIndex(itemId: string, count: number): number {
  if (count <= 1) return 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < itemId.length; index++) {
    hash = Math.imul(hash ^ itemId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash % count;
}

export interface IconItem {
  id: string;
  name: string;
  /** What to draw. Fed to the glyph prompt; the name alone is often enough. */
  concept: string;
  /** Optional semantic adaptation of the concept for the selected set theme. */
  themeTreatment?: string;
  /** Natural-language correction staged by Icon Director for this card. */
  directorInstruction?: string;
  category?: string;
  keywords?: string[];
  notes?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  role?: 'standard' | 'wide' | 'tall' | 'circular' | 'complex' | 'hero';
  opticalScale?: number;
  opticalOffsetX?: number;
  opticalOffsetY?: number;
  anchor?: boolean;
  calibration?: boolean;
  /** Original glyph artwork. Bundled catalog entries point at a real SVG. */
  sourceUrl?: string;
  /** Exact keeps source pixels; styled uses the source as generation guidance. */
  sourceMode?: 'exact' | 'styled';
  selected: boolean;
  status: ItemStatus;
  /** Increments on every successful render, so regenerations are countable. */
  revision: number;
  /** Revision currently shown/exported; revision remains the latest number. */
  activeRevision?: number;
  /** How this finished revision was rendered. The global toggle must not restyle it. */
  outputMode?: IconOutputMode;
  /** Explicit production sign-off for the current revision. */
  approved?: boolean;
  error?: string;
}

/**
 * Material Symbols are shape references, not finished artwork. They should be
 * shown to the image model alongside the family's appearance references so the
 * result is actually redrawn in the requested style. Brand and user-uploaded
 * artwork remain exact by default because fidelity is normally the point.
 */
export function isAiGuidedCatalogSource(sourceUrl?: string): boolean {
  return Boolean(sourceUrl?.includes('/libraries/glyphs/material/'));
}

export function defaultGlyphSourceMode(sourceUrl?: string): 'exact' | 'styled' {
  return !sourceUrl || isAiGuidedCatalogSource(sourceUrl) ? 'styled' : 'exact';
}

/** Built-in glyphs are references only, even if stale saved metadata says exact. */
export function usesAiGeneration(item: IconItem): boolean {
  return isAiGuidedCatalogSource(item.sourceUrl) || !item.sourceUrl || item.sourceMode === 'styled';
}

/**
 * Built-in SVG pixels are for picker recognition only. Passing them as an
 * image-model input made the expanded catalog dominate the user's appearance
 * reference and produced near-copies of the raw glyph. The item name/concept
 * remains the AI subject prompt. User artwork may still be styled by reference.
 */
export function modelGlyphReferenceSource(item: IconItem): string | null {
  return item.sourceUrl && !isAiGuidedCatalogSource(item.sourceUrl) ? item.sourceUrl : null;
}

export interface BuiltinGlyphRepair {
  items: IconItem[];
  clearedIds: string[];
}

/**
 * Before catalog mode v1, built-in Material glyphs were incorrectly pasted
 * locally and saved as if they were generated results. Convert only those old
 * cards to AI-guided drafts; never touch brand logos or uploaded artwork.
 */
export function repairLegacyBuiltinGlyphModes(items: IconItem[]): BuiltinGlyphRepair {
  const clearedIds: string[] = [];
  const repaired = items.map((item) => {
    if (!isAiGuidedCatalogSource(item.sourceUrl) || item.sourceMode === 'styled') return item;
    clearedIds.push(item.id);
    return {
      ...item,
      sourceMode: 'styled' as const,
      status: 'draft' as const,
      // Preserve batch selection. Auto-selecting hundreds of migrated cards
      // can exceed the cost guard and make Generate appear broken.
      selected: item.selected,
      revision: 0,
      activeRevision: undefined,
      outputMode: undefined,
      approved: false,
      error: undefined,
    };
  });
  return { items: repaired, clearedIds };
}

/**
 * Invalidate results made while catalog SVG pixels were sent to the model.
 * Those outputs can be indistinguishable from pasted glyphs and must not
 * survive the switch back to text-driven subject generation.
 */
export function resetBuiltinGlyphModelResults(items: IconItem[]): BuiltinGlyphRepair {
  const clearedIds: string[] = [];
  const repaired = items.map((item) => {
    if (!isAiGuidedCatalogSource(item.sourceUrl)) return item;
    clearedIds.push(item.id);
    return {
      ...item,
      sourceMode: 'styled' as const,
      status: 'draft' as const,
      selected: item.selected,
      revision: 0,
      activeRevision: undefined,
      outputMode: undefined,
      approved: false,
      error: undefined,
    };
  });
  return { items: repaired, clearedIds };
}

/** Finished cards keep their stored mode; the global toggle only supplies a draft default. */
export function resolveIconOutputMode(
  item: IconItem,
  wantAlpha: boolean,
  containerMode: ContainerMode = wantAlpha ? 'isolated' : 'filled',
): IconOutputMode {
  if (item.outputMode) return item.outputMode;
  if (containerMode === 'open-frame') return 'framed';
  if (containerMode === 'isolated') return 'transparent';
  if (wantAlpha) return 'composed';
  return usesAiGeneration(item) ? 'complete' : 'composed';
}

/**
 * Repair AI results that already contain real transparency but were previously
 * displayed through the container compositor. Exact SVG artwork is excluded:
 * it may have been intentionally composed over the family master.
 */
export function repairedTransparentOutputMode(
  item: IconItem,
  hasRealAlpha: boolean,
): IconOutputMode | undefined {
  if (item.outputMode === 'framed') return 'framed';
  const generated = usesAiGeneration(item);
  return generated && hasRealAlpha
    ? 'transparent'
    : item.outputMode;
}

let counter = 0;
/**
 * Ids are sequential rather than random so a re-import of the same file
 * produces the same ids, and so nothing here depends on Math.random.
 */
function nextId(name: string): string {
  counter += 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'icon'}-${counter}`;
}

export function makeItem(name: string, extra: Partial<IconItem> = {}): IconItem {
  return {
    id: nextId(name),
    name: name.trim(),
    concept: '',
    selected: true,
    status: 'draft',
    revision: 0,
    ...extra,
  };
}

/** Split a CSV line, honouring quoted cells containing commas. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is a literal quote.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** Ordered by preference: human-readable labels before machine slugs. */
const NAME_KEYS = ['name', 'title', 'label', 'icon', 'symbol'];
const CONCEPT_KEYS = ['concept', 'prompt', 'description', 'desc'];
const THEME_TREATMENT_KEYS = ['themetreatment', 'theme_treatment', 'treatment', 'themedconcept'];
const CATEGORY_KEYS = ['category', 'group'];
const KEYWORD_KEYS = ['keywords', 'tags'];

function parseCsv(text: string): IconItem[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  const header = csvCells(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = header.some((cell) => NAME_KEYS.includes(cell));
  const indexOf = (keys: string[]) => header.findIndex((cell) => keys.includes(cell));

  const nameAt = hasHeader ? indexOf(NAME_KEYS) : 0;
  const conceptAt = hasHeader ? indexOf(CONCEPT_KEYS) : 1;
  const themeTreatmentAt = hasHeader ? indexOf(THEME_TREATMENT_KEYS) : -1;
  const categoryAt = hasHeader ? indexOf(CATEGORY_KEYS) : -1;
  const keywordAt = hasHeader ? indexOf(KEYWORD_KEYS) : -1;

  return lines
    .slice(hasHeader ? 1 : 0)
    .map((line) => {
      const row = csvCells(line);
      const name = row[nameAt >= 0 ? nameAt : 0] ?? '';
      if (!name) return null;
      return makeItem(name, {
        concept: (conceptAt >= 0 ? row[conceptAt] : '') ?? '',
        themeTreatment: themeTreatmentAt >= 0 ? row[themeTreatmentAt] || undefined : undefined,
        category: categoryAt >= 0 ? row[categoryAt] || undefined : undefined,
        keywords:
          keywordAt >= 0 && row[keywordAt]
            ? row[keywordAt].split(/[;|]/).map((k) => k.trim()).filter(Boolean)
            : undefined,
      });
    })
    .filter((item): item is IconItem => item !== null);
}

function fromRecord(record: Record<string, unknown>): IconItem | null {
  // Iterate the *preference* order, not the record's key order. A y2k library
  // row carries both `symbol` ("star_shine") and `name` ("Sparkle Cluster");
  // scanning the record first would pick whichever the file happened to list
  // earlier and put a machine slug on the card.
  const pick = (keys: string[]) => {
    for (const wanted of keys) {
      for (const key of Object.keys(record)) {
        if (key.toLowerCase() !== wanted) continue;
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return '';
  };

  const name = pick(NAME_KEYS);
  if (!name) return null;

  const keywords = Object.keys(record).find((key) => KEYWORD_KEYS.includes(key.toLowerCase()));
  const rawKeywords = keywords ? record[keywords] : undefined;

  return makeItem(name, {
    concept: pick(CONCEPT_KEYS),
    themeTreatment: pick(THEME_TREATMENT_KEYS) || undefined,
    category: pick(CATEGORY_KEYS) || undefined,
    keywords: Array.isArray(rawKeywords)
      ? rawKeywords.filter((k): k is string => typeof k === 'string')
      : undefined,
  });
}

function parseJson(text: string): IconItem[] {
  const parsed = JSON.parse(text) as unknown;

  // Manifest form: { icons: [...] }. Also accept a few sibling key names.
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed
      ? ((parsed as Record<string, unknown>).icons ??
         (parsed as Record<string, unknown>).items ??
         (parsed as Record<string, unknown>).glyphs)
      : null;

  if (!Array.isArray(rows)) throw new Error('That JSON has no icon list in it.');

  return rows
    .map((row) =>
      typeof row === 'string'
        ? row.trim()
          ? makeItem(row)
          : null
        : row && typeof row === 'object'
          ? fromRecord(row as Record<string, unknown>)
          : null,
    )
    .filter((item): item is IconItem => item !== null);
}

/** One name per line, the format a pasted list actually takes. */
function parseLines(text: string): IconItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Tolerate "Name — concept" and "Name: concept" as a convenience.
      const split = line.match(/^(.+?)\s*(?:—|--|:)\s*(.+)$/);
      return split ? makeItem(split[1], { concept: split[2] }) : makeItem(line);
    });
}

export function parseLibrary(text: string, filename = ''): IconItem[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const looksJson = trimmed.startsWith('[') || trimmed.startsWith('{');
  const looksCsv =
    /\.csv$/i.test(filename) ||
    (!looksJson && trimmed.split(/\r?\n/)[0].includes(',') && trimmed.includes('\n'));

  if (looksJson) return dedupe(parseJson(trimmed));
  if (looksCsv) return dedupe(parseCsv(trimmed));
  return dedupe(parseLines(trimmed));
}

/**
 * Drop repeats by name.
 *
 * Icon lists are routinely concatenated from several sources, and a family with
 * two "Settings" cards produces two icons that then disagree with each other.
 */
export function dedupe(items: IconItem[]): IconItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Reset ids — exported so tests can assert on stable output. */
export function resetIdCounter() {
  counter = 0;
}
