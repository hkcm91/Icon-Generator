import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_COMPOSE, type ComposeOptions } from '../core/compose';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../core/spec';
import { DEFAULT_VISION_MODEL } from '../core/vision';
import type { ContainerMode, IconItem } from '../core/library';
import type { ThemeSuggestion } from '../core/vision';
import { normalizeMaterialPalette, type MaterialPalette } from '../core/materialPalette';

const STORAGE_KEY = 'icon-generator-project-v1';

export interface Project {
  /** Human-readable family name used by project and export packages. */
  name: string;
  /** false shows the guided four-step view; true shows every control. */
  advanced: boolean;
  spec: ContainerSpec;
  compose: ComposeOptions;
  model: string;
  quality: 'low' | 'medium' | 'high';
  /** Versioned proof that the tier came from the explicit priced dropdown. */
  qualitySelectionVersion: number;
  /** Versioned proof that a saved rim was chosen after borderless became the default. */
  borderlessVersion: number;
  /** Built-in Material SVGs are AI shape guidance, not locally pasted results. */
  builtinGlyphStyleVersion: number;
  /** Built-in subjects are prompted by text; their raw SVG pixels never enter the model. */
  catalogTextSubjectVersion: number;
  premiumAllowed: boolean;
  /** Vision model used to name the symbol in an uploaded master. */
  visionModel: string;
  materialDescription: string;
  familyPrompt: string;
  negativePrompt: string;
  glyphSubject: string;
  glyphStyle: string;
  glyphColor: string;
  /** Literal content detected in the master. Kept separate from requested subjects. */
  referenceSubject: string;
  /** Transferable visual properties detected in the master. */
  styleProfile: string;
  subjectStyleProfile: string;
  frameStyleProfile: string;
  /** Measured colors plus role-specific texture recipes from the master. */
  materialPalette: MaterialPalette | null;
  /** Prompt-level match strength for stable material/palette/lighting. */
  styleFidelity: number;
  /** Controls microdetail rearrangement and the size of the frame variant pool. */
  detailVariation: number;
  /** Optional set direction explicitly chosen by the user. */
  theme: string;
  themeSuggestions: ThemeSuggestion[];
  /** The approved master: every generation references it. */
  master: { name: string; dataUrl: string } | null;
  /** Reuse the approved container pixels instead of repainting the material. */
  lockedContainer: boolean;
  /** Ask capable models for an isolated native-alpha glyph; off uses chroma keying. */
  glyphTransparency: boolean;
  /** Whether exports are an isolated glyph, alpha-bearing frame, or filled tile. */
  containerMode: ContainerMode;
  /** Open-frame samples containing a subject are blocked until cleaned or approved. */
  frameReady: boolean;
  /** Additional appearance references shared by the family. */
  references: Array<{ name: string; dataUrl: string }>;
  /** Production export gate. */
  exportApprovedOnly: boolean;
  exportSelectedOnly: boolean;
  /** Library cards. Metadata only — rendered images are not persisted. */
  items: IconItem[];
  /** How many generations run at once. */
  concurrency: number;
  /** Hard ceiling for one click's estimated image-generation spend. */
  maxBatchCost: number;
}

const DEFAULT_PROJECT: Project = {
  name: 'My Icon Family',
  advanced: false,
  spec: DEFAULT_SPEC,
  compose: DEFAULT_COMPOSE,
  model: 'openai/gpt-image-2',
  quality: 'low',
  qualitySelectionVersion: 1,
  borderlessVersion: 1,
  builtinGlyphStyleVersion: 1,
  catalogTextSubjectVersion: 1,
  premiumAllowed: false,
  visionModel: DEFAULT_VISION_MODEL,
  // Empty by design. A pre-filled default is indistinguishable from a field
  // that auto-fill failed to touch, which is exactly the confusion to avoid
  // when uploading a master is supposed to write these for you.
  materialDescription: '',
  familyPrompt: '',
  negativePrompt: '',
  glyphSubject: '',
  glyphStyle: '',
  glyphColor: '#ffffff',
  referenceSubject: '',
  styleProfile: '',
  subjectStyleProfile: '',
  frameStyleProfile: '',
  materialPalette: null,
  styleFidelity: 90,
  detailVariation: 70,
  theme: '',
  themeSuggestions: [],
  master: null,
  lockedContainer: false,
  glyphTransparency: true,
  containerMode: 'isolated',
  frameReady: false,
  references: [],
  exportApprovedOnly: false,
  exportSelectedOnly: false,
  items: [],
  concurrency: 3,
  maxBatchCost: 1,
};

