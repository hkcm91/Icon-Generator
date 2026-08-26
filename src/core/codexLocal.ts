import type { GenerationOptions } from '../state/useGeneration';
import type { ContainerMode, IconItem, IconOutputMode } from './library';

export const CODEX_JOB_VERSION = 1;

export interface CodexJobReference {
  name: string;
  role: 'master' | 'style-reference' | 'frame';
  dataUrl: string;
}

export interface CodexJobCard {
  id: string;
  name: string;
  subject: string;
  category?: string;
  outputMode: IconOutputMode;
  nextRevision: number;
  outputFile: string;
  prompt: string;
}

export interface CodexJobManifest {
  version: typeof CODEX_JOB_VERSION;
  createdAt: string;
  familyName: string;
  construction: ContainerMode;
  familyDirection: {
    theme?: string;
    familyPrompt?: string;
    negativePrompt?: string;
    styleProfile?: string;
    subjectStyleProfile?: string;
    frameStyleProfile?: string;
    styleFidelity: number;
    detailVariation: number;
  };
  instructions: string[];
  references: CodexJobReference[];
  cards: CodexJobCard[];
}

export interface LocalCodexJobStatus {
  id: string;
  path: string;
  total: number;
  ready: number;
  complete: boolean;
  cards: Array<Pick<CodexJobCard, 'id' | 'name' | 'outputMode' | 'nextRevision'>>;
  results: Array<{
    id: string;
    filename: string;
    url: string;
  }>;
}

export function codexOutputMode(mode: ContainerMode): IconOutputMode {
  if (mode === 'filled') return 'complete';
  if (mode === 'open-frame') return 'framed';
  return 'transparent';
}

function clean(value?: string): string {
  return value?.trim() ?? '';
}

function cardPrompt(
  item: IconItem,
  mode: ContainerMode,
  options: Omit<GenerationOptions, 'glyphSubject'>,
): string {
  const subject = clean(item.concept) || item.name;
  const output = mode === 'filled'
    ? 'Generate one complete square app icon: include the family container and the requested subject in a single finished image. Preserve transparent pixels outside the container.'
    : mode === 'open-frame'
      ? 'Generate only the isolated subject on a transparent background. Do not draw a tile, frame, border, plate, badge, square, circle, or background; the app will place the approved frame around it.'
      : 'Generate only the isolated subject on a transparent background. Do not draw a tile, frame, border, plate, badge, square, circle, or background.';
  return [
    output,
    `Subject: ${subject}. It must remain immediately recognizable at mobile icon size.`,
    item.themeTreatment ? `Card-specific theme treatment: ${item.themeTreatment.trim()}` : '',
    item.directorInstruction ? `Latest correction, highest priority: ${item.directorInstruction.trim()}` : '',
    options.theme ? `Family theme: ${options.theme.trim()}` : '',
    options.familyPrompt ? `Family direction: ${options.familyPrompt.trim()}` : '',
    options.styleProfile ? `Shared visual style: ${options.styleProfile.trim()}` : '',
    options.subjectStyleProfile ? `Subject material/style: ${options.subjectStyleProfile.trim()}` : '',
    mode === 'filled' && options.frameStyleProfile
      ? `Container/frame material and shape: ${options.frameStyleProfile.trim()}`
      : '',
    options.negativePrompt ? `Avoid: ${options.negativePrompt.trim()}` : '',
    'Use the supplied images only as family style and construction references. Never copy their old subject into this card.',
    'Return exactly one 1024×1024 PNG. Do not include text, labels, mockups, drop shadows outside the intended artwork, or extra alternatives.',
  ].filter(Boolean).join('\n');
}

export function buildCodexJob(
  familyName: string,
  items: IconItem[],
  mode: ContainerMode,
  options: Omit<GenerationOptions, 'glyphSubject'>,
  references: CodexJobReference[],
  createdAt = new Date().toISOString(),
): CodexJobManifest {
  const outputMode = codexOutputMode(mode);
  return {
    version: CODEX_JOB_VERSION,
    createdAt,
    familyName: familyName.trim() || 'My Icon Family',
    construction: mode,
    familyDirection: {
      theme: clean(options.theme) || undefined,
      familyPrompt: clean(options.familyPrompt) || undefined,
      negativePrompt: clean(options.negativePrompt) || undefined,
      styleProfile: clean(options.styleProfile) || undefined,
      subjectStyleProfile: clean(options.subjectStyleProfile) || undefined,
      frameStyleProfile: clean(options.frameStyleProfile) || undefined,
      styleFidelity: Math.max(0, Math.min(100, options.styleFidelity ?? 90)),
      detailVariation: Math.max(0, Math.min(100, options.detailVariation ?? 70)),
    },
    instructions: [
      'Generate every card as a separate image-generation request so subjects cannot leak between cards.',
      'Keep the family consistent in material, lighting, camera, finish, and scale, while varying incidental decoration and composition.',
      'Use each card prompt as authoritative for its subject and output construction.',
      'Save each finished image at the exact relative outputFile path. The Icon Generator watches the results folder and imports files automatically.',
      'Do not modify job.json or rename output files.',
    ],
    references,
    cards: items.map((item) => ({
      id: item.id,
      name: item.name,
      subject: clean(item.concept) || item.name,
      category: clean(item.category) || undefined,
      outputMode,
      nextRevision: item.revision + 1,
      outputFile: `results/${item.id}.png`,
      prompt: cardPrompt(item, mode, options),
    })),
  };
}

function resultStem(filename: string): string {
  return filename
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
}

function nameSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Match exact job filenames first, with a unique friendly-name fallback for manual imports. */
export function matchCodexResultFile(filename: string, items: IconItem[]): IconItem | null {
  const stem = resultStem(filename);
  const exact = items.find((item) => stem === item.id.toLowerCase() || stem.startsWith(`${item.id.toLowerCase()}--`));
  if (exact) return exact;

  const slug = nameSlug(stem);
  const byName = items.filter((item) => nameSlug(item.name) === slug);
  return byName.length === 1 ? byName[0] : null;
}

export async function localCodexHealth(): Promise<{ available: boolean; jobsDirectory?: string }> {
  try {
    const response = await fetch('/api/codex-local/health');
    if (!response.ok) return { available: false };
    return await response.json() as { available: boolean; jobsDirectory?: string };
  } catch {
    return { available: false };
  }
}

export async function createLocalCodexJob(job: CodexJobManifest): Promise<LocalCodexJobStatus> {
  const response = await fetch('/api/codex-local/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Local Codex bridge returned ${response.status}.`);
  }
  return await response.json() as LocalCodexJobStatus;
}

export async function readLocalCodexJob(id: string): Promise<LocalCodexJobStatus> {
  const response = await fetch(`/api/codex-local/jobs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Could not read local Codex job ${id}.`);
  return await response.json() as LocalCodexJobStatus;
}
