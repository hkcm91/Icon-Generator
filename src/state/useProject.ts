import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_COMPOSE, type ComposeOptions } from '../core/compose';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../core/spec';
import { DEFAULT_VISION_MODEL } from '../core/vision';
import type { IconItem } from '../core/library';

const STORAGE_KEY = 'icon-generator-project-v1';

export interface Project {
  /** false shows the guided four-step view; true shows every control. */
  advanced: boolean;
  spec: ContainerSpec;
  compose: ComposeOptions;
  model: string;
  /** Vision model used to name the symbol in an uploaded master. */
  visionModel: string;
  materialDescription: string;
  glyphSubject: string;
  glyphStyle: string;
  /** The approved master: every generation references it. */
  master: { name: string; dataUrl: string } | null;
  /** Library cards. Metadata only — rendered images are not persisted. */
  items: IconItem[];
  /** How many generations run at once. */
  concurrency: number;
}

const DEFAULT_PROJECT: Project = {
  advanced: false,
  spec: DEFAULT_SPEC,
  compose: DEFAULT_COMPOSE,
  model: 'google/nano-banana-pro',
  visionModel: DEFAULT_VISION_MODEL,
  materialDescription: 'brushed deep indigo metal',
  glyphSubject: 'a paper plane, solid white',
  glyphStyle: 'rounded geometric, even stroke weight',
  master: null,
  items: [],
  concurrency: 3,
};

function load(): Project {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PROJECT;
    const parsed = JSON.parse(stored) as Partial<Project>;
    return {
      ...DEFAULT_PROJECT,
      ...parsed,
      spec: normalizeSpec(parsed.spec),
      compose: { ...DEFAULT_COMPOSE, ...(parsed.compose ?? {}) },
      // Rendered glyphs live in IndexedDB, so a card that finished last
      // session can come back ready. Only genuinely interrupted work is reset:
      // a queued or generating card had no result when the tab closed.
      items: (parsed.items ?? []).map((item) =>
        item.status === 'queued' || item.status === 'generating'
          ? { ...item, status: 'draft' as const, error: undefined }
          : item,
      ),
    };
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