function percentage(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : fallback;
}

export function hydrateProject(parsed: Partial<Project>): Project {
  const migrateExpensiveDefault = parsed.quality === undefined && parsed.model === 'google/nano-banana-pro';
  const compose = { ...DEFAULT_COMPOSE, ...(parsed.compose ?? {}) };
  const savedTransparency = parsed.glyphTransparency ?? true;
  return {
    ...DEFAULT_PROJECT,
    ...parsed,
    model: migrateExpensiveDefault ? 'openai/gpt-image-2' : (parsed.model ?? DEFAULT_PROJECT.model),
    // Values saved before the priced tier dropdown existed were implicit and
    // are the source of the surprise $0.128 selection. Migrate them to Low.
    quality: parsed.qualitySelectionVersion === 1 && (parsed.quality === 'medium' || parsed.quality === 'high')
      ? parsed.quality
      : 'low',
    qualitySelectionVersion: 1,
    borderlessVersion: 1,
    // Existing projects need their old locally pasted Material results cleared
    // after IndexedDB has loaded. App performs that one-time image repair.
    builtinGlyphStyleVersion: parsed.builtinGlyphStyleVersion ?? (parsed.items ? 0 : 1),
    catalogTextSubjectVersion: parsed.catalogTextSubjectVersion ?? (parsed.items ? 0 : 1),
    premiumAllowed: migrateExpensiveDefault ? false : (parsed.premiumAllowed ?? false),
    maxBatchCost: Math.max(0, parsed.maxBatchCost ?? 1),
    glyphTransparency: savedTransparency,
    containerMode: parsed.containerMode ?? (savedTransparency ? 'isolated' : 'filled'),
    frameReady: parsed.frameReady ?? false,
    materialPalette: normalizeMaterialPalette(parsed.materialPalette),
    styleFidelity: percentage(parsed.styleFidelity, 90),
    detailVariation: percentage(parsed.detailVariation, 70),
    spec: normalizeSpec(parsed.spec),
    // Older project/template JSON could silently carry a dark analytic rim.
    // Clear it once; rims intentionally selected after this migration persist.
    compose: {
      ...compose,
      rimWidth: parsed.borderlessVersion === 1 ? compose.rimWidth : 0,
    },
    items: (parsed.items ?? []).map((item) => {
      if (item.status === 'queued' || item.status === 'generating') {
        return { ...item, status: 'draft' as const, error: undefined };
      }
      if (item.status === 'ready' && !item.outputMode) {
        const generated = !item.sourceUrl || item.sourceMode === 'styled';
        return {
          ...item,
          // Freeze legacy cards in the exact mode in which the saved project
          // was already displaying them. Future toggle changes cannot restyle
          // completed work.
          outputMode: savedTransparency ? 'transparent' as const : generated ? 'complete' as const : 'composed' as const,
        };
      }
      return item;
    }),
  };
}

function load(): Project {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PROJECT;
    const parsed = JSON.parse(stored) as Partial<Project>;
    return hydrateProject(parsed);
  } catch {
    // A corrupt autosave should cost the user their layout, not the app.
    return DEFAULT_PROJECT;
  }
}

export function useProject() {
  const [project, setProject] = useState<Project>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // Private-mode quota failures are not worth interrupting the session.
    }
  }, [project]);

  const setSpec = useCallback((patch: Partial<ContainerSpec>) => {
    setProject((current) => ({ ...current, spec: normalizeSpec({ ...current.spec, ...patch }) }));
  }, []);

  const setCompose = useCallback((patch: Partial<ComposeOptions>) => {
    setProject((current) => ({ ...current, compose: { ...current.compose, ...patch } }));
  }, []);

  const setField = useCallback(<K extends keyof Project>(key: K, value: Project[K]) => {
    setProject((current) => ({ ...current, [key]: value }));
  }, []);

  const reset = useCallback(() => setProject(DEFAULT_PROJECT), []);

  return useMemo(
    () => ({ project, setProject, setSpec, setCompose, setField, reset }),
    [project, setSpec, setCompose, setField, reset],
  );
}
