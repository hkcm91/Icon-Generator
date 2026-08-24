import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_COMPOSE, type ComposeOptions } from '../core/compose';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../core/spec';

const STORAGE_KEY = 'icon-generator-project-v1';

export interface Project {
  /** false shows the guided four-step view; true shows every control. */
  advanced: boolean;
  spec: ContainerSpec;
  compose: ComposeOptions;
  model: string;
  materialDescription: string;
  glyphSubject: string;
  glyphStyle: string;
}

const DEFAULT_PROJECT: Project = {
  advanced: false,
  spec: DEFAULT_SPEC,
  compose: DEFAULT_COMPOSE,
  model: 'google/nano-banana-pro',
  materialDescription: 'brushed deep indigo metal',
  glyphSubject: 'a paper plane, solid white',
  glyphStyle: 'rounded geometric, even stroke weight',
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
