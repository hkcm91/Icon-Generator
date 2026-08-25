import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_COMPOSE, type ComposeOptions } from '../core/compose';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../core/spec';
import { DEFAULT_VISION_MODEL } from '../core/vision';
import type { IconItem } from '../core/library';

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
  premiumAllowed: boolean;
  /** Vision model used to name the symbol in an uploaded master. */
  visionModel: string;
  materialDescription: string;
  familyPrompt: string;
  negativePrompt: string;
  glyphSubject: string;
  glyphStyle: string;
  glyphColor: string;
  /** The approved master: every generation references it. */
  master: { name: string; dataUrl: string } | null;
  /** Reuse the approved container pixels instead of repainting the material. */
  lockedContainer: boolean;
  /** Ask capable models for an isolated native-alpha glyph; off uses chroma keying. */
  glyphTransparency: boolean;
  /** Additional appearance references shared by the family. */
  references: Array<{ name: string; dataUrl: string }>;
  /** Production export gate. */
  exportApprovedOnly: boolean;
  exportSelectedOnly: boolean;
  /** Library cards. Metadata only — rendered images are not persisted. */
  items: IconItem[];
  /** How many generations run at once. */
  concurrency: number;
  /** Require a small approved sample before releasing a paid family batch. */
  calibrationRequired: boolean;
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
  master: null,
  lockedContainer: false,
  glyphTransparency: true,
  references: [],
  exportApprovedOnly: false,
  exportSelectedOnly: false,
  items: [],
  concurrency: 3,
  calibrationRequired: true,
  maxBatchCost: 1,
};

export function hydrateProject(parsed: Partial<Project>): Project {
  const migrateExpensiveDefault = parsed.quality === undefined && parsed.model === 'google/nano-banana-pro';
  const compose = { ...DEFAULT_COMPOSE, ...(parsed.compose ?? {}) };
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
    premiumAllowed: migrateExpensiveDefault ? false : (parsed.premiumAllowed ?? false),
    calibrationRequired: parsed.calibrationRequired ?? true,
    maxBatchCost: Math.max(0, parsed.maxBatchCost ?? 1),
    glyphTransparency: parsed.glyphTransparency ?? true,
    spec: normalizeSpec(parsed.spec),
    // Older project/template JSON could silently carry a dark analytic rim.
    // Clear it once; rims intentionally selected after this migration persist.
    compose: {
      ...compose,
      rimWidth: parsed.borderlessVersion === 1 ? compose.rimWidth : 0,
    },
    items: (parsed.items ?? []).map((item) =>
      item.status === 'queued' || item.status === 'generating'
        ? { ...item, status: 'draft' as const, error: undefined }
        : item,
    ),
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
