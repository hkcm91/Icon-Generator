import { PROJECTS, deleteBlob, getValue, putValue } from './store';
import type { Project } from '../state/useProject';
import type { ImageBundle } from '../state/useImageStore';

const INDEX_KEY = 'index';
const projectKey = (id: string) => `project:${id}`;

export interface SavedProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  iconCount: number;
}

export interface SavedProjectBundle {
  schemaVersion: 1;
  project: Project;
  images: ImageBundle;
}

export function upsertProjectSummary(
  summaries: SavedProjectSummary[],
  next: SavedProjectSummary,
): SavedProjectSummary[] {
  return [...summaries.filter((summary) => summary.id !== next.id), next]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listSavedProjects(): Promise<SavedProjectSummary[]> {
  return (await getValue<SavedProjectSummary[]>(PROJECTS, INDEX_KEY)) ?? [];
}

export async function saveProjectSlot(
  id: string,
  bundle: SavedProjectBundle,
): Promise<SavedProjectSummary[]> {
  const summary: SavedProjectSummary = {
    id,
    name: bundle.project.name.trim() || 'Untitled icon set',
    updatedAt: new Date().toISOString(),
    iconCount: bundle.project.items.length,
  };
  await putValue(PROJECTS, projectKey(id), bundle);
  const summaries = upsertProjectSummary(await listSavedProjects(), summary);
  await putValue(PROJECTS, INDEX_KEY, summaries);
  return summaries;
}

export async function loadProjectSlot(id: string): Promise<SavedProjectBundle | null> {
  return (await getValue<SavedProjectBundle>(PROJECTS, projectKey(id))) ?? null;
}

export async function deleteProjectSlot(id: string): Promise<SavedProjectSummary[]> {
  await deleteBlob(PROJECTS, projectKey(id));
  const summaries = (await listSavedProjects()).filter((summary) => summary.id !== id);
  await putValue(PROJECTS, INDEX_KEY, summaries);
  return summaries;
}
