import { useEffect, useMemo, useRef, useState } from 'react';
import { composeCompleteIcon, composeContainerOverlay, composeIcon, composeOpenFrame, hasNativeAlpha, renderTransparentLayer, type ComposeLayers, type ComposeOptions } from '../core/compose';
import {
  isAiGuidedCatalogSource,
  containerGenerationUsesAlpha,
  modelGlyphReferenceSource,
  parseLibrary,
  resolveIconOutputMode,
  shouldMaskGeneratedCatalogSubject,
  frameVariantTarget,
  stableFrameIndex,
  type IconItem,
  type ContainerMode,
} from '../core/library';
import LibraryPicker from './LibraryPicker';
import { runPool, type PoolProgress } from '../core/queue';
import type { ContainerSpec } from '../core/spec';
import type { GenerationOptions } from '../state/useGeneration';
import { exactGlyph, fileDataUrl, imageFromUrl, imageSourceDataUrl, maskGeneratedGlyph, sourceReference } from '../core/images';
import { makeItem } from '../core/library';
import { estimateGlyphBatch, needsPaidGeneration, planGenerationQueue } from '../core/cost';
import { cancelActiveGenerations } from '../core/replicate';
import { hashString } from '../core/hash';
import { automaticThemeTreatment } from '../core/themeDirection';
import {
  buildCodexJob,
  codexOutputMode,
  createLocalCodexJob,
  localCodexHealth,
  matchCodexResultFile,
  readLocalCodexJob,
  type CodexJobReference,
  type LocalCodexJobStatus,
} from '../core/codexLocal';
import { download } from '../core/export';

interface Props {
  familyName: string;
  spec: ContainerSpec;
  compose: ComposeOptions;
  material: CanvasImageSource | null;
  frameVariants: Map<string, CanvasImageSource>;
  containerOverlay: CanvasImageSource | null;
  onContainerOverlay: (image: CanvasImageSource | null) => void;
  glyphColor: string;
  items: IconItem[];
  concurrency: number;
  options: Omit<GenerationOptions, 'glyphSubject'>;
  codexReferences: CodexJobReference[];
  onItems: (items: IconItem[]) => void;
  onConcurrency: (value: number) => void;
  generate: (options: GenerationOptions, subject: string) => Promise<CanvasImageSource>;
  /** Rendered glyphs, restored from storage and shared with the exporter. */
  glyphs: Map<string, CanvasImageSource>;
  imageStoreLoaded: boolean;
  onItemGlyph: (id: string, image: CanvasImageSource, revision?: number) => void;
  onRestoreRevision: (id: string, revision: number) => Promise<boolean>;
  generationBlocked?: string;
  onClearGlyphs: () => void;
  onClearSelectedGlyphs: (ids: Iterable<string>) => void;
  maxBatchCost: number;
  containerMode: ContainerMode;
  generationRequest?: { id: string; targetIds: string[] } | null;
}

const LOCAL_CODEX_STATE_KEY = 'icon-generator:local-codex-job';

/** One card render at either compact-card or full-screen inspection size. */
function RenderedIcon({
  spec,
  compose,
  layers,
  empty = false,
  mode = 'composed',
  size = 128,
  className = 'card-thumb',
  alt = '',
}: {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
  /** Complete-icon drafts stay genuinely empty until their paid result exists. */
  empty?: boolean;
  /** Draw the stored asset directly; never synthesize a container behind it. */
  mode?: 'transparent' | 'framed' | 'overlay' | 'composed' | 'complete';
  size?: number;
  className?: string;
  alt?: string;
}) {
  const src = useMemo(() => {
    const canvas = empty ? document.createElement('canvas')
      : mode === 'transparent'
        ? renderTransparentLayer({ ...spec, size }, layers.glyph, compose)
        : mode === 'overlay'
          ? composeContainerOverlay({ ...spec, size }, layers, { ...compose, rimWidth: 0 })
        : mode === 'framed'
          ? composeOpenFrame({ ...spec, size }, layers, { ...compose, rimWidth: 0 })
          : mode === 'complete'
            ? composeCompleteIcon({ ...spec, size }, layers.material, { ...compose, rimWidth: 0 })
            : composeIcon({ ...spec, size }, layers, { ...compose, rimWidth: 0 });
    if (empty) canvas.width = canvas.height = size;
    return canvas.toDataURL('image/png');
  }, [spec, compose, layers, empty, mode, size]);
  return <img className={className} src={src} alt={alt} />;
}

/**
 * The library grid: one card per icon, select any number, generate them as a
 * batch, regenerate the ones that came out wrong.
 *
 * Rendered glyphs live in IndexedDB rather than in the project JSON — a few
 * hundred PNG data URLs would exceed the localStorage quota several times over
 * — and are passed in so the exporter can reach the same images.
 */
export default function IconGrid(props: Props) {
  const [progress, setProgress] = useState<PoolProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [queueSummary, setQueueSummary] = useState<{ batches: number; batchSize: number } | null>(null);
  const [message, setMessage] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newConcept, setNewConcept] = useState('');
  const [fullscreenItemId, setFullscreenItemId] = useState<string | null>(null);
  const [localBridge, setLocalBridge] = useState<{ available: boolean; jobsDirectory?: string }>({ available: false });
  const [localJob, setLocalJob] = useState<LocalCodexJobStatus | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const stopped = useRef(false);
  const handledGenerationRequest = useRef('');
  const importedLocalResults = useRef(new Set<string>());
  const itemsRef = useRef(props.items);
  const input = useRef<HTMLInputElement>(null);
  const artworkInput = useRef<HTMLInputElement>(null);
  const containerInput = useRef<HTMLInputElement>(null);
  const codexResultsInput = useRef<HTMLInputElement>(null);

  const selectedCount = props.items.filter((item) => item.selected).length;
  const selectedItems = props.items.filter((item) => item.selected);
  const selectedOverlayItems = selectedItems.filter((item) => item.status === 'ready' && item.outputMode === 'overlay');
  const selectedIsolatedItems = selectedItems.filter((item) =>
    item.status === 'ready' &&
    props.glyphs.has(item.id) &&
    resolveIconOutputMode(item, containerGenerationUsesAlpha(props.containerMode), props.containerMode) === 'transparent',
  );
  const nextEstimate = estimateGlyphBatch(selectedItems, props.options.model, props.options.quality);
  const nextQueuePlan = planGenerationQueue(
    selectedItems,
    props.options.model,
    props.options.quality ?? 'low',
    props.concurrency,
    props.maxBatchCost,
  );
  const constructionPlural = props.containerMode === 'filled'
    ? 'complete icons'
    : props.containerMode === 'open-frame' ? 'open-frame icons' : 'isolated subjects';
  const constructionAction = props.containerMode === 'filled'
    ? 'complete icon'
    : props.containerMode === 'open-frame' ? 'open frame' : 'subject';
  const composeFor = (item: IconItem): ComposeOptions => ({
    ...props.compose,
    glyphScale: props.compose.glyphScale * (item.opticalScale ?? 1),
    glyphOffsetX: item.opticalOffsetX ?? 0,
    glyphOffsetY: item.opticalOffsetY ?? 0,
  });
  const framePool = [
    ...(props.material ? [props.material] : []),
    ...[...props.frameVariants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, image]) => image),
  ].slice(0, frameVariantTarget(props.options.detailVariation ?? 70));
  const frameFor = (item: IconItem) =>
    framePool[stableFrameIndex(item.id, framePool.length)] ?? props.material;
  const layersFor = (item: IconItem, outputMode: ReturnType<typeof resolveIconOutputMode>): ComposeLayers =>
    outputMode === 'transparent'
      ? { material: null, glyph: props.glyphs.get(item.id) ?? null }
      : outputMode === 'overlay'
        ? { material: props.containerOverlay, glyph: props.glyphs.get(item.id) ?? null }
        : outputMode === 'composed' || outputMode === 'framed'
          ? { material: outputMode === 'framed' ? frameFor(item) : props.material, glyph: props.glyphs.get(item.id) ?? null }
          : { material: props.glyphs.get(item.id) ?? null, glyph: null };

  const fullscreenItem = fullscreenItemId
    ? props.items.find((item) => item.id === fullscreenItemId && item.status === 'ready') ?? null
    : null;
  const fullscreenMode = fullscreenItem
    ? resolveIconOutputMode(fullscreenItem, containerGenerationUsesAlpha(props.containerMode), props.containerMode)
    : null;

  useEffect(() => {
    if (!fullscreenItemId) return;
    if (!fullscreenItem || !props.glyphs.has(fullscreenItem.id)) {
      setFullscreenItemId(null);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenItemId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreenItemId, fullscreenItem, props.glyphs]);

  useEffect(() => {
    itemsRef.current = props.items;
  }, [props.items]);

  useEffect(() => {
    let live = true;
    void localCodexHealth().then((health) => {
      if (!live) return;
      setLocalBridge(health);
      if (!health.available) return;
      try {
        const saved = JSON.parse(localStorage.getItem(LOCAL_CODEX_STATE_KEY) || 'null') as {
          id?: string;
          imported?: string[];
        } | null;
        if (!saved?.id) return;
        importedLocalResults.current = new Set(saved.imported ?? []);
        void readLocalCodexJob(saved.id).then((job) => {
          if (live) setLocalJob(job);
        }).catch(() => {
          localStorage.removeItem(LOCAL_CODEX_STATE_KEY);
        });
      } catch {
        localStorage.removeItem(LOCAL_CODEX_STATE_KEY);
      }
    });
    return () => { live = false; };
  }, []);

  const rememberLocalJob = (id: string) => {
    localStorage.setItem(LOCAL_CODEX_STATE_KEY, JSON.stringify({
      id,
      imported: [...importedLocalResults.current],
    }));
  };

  useEffect(() => {
    if (!localJob?.id || !localBridge.available || !props.imageStoreLoaded) return;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const status = await readLocalCodexJob(localJob.id);
        if (!live) return;
        setLocalJob(status);
        const pending = status.results.filter((result) => {
          const item = itemsRef.current.find((candidate) => candidate.id === result.id);
          return !importedLocalResults.current.has(result.id) || item?.status !== 'ready' || !props.glyphs.has(result.id);
        });
        if (pending.length) {
          let current = itemsRef.current;
          let imported = 0;
          for (const result of pending) {
            const item = current.find((candidate) => candidate.id === result.id);
            const card = status.cards.find((candidate) => candidate.id === result.id);
            if (!item || !card) continue;
            const image = await imageFromUrl(`${result.url}?revision=${card.nextRevision}`);
            const nextRevision = Math.max(item.revision + 1, card.nextRevision);
            props.onItemGlyph(item.id, image, nextRevision);
            current = current.map((candidate) => candidate.id === item.id ? {
              ...candidate,
              status: 'ready' as const,
              revision: nextRevision,
              activeRevision: nextRevision,
              outputMode: card.outputMode,
              selected: false,
              approved: false,
              error: undefined,
            } : candidate);
            importedLocalResults.current.add(result.id);
            imported += 1;
          }
          if (imported) {
            itemsRef.current = current;
            props.onItems(current);
            rememberLocalJob(status.id);
            setMessage(`Local Codex imported ${importedLocalResults.current.size}/${status.total} finished card${status.total === 1 ? '' : 's'} automatically.`);
          }
        }
        if (!status.complete || importedLocalResults.current.size < status.total) {
          timer = window.setTimeout(() => void poll(), 2000);
        } else {
          setMessage(`Local Codex job complete: ${status.total} card${status.total === 1 ? '' : 's'} imported with no image API calls.`);
        }
      } catch (error) {
        if (live) {
          setMessage(`Local Codex watcher paused: ${(error as Error).message}`);
          timer = window.setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // The job id is the polling boundary. Item changes caused by imports must
    // not restart the watcher or import the same file twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localJob?.id, localBridge.available, props.imageStoreLoaded]);

  const patch = (id: string, change: Partial<IconItem>) =>
    props.onItems(props.items.map((item) => (item.id === id ? { ...item, ...change } : item)));

  const importFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const parsed = parseLibrary(await file.text(), file.name);
      if (!parsed.length) {
        setMessage(`No icon names found in ${file.name}.`);
        return;
      }
      // Merge rather than replace: libraries are routinely built up from
      // several files, and replacing would silently discard the earlier ones.
      const existing = new Set(props.items.map((item) => item.name.toLowerCase()));
      const fresh = parsed.filter((item) => !existing.has(item.name.toLowerCase()));
      props.onItems([...props.items, ...fresh]);
      setMessage(
        `Imported ${fresh.length} icon${fresh.length === 1 ? '' : 's'} from ${file.name}` +
          (parsed.length - fresh.length ? `, skipped ${parsed.length - fresh.length} already present` : '') +
          '.',
      );
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${(error as Error).message}`);
    }
  };

  const importArtwork = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: IconItem[] = [];
    for (const file of Array.from(files)) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Custom icon';
      added.push(makeItem(name, {
        sourceUrl: await fileDataUrl(file),
        sourceMode: 'exact',
      }));
    }
    props.onItems([...props.items, ...added]);
    setMessage(`Added ${added.length} custom glyph${added.length === 1 ? '' : 's'} with exact artwork.`);
  };

  const applyContainerToSelected = (overlay = props.containerOverlay) => {
    if (!overlay) {
      setMessage('Upload a transparent glass container first.');
      return 0;
    }
    const ids = new Set(selectedIsolatedItems.map((item) => item.id));
    if (!ids.size) {
      setMessage('Select at least one finished No container icon before applying the glass container.');
      return 0;
    }
    props.onItems(props.items.map((item) => ids.has(item.id)
      ? { ...item, outputMode: 'overlay' as const, approved: false }
      : item));
    return ids.size;
  };

  const importContainer = async (file?: File) => {
    if (!file) return;
    try {
      const image = await imageFromUrl(await fileDataUrl(file));
      if (!hasNativeAlpha(image)) {
        setMessage('That container has no transparent exterior. Upload a transparent PNG or WebP so it does not cover the subject.');
        return;
      }
      props.onContainerOverlay(image);
      const applied = applyContainerToSelected(image);
      setMessage(applied
        ? `Loaded ${file.name} and placed it over ${applied} selected isolated icon${applied === 1 ? '' : 's'}. No generation charge.`
        : `Loaded ${file.name}. Select finished No container icons, then choose Apply glass.`);
    } catch (error) {
      setMessage(`Could not load that container: ${(error as Error).message}`);
    }
  };

  const codexManifest = () => {
    const references: CodexJobReference[] = [...props.codexReferences];
    if (props.material) {
      const dataUrl = imageSourceDataUrl(props.material);
      if (!references.some((reference) => reference.dataUrl === dataUrl)) {
        references.push({ name: 'Approved family frame', role: 'frame', dataUrl });
      }
    }
    return buildCodexJob(
      props.familyName,
      selectedItems,
      props.containerMode,
      props.options,
      references,
    );
  };

  const createCodexHandoff = async () => {
    if (!selectedItems.length || localBusy) return;
    setLocalBusy(true);
    try {
      const manifest = codexManifest();
      if (!localBridge.available) {
        download(
          new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' }),
          `${props.familyName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'icon-family'}-codex-job.json`,
        );
        setMessage('Downloaded the Codex job. Generate its named result files, then use Import Codex results.');
        return;
      }

      importedLocalResults.current = new Set();
      const job = await createLocalCodexJob(manifest);
      setLocalJob(job);
      rememberLocalJob(job.id);
      const ids = new Set(manifest.cards.map((card) => card.id));
      const queued = props.items.map((item) => ids.has(item.id)
        // Deselect local work so the adjacent paid API queue cannot be started
        // accidentally while Codex is producing these same cards.
        ? { ...item, status: 'queued' as const, selected: false, error: undefined }
        : item);
      itemsRef.current = queued;
      props.onItems(queued);
      setMessage(`Local Codex job created at ${job.path}. Ask Codex to process job.json; this page will import each result automatically.`);
    } catch (error) {
      setMessage(`Could not create the local Codex job: ${(error as Error).message}`);
    } finally {
      setLocalBusy(false);
    }
  };

  const importCodexResults = async (files: File[] | null) => {
    if (!files?.length) return;
    let current = props.items;
    const importedIds = new Set<string>();
    const unmatched: string[] = [];
    for (const file of files) {
      const item = matchCodexResultFile(file.name, current);
      if (!item || importedIds.has(item.id)) {
        unmatched.push(file.name);
        continue;
      }
      try {
        const image = await imageFromUrl(await fileDataUrl(file));
        const jobCard = localJob?.cards.find((card) => card.id === item.id);
        const nextRevision = Math.max(item.revision + 1, jobCard?.nextRevision ?? 0);
        props.onItemGlyph(item.id, image, nextRevision);
        current = current.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          status: 'ready' as const,
          revision: nextRevision,
          activeRevision: nextRevision,
          outputMode: jobCard?.outputMode ?? codexOutputMode(props.containerMode),
          selected: false,
          approved: false,
          error: undefined,
        } : candidate);
        importedIds.add(item.id);
      } catch {
        unmatched.push(file.name);
      }
    }
    if (importedIds.size) {
      itemsRef.current = current;
      props.onItems(current);
    }
    setMessage(
      `Imported ${importedIds.size} Codex result${importedIds.size === 1 ? '' : 's'} into matching cards` +
      `${unmatched.length ? `; ${unmatched.length} filename${unmatched.length === 1 ? '' : 's'} did not match a card` : ''}.`,
    );
  };

  const runBatch = async (targets: IconItem[]) => {
    if (!targets.length || running) return;
    // Freeze the selected family output for this entire click. React props can
    // change while a long batch is running; every queued card must still use
    // the mode that was visible when Make/Redo was pressed.
    const requestedContainerMode = props.containerMode;
    const requestedWantAlpha = containerGenerationUsesAlpha(requestedContainerMode);
    const hasPaidGeneration = targets.some(needsPaidGeneration);
    if (hasPaidGeneration && props.generationBlocked) {
      setMessage(props.generationBlocked);
      return;
    }
    const pendingAnchors = props.items.filter((item) => item.anchor && !item.approved);
    const batchTargets = pendingAnchors.length && targets.some((item) => !item.anchor)
      ? targets.filter((item) => item.anchor)
      : targets;
    if (!batchTargets.length) {
      setMessage('Generate and approve the marked style anchors before the rest of the family.');
      return;
    }
    const queuePlan = planGenerationQueue(
      batchTargets,
      props.options.model,
      props.options.quality ?? 'low',
      props.concurrency,
      props.maxBatchCost,
    );
    if (queuePlan.blocked) {
      const singleCost = queuePlan.totalCost !== null && queuePlan.paid
        ? queuePlan.totalCost / queuePlan.paid
        : null;
      setMessage(`Blocked: one output costs about ${singleCost === null ? 'more than the configured limit' : `$${singleCost.toFixed(3)}`}, above the $${props.maxBatchCost.toFixed(2)} per-batch limit.`);
      return;
    }
    const automaticTreatments = new Map(batchTargets.map((item) => {
      const familyIndex = Math.max(0, props.items.findIndex((candidate) => candidate.id === item.id));
      return [item.id, automaticThemeTreatment(props.options.theme ?? '', item.id, familyIndex)] as const;
    }));
    stopped.current = false;
    setRunning(true);
    setQueueSummary({ batches: queuePlan.batches, batchSize: queuePlan.effectiveBatchSize });
    setMessage(
      `Queued ${batchTargets.length} card${batchTargets.length === 1 ? '' : 's'} in ${queuePlan.batches} batch${queuePlan.batches === 1 ? '' : 'es'} of up to ${queuePlan.effectiveBatchSize}` +
      `${queuePlan.limitAdjusted ? ` (reduced from ${queuePlan.requestedBatchSize} to stay under the per-batch limit)` : ''}` +
      `${queuePlan.totalCost === null ? '.' : `. Estimated total: $${queuePlan.totalCost.toFixed(2)}.`}`,
    );

    if (batchTargets.length !== targets.length) {
      setMessage('Generating anchors first. Approve them, then run the remaining family.');
    }
    const ids = new Set(batchTargets.map((item) => item.id));
    const queuedItems: IconItem[] = props.items.map((item) =>
        ids.has(item.id) ? { ...item, status: 'queued' as const, error: undefined } : item,
      );
    props.onItems(queuedItems);

    let current = queuedItems;
    const apply = (id: string, change: Partial<IconItem>) => {
      current = current.map((item) => (item.id === id ? { ...item, ...change } : item));
      props.onItems(current);
    };

    const results = await runPool(
      batchTargets,
      queuePlan.effectiveBatchSize,
      async (item) => {
        apply(item.id, { status: 'generating' });
        try {
          const anchorReferences = props.items
            .filter((candidate) => candidate.anchor && candidate.approved && candidate.id !== item.id)
            .map((candidate) => props.glyphs.get(candidate.id))
            .filter((image): image is CanvasImageSource => Boolean(image))
            .slice(0, 5)
            .map(imageSourceDataUrl);
          const subject = [item.concept || item.name, item.role && `${item.role} icon`, item.complexity && `${item.complexity} detail`]
            .filter(Boolean).join(', ');
          const referenceSource = modelGlyphReferenceSource(item);
          // Catalog glyphs are reference inputs only. Even stale exact-mode
          // metadata must never paste one into the finished icon frame.
          let layer = !needsPaidGeneration(item)
            ? await exactGlyph(item.sourceUrl!, props.glyphColor)
            : await props.generate(
                {
                  ...props.options,
                  wantAlpha: requestedWantAlpha,
                  glyphSubject: subject,
                  themeTreatment: item.themeTreatment?.trim() || automaticTreatments.get(item.id),
                  directorInstruction: item.directorInstruction,
                  // A stable key per revision keeps network retries/cache hits
                  // safe while making every icon and Redo use a new layout.
                  variationKey: hashString(`${item.id}:v${item.revision + 1}`),
                  // Catalog SVGs choose the subject but never enter the model
                  // input. This restores the pre-expansion text-driven flow.
                  glyphReference: referenceSource ? await sourceReference(referenceSource) : null,
                  references: [...anchorReferences, ...(props.options.references ?? [])],
                },
                subject,
              );
          if (
            shouldMaskGeneratedCatalogSubject(requestedContainerMode) &&
            needsPaidGeneration(item) &&
            isAiGuidedCatalogSource(item.sourceUrl)
          ) {
            const exactMask = await exactGlyph(item.sourceUrl!, '#ffffff');
            layer = maskGeneratedGlyph(layer, exactMask, props.spec.size);
          }
          const nextRevision = item.revision + 1;
          const outputMode = requestedContainerMode === 'open-frame'
            ? 'framed'
            : requestedContainerMode === 'isolated'
              ? 'transparent'
              : needsPaidGeneration(item) ? 'complete' : 'composed';
          props.onItemGlyph(item.id, layer, nextRevision);
          // Deselect on success, so the next "Generate selected" targets only
          // what still needs doing.
          apply(item.id, {
            status: 'ready',
            revision: nextRevision,
            activeRevision: nextRevision,
            outputMode,
            selected: false,
            approved: false,
          });
        } catch (error) {
          apply(item.id, { status: 'failed', error: (error as Error).message });
          throw error;
        }
      },
      setProgress,
      () => stopped.current,
    );

    setRunning(false);
    setProgress(null);
    setQueueSummary(null);
    const failed = results.filter((result) => result.error).length;
    if (stopped.current) {
      setMessage('Queue stopped. Cards already finished are kept; unfinished cards remain selected.');
    } else {
      const finished = results.length - failed;
      setMessage(`Queue finished: ${finished} completed${failed ? ` · ${failed} failed and remain selected` : ''}.`);
    }
  };

  useEffect(() => {
    const request = props.generationRequest;
    if (!request || request.id === handledGenerationRequest.current || running) return;
    handledGenerationRequest.current = request.id;
    const ids = new Set(request.targetIds);
    void runBatch(props.items.filter((item) => ids.has(item.id)));
    // The request id is the imperative boundary. Item/running changes during
    // the batch must not start the same paid work twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.generationRequest, props.items, running]);

  const setAll = (selected: boolean) =>
    props.onItems(props.items.map((item) => ({ ...item, selected })));

  return (
    <section className="icon-library">
      <div className="grid-head">
        <h2>Icon library</h2>
        <span className="muted-count">
          {props.items.length} icon{props.items.length === 1 ? '' : 's'}
          {selectedCount ? ` · ${selectedCount} selected` : ''}
        </span>
      </div>

      <div className="row">
        <button type="button" className="primary" onClick={() => setBrowsing((c) => !c)}>
          Browse glyphs
        </button>
        <button type="button" className="ghost" onClick={() => setAdding((value) => !value)}>
          Add icon
        </button>
        <button type="button" className="ghost" onClick={() => input.current?.click()}>
          Import list
        </button>
        <button type="button" className="ghost" onClick={() => artworkInput.current?.click()}>
          Add artwork
        </button>
        <button type="button" className="ghost" onClick={() => containerInput.current?.click()} disabled={running}>
          Bring glass container
        </button>
        <button type="button" className="ghost" onClick={() => setAll(true)} disabled={!props.items.length}>
          Select all
        </button>
        <button type="button" className="ghost" onClick={() => setAll(false)} disabled={!selectedCount}>
          Select none
        </button>
        <button
          type="button"
          className="ghost"
          disabled={running || !selectedCount}
          onClick={() => {
            const selectedIds = new Set(selectedItems.map((item) => item.id));
            props.onItems(props.items.filter((item) => !selectedIds.has(item.id)));
            props.onClearSelectedGlyphs(selectedIds);
            setMessage(`Cleared ${selectedIds.size} selected card${selectedIds.size === 1 ? '' : 's'}.`);
          }}
        >
          Clear selected
        </button>
        {props.items.length > 0 && (
          <button
            type="button"
            className="ghost"
            disabled={running}
            onClick={() => {
              if (!window.confirm('Clear the entire icon library and all of its saved renders?')) return;
              props.onItems([]);
              // Drop the stored renders too, or the database keeps every glyph
              // from every library the user has ever imported.
              props.onClearGlyphs();
            }}
          >
            Clear library
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,.json,.txt,text/*,application/json"
          hidden
          onChange={(event) => void importFile(event.target.files)}
        />
        <input
          ref={artworkInput}
          type="file"
          accept=".svg,image/svg+xml,image/png,image/webp,image/jpeg"
          multiple
          hidden
          onChange={(event) => void importArtwork(event.target.files)}
        />
        <input
          ref={containerInput}
          type="file"
          accept="image/png,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void importContainer(file);
          }}
        />
      </div>

      {props.containerOverlay && (
        <div className="byoc-container row row-tight" aria-label="Bring your own glass container controls">
          <span className="badge badge-ready">Glass overlay ready · local/$0</span>
          <button type="button" className="ghost tiny" disabled={running || !selectedIsolatedItems.length}
            onClick={() => {
              const applied = applyContainerToSelected();
              if (applied) setMessage(`Placed the glass container over ${applied} selected icon${applied === 1 ? '' : 's'}. No generation charge.`);
            }}>
            Apply glass
          </button>
          <button type="button" className="ghost tiny" disabled={running || !selectedOverlayItems.length}
            onClick={() => {
              const ids = new Set(selectedOverlayItems.map((item) => item.id));
              props.onItems(props.items.map((item) => ids.has(item.id)
                ? { ...item, outputMode: 'transparent' as const, approved: false }
                : item));
              setMessage(`Removed the glass container from ${ids.size} selected icon${ids.size === 1 ? '' : 's'}; subject pixels were kept.`);
            }}>
            Remove glass
          </button>
          <button type="button" className="ghost tiny" disabled={running}
            onClick={() => containerInput.current?.click()}>
            Replace glass
          </button>
          <button type="button" className="ghost tiny" disabled={running}
            onClick={() => {
              props.onItems(props.items.map((item) => item.outputMode === 'overlay'
                ? { ...item, outputMode: 'transparent' as const, approved: false }
                : item));
              props.onContainerOverlay(null);
              setMessage('Cleared the BYOC container. All affected subjects remain unchanged.');
            }}>
            Clear glass
          </button>
        </div>
      )}

      {adding && (
        <form className="add-icon-form" onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          props.onItems([...props.items, makeItem(name, { concept: newConcept.trim() })]);
          setMessage(`Added ${name}. Its card name and visual subject can be different.`);
          setNewName('');
          setNewConcept('');
          setAdding(false);
        }}>
          <label className="field">
            <span className="field-label">Icon name <small>used for export</small></span>
            <input value={newName} autoFocus placeholder="Home" onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Visual subject</span>
            <input value={newConcept} placeholder="pumpkin" onChange={(event) => setNewConcept(event.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={!newName.trim()}>Add card</button>
        </form>
      )}

      {browsing && (
        <LibraryPicker
          existing={props.items}
          onClose={() => setBrowsing(false)}
          onAdd={(added) => {
            props.onItems([...props.items, ...added]);
            setMessage(`Added ${added.length.toLocaleString()} icon${added.length === 1 ? '' : 's'}.`);
          }}
        />
      )}

      <p className="hint">The card name controls export. Visual subject controls what is drawn. The set theme then adapts that subject.</p>

      <details className="codex-local-tools">
        <summary>
          Local Codex generation · no image API
          {localBridge.available ? <span className="badge badge-ready">connected</span> : null}
        </summary>
        <p className="hint">
          {localBridge.available
            ? 'Creates a job in this project for Codex. Keep the page open: correctly named results are placed into their cards automatically as they arrive.'
            : 'The localhost bridge is not running here. Download the job for Codex, then import the returned PNG or WebP files in one batch.'}
        </p>
        <div className="row row-tight">
          <button
            type="button"
            className="primary"
            disabled={!selectedCount || running || localBusy}
            onClick={() => void createCodexHandoff()}
          >
            {localBusy
              ? 'Creating Codex job…'
              : localBridge.available
                ? `Send ${selectedCount || ''} selected to Codex`
                : `Download Codex job${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
          <button type="button" className="ghost" disabled={running} onClick={() => codexResultsInput.current?.click()}>
            Import Codex results
          </button>
          <input
            ref={codexResultsInput}
            type="file"
            accept="image/png,image/webp,image/jpeg"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              void importCodexResults(files);
            }}
          />
        </div>
        {localJob && (
          <p className="codex-job-status">
            <strong>{localJob.ready}/{localJob.total} results ready</strong>
            <span>{localJob.complete ? ' · complete' : ' · watching every 2 seconds'}</span>
            <code title={localJob.path}>{localJob.path}</code>
          </p>
        )}
        {!localJob && localBridge.available && localBridge.jobsDirectory && (
          <p className="hint">Jobs folder: <code>{localBridge.jobsDirectory}</code></p>
        )}
        <p className="hint">Result filenames must be the exact card id shown in job.json, for example <code>instagram-12.png</code>.</p>
      </details>

      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!selectedCount || running || nextQueuePlan.blocked || Boolean(props.generationBlocked && props.items.some(
            (item) => item.selected && needsPaidGeneration(item),
          ))}
          onClick={() => runBatch(props.items.filter((item) => item.selected))}
        >
          {running ? `Processing queued ${constructionPlural}…`
            : `Queue ${selectedCount || ''} selected ${constructionPlural}${nextEstimate.cost !== null ? ` · ~$${nextEstimate.cost.toFixed(2)} total` : ''}`}
        </button>
        {running && (
          <button type="button" className="ghost" onClick={() => {
            stopped.current = true;
            void cancelActiveGenerations().then((count) => setMessage(
              count ? `Stopping and canceling ${count} in-flight generation${count === 1 ? '' : 's'}…` : 'Stopping after the current local render…',
            ));
          }}>
            Stop
          </button>
        )}
        <label className="field field-inline concurrency">
          <span className="field-label">Batch size</span>
          <input
            type="number"
            min={1}
            max={6}
            value={props.concurrency}
            disabled={running}
            onChange={(event) => props.onConcurrency(Math.max(1, Math.min(6, Number(event.target.value))))}
          />
        </label>
      </div>

      {selectedCount > 0 && (
        <p className={nextQueuePlan.blocked ? 'status status-error' : 'hint'}>
          {nextEstimate.local} local/$0 · {nextEstimate.paid} paid output{nextEstimate.paid === 1 ? '' : 's'}
          {nextEstimate.cost !== null ? ` · estimated $${nextEstimate.cost.toFixed(2)} total` : ''}
          {nextQueuePlan.batchCost !== null ? ` · up to $${nextQueuePlan.batchCost.toFixed(3)} per batch of ${nextQueuePlan.effectiveBatchSize}` : ''}
          {nextQueuePlan.limitAdjusted ? ` · automatically reduced from ${nextQueuePlan.requestedBatchSize} at once` : ''}
          {nextQueuePlan.blocked ? ` · raise the $${props.maxBatchCost.toFixed(2)} per-batch limit to cover one output` : ''}
        </p>
      )}

      {progress && (
        <p className="status status-busy">
          {progress.completed}/{progress.total} done · {progress.active} running
          {` · ${Math.max(0, progress.total - progress.completed - progress.active)} queued`}
          {queueSummary ? ` · ${queueSummary.batches} batches of up to ${queueSummary.batchSize}` : ''}
          {progress.failed ? ` · ${progress.failed} failed` : ''}
        </p>
      )}
      {message && <p className="status status-ok">{message}</p>}

      {props.items.length === 0 ? (
        <p className="hint">No icons yet. Import a list to get started.</p>
      ) : (
        <div className="card-grid">
          {props.items.map((item) => {
            const outputMode = resolveIconOutputMode(item, containerGenerationUsesAlpha(props.containerMode), props.containerMode);
            return (
            <article
              key={item.id}
              className={item.selected ? 'card card-on' : 'card'}
              data-status={item.status}
            >
              <label className="card-pick">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(event) => patch(item.id, { selected: event.target.checked })}
                />
              </label>

              <div className="card-art">
                <RenderedIcon
                  spec={props.spec}
                  compose={composeFor(item)}
                  // Hide a stale locally pasted catalog glyph on the very first
                  // render too; the migration effect clears its stored pixels.
                  empty={!props.glyphs.has(item.id) || (
                    isAiGuidedCatalogSource(item.sourceUrl) && item.sourceMode !== 'styled'
                  )}
                  mode={outputMode}
                  layers={layersFor(item, outputMode)}
                />
                {item.status === 'ready' && props.glyphs.has(item.id) && (
                  <button
                    type="button"
                    className="card-fullscreen"
                    aria-label={`View ${item.name} full screen`}
                    title="View full screen"
                    onClick={() => setFullscreenItemId(item.id)}
                  >
                    <span aria-hidden="true">⛶</span>
                  </button>
                )}
              </div>

              <div className="card-name" title={item.concept || item.name}>
                <input
                  aria-label="Icon name"
                  value={item.name}
                  onChange={(event) => patch(item.id, { name: event.target.value })}
                />
              </div>
              <details className="card-editor">
                <summary>Edit details</summary>
                <input
                  className="card-concept"
                  aria-label={`${item.name} visual subject`}
                  value={item.concept}
                  placeholder="Visual subject — e.g. pumpkin"
                  onChange={(event) => patch(item.id, { concept: event.target.value })}
                />
                <input
                  className="card-concept"
                  aria-label={`${item.name} theme treatment`}
                  value={item.themeTreatment ?? ''}
                  placeholder="Theme treatment — optional; auto if blank"
                  onChange={(event) => patch(item.id, { themeTreatment: event.target.value })}
                />
                {item.directorInstruction && (
                  <textarea
                    className="card-concept"
                    aria-label={`${item.name} director correction`}
                    value={item.directorInstruction}
                    onChange={(event) => patch(item.id, { directorInstruction: event.target.value })}
                  />
                )}
                {item.sourceUrl && isAiGuidedCatalogSource(item.sourceUrl) && (
                  <span className="badge source-mode">Subject reference only</span>
                )}
                {item.sourceUrl && !isAiGuidedCatalogSource(item.sourceUrl) && (
                  <button
                    type="button"
                    className="ghost tiny source-mode"
                    disabled={running}
                    onClick={() => {
                      props.onClearSelectedGlyphs([item.id]);
                      patch(item.id, {
                        sourceMode: item.sourceMode === 'styled' ? 'exact' : 'styled',
                        status: 'draft',
                        selected: true,
                        revision: 0,
                        activeRevision: undefined,
                        outputMode: undefined,
                        approved: false,
                        error: undefined,
                      });
                    }}
                  >
                    {item.sourceMode === 'styled' ? 'AI generation' : 'Use exact artwork'}
                  </button>
                )}
                <label className="ghost tiny artwork-override">
                  Replace artwork
                  <input type="file" accept=".svg,image/svg+xml,image/png,image/webp,image/jpeg" hidden
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      props.onClearSelectedGlyphs([item.id]);
                      patch(item.id, {
                        sourceUrl: await fileDataUrl(file),
                        sourceMode: 'exact',
                        status: 'draft',
                        selected: true,
                        revision: 0,
                        activeRevision: undefined,
                        outputMode: undefined,
                        approved: false,
                      });
                    }} />
                </label>
                <div className="card-flags">
                  <button type="button" className={item.anchor ? 'chip chip-on' : 'chip'}
                    onClick={() => patch(item.id, { anchor: !item.anchor, approved: false })}>
                    Anchor
                  </button>
                </div>
                <input aria-label={`${item.name} category`} value={item.category ?? ''} placeholder="Category"
                  onChange={(event) => patch(item.id, { category: event.target.value })} />
                <select aria-label={`${item.name} complexity`} value={item.complexity ?? 'medium'}
                  onChange={(event) => patch(item.id, { complexity: event.target.value as IconItem['complexity'] })}>
                  <option value="simple">Simple</option><option value="medium">Medium</option><option value="complex">Complex</option>
                </select>
                <select aria-label={`${item.name} role`} value={item.role ?? 'standard'}
                  onChange={(event) => patch(item.id, { role: event.target.value as IconItem['role'] })}>
                  <option value="standard">Standard</option><option value="wide">Wide</option><option value="tall">Tall</option>
                  <option value="circular">Circular</option><option value="complex">Complex</option><option value="hero">Hero</option>
                </select>
                <label>Optical scale <input type="number" min={0.5} max={1.5} step={0.05}
                  value={item.opticalScale ?? 1} onChange={(event) => patch(item.id, { opticalScale: Number(event.target.value) })} /></label>
                <label>X offset <input type="number" min={-25} max={25} value={item.opticalOffsetX ?? 0}
                  onChange={(event) => patch(item.id, { opticalOffsetX: Number(event.target.value) })} /></label>
                <label>Y offset <input type="number" min={-25} max={25} value={item.opticalOffsetY ?? 0}
                  onChange={(event) => patch(item.id, { opticalOffsetY: Number(event.target.value) })} /></label>
                <textarea aria-label={`${item.name} notes`} value={item.notes ?? ''} placeholder="Revision or production notes"
                  onChange={(event) => patch(item.id, { notes: event.target.value })} />
              </details>
              <div className="card-foot">
                <span className={`badge badge-${item.status}`}>
                  {item.status === 'ready'
                    ? `v${item.activeRevision ?? item.revision}/${item.revision}${item.approved ? ' · approved' : ''}`
                    : item.status}
                </span>
                {item.status === 'ready' && (
                  <span className="badge" title="The output mode saved with this revision">
                    {outputMode === 'transparent'
                      ? 'isolated subject'
                      : outputMode === 'framed' ? 'open frame' : outputMode === 'overlay' ? 'BYOC glass' : 'filled tile'}
                  </span>
                )}
                {item.status === 'ready' && (
                  <button
                    type="button"
                    className="ghost tiny"
                    disabled={running}
                    onClick={() => patch(item.id, { approved: !item.approved })}
                  >
                    {item.approved ? 'Unapprove' : 'Approve'}
                  </button>
                )}
                {item.status === 'ready' && item.revision > 1 && (
                  <button
                    type="button"
                    className="ghost tiny"
                    disabled={running}
                    onClick={async () => {
                      const active = item.activeRevision ?? item.revision;
                      const target = active > 1 ? active - 1 : item.revision;
                      if (await props.onRestoreRevision(item.id, target)) {
                        patch(item.id, { activeRevision: target, approved: false });
                      }
                    }}
                  >
                    {(item.activeRevision ?? item.revision) > 1 ? 'Previous' : 'Latest'}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost tiny"
                  disabled={running || Boolean(props.generationBlocked && needsPaidGeneration(item))}
                  onClick={() => runBatch([item])}
                >
                  {item.status === 'ready' ? `Redo ${constructionAction}` : `Make ${constructionAction}`}
                </button>
                <button
                  type="button"
                  className="ghost tiny"
                  disabled={running}
                  onClick={() => props.onItems(props.items.filter((candidate) => candidate.id !== item.id))}
                >
                  Remove
                </button>
              </div>
              {item.error && <p className="card-error" title={item.error}>{item.error}</p>}
            </article>
            );
          })}
        </div>
      )}
      {fullscreenItem && fullscreenMode && (
        <div
          className="icon-lightbox"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFullscreenItemId(null);
          }}
        >
          <div
            className="icon-lightbox-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="icon-lightbox-title"
          >
            <div className="icon-lightbox-head">
              <div>
                <strong id="icon-lightbox-title">{fullscreenItem.name}</strong>
                <small>{fullscreenMode === 'transparent'
                  ? 'Isolated subject'
                  : fullscreenMode === 'framed'
                    ? 'Open frame'
                    : fullscreenMode === 'overlay' ? 'BYOC glass' : 'Complete icon'}</small>
              </div>
              <button
                type="button"
                className="ghost icon-lightbox-close"
                aria-label="Close full screen preview"
                autoFocus
                onClick={() => setFullscreenItemId(null)}
              >
                Close
              </button>
            </div>
            <div className="icon-lightbox-stage">
              <RenderedIcon
                spec={props.spec}
                compose={composeFor(fullscreenItem)}
                layers={layersFor(fullscreenItem, fullscreenMode)}
                mode={fullscreenMode}
                size={1024}
                className="icon-lightbox-image"
                alt={`${fullscreenItem.name} full screen preview`}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
