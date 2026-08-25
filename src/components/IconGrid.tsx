import { useMemo, useRef, useState } from 'react';
import { composeIcon, renderTransparentLayer, type ComposeLayers, type ComposeOptions } from '../core/compose';
import { parseLibrary, type IconItem } from '../core/library';
import LibraryPicker from './LibraryPicker';
import { runPool, type PoolProgress } from '../core/queue';
import type { ContainerSpec } from '../core/spec';
import type { GenerationOptions } from '../state/useGeneration';
import { exactGlyph, fileDataUrl, imageSourceDataUrl, sourceReference } from '../core/images';
import { makeItem } from '../core/library';
import { estimateGlyphBatch, needsPaidGeneration } from '../core/cost';
import { cancelActiveGenerations } from '../core/replicate';
import { hashString } from '../core/hash';

interface Props {
  spec: ContainerSpec;
  compose: ComposeOptions;
  material: CanvasImageSource | null;
  glyphColor: string;
  items: IconItem[];
  concurrency: number;
  options: Omit<GenerationOptions, 'glyphSubject'>;
  onItems: (items: IconItem[]) => void;
  onConcurrency: (value: number) => void;
  generate: (options: GenerationOptions, subject: string) => Promise<CanvasImageSource>;
  /** Rendered glyphs, restored from storage and shared with the exporter. */
  glyphs: Map<string, CanvasImageSource>;
  onItemGlyph: (id: string, image: CanvasImageSource, revision?: number) => void;
  onRestoreRevision: (id: string, revision: number) => Promise<boolean>;
  generationBlocked?: string;
  onClearGlyphs: () => void;
  maxBatchCost: number;
}

/** Thumbnail for one card: the real container, with this card's glyph in it. */
function Thumb({
  spec,
  compose,
  layers,
  empty = false,
  transparent = false,
}: {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
  /** Complete-icon drafts stay genuinely empty until their paid result exists. */
  empty?: boolean;
  /** Draw the stored asset directly; never synthesize a container behind it. */
  transparent?: boolean;
}) {
  const src = useMemo(() => {
    const canvas = empty ? document.createElement('canvas')
      : transparent
        ? renderTransparentLayer({ ...spec, size: 128 }, layers.glyph, compose)
        : composeIcon({ ...spec, size: 128 }, layers, { ...compose, rimWidth: 0 });
    if (empty) canvas.width = canvas.height = 128;
    return canvas.toDataURL('image/png');
  }, [spec, compose, layers, empty, transparent]);
  return <img className="card-thumb" src={src} alt="" />;
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
  const [message, setMessage] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const stopped = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const artworkInput = useRef<HTMLInputElement>(null);

  const selectedCount = props.items.filter((item) => item.selected).length;
  const selectedItems = props.items.filter((item) => item.selected);
  const nextEstimate = estimateGlyphBatch(selectedItems, props.options.model, props.options.quality);
  const budgetBlocked = nextEstimate.cost !== null && nextEstimate.cost > props.maxBatchCost;
  const composeFor = (item: IconItem): ComposeOptions => ({
    ...props.compose,
    glyphScale: props.compose.glyphScale * (item.opticalScale ?? 1),
    glyphOffsetX: item.opticalOffsetX ?? 0,
    glyphOffsetY: item.opticalOffsetY ?? 0,
  });

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

  const runBatch = async (targets: IconItem[]) => {
    if (!targets.length || running) return;
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
    const estimate = estimateGlyphBatch(batchTargets, props.options.model, props.options.quality);
    if (estimate.cost !== null && estimate.cost > props.maxBatchCost) {
      setMessage(`Blocked: this click is estimated at $${estimate.cost.toFixed(2)}, above the $${props.maxBatchCost.toFixed(2)} batch limit.`);
      return;
    }
    stopped.current = false;
    setRunning(true);
    setMessage('');

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

    await runPool(
      batchTargets,
      props.concurrency,
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
          const layer = item.sourceUrl && item.sourceMode !== 'styled'
            ? await exactGlyph(item.sourceUrl, props.glyphColor)
            : await props.generate(
                {
                  ...props.options,
                  glyphSubject: subject,
                  // A stable key per revision keeps network retries/cache hits
                  // safe while making every icon and Redo use a new layout.
                  variationKey: hashString(`${item.id}:v${item.revision + 1}`),
                  glyphReference: item.sourceUrl ? await sourceReference(item.sourceUrl) : null,
                  references: [...anchorReferences, ...(props.options.references ?? [])],
                },
                subject,
              );
          const nextRevision = item.revision + 1;
          props.onItemGlyph(item.id, layer, nextRevision);
          // Deselect on success, so the next "Generate selected" targets only
          // what still needs doing.
          apply(item.id, {
            status: 'ready',
            revision: nextRevision,
            activeRevision: nextRevision,
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
    if (stopped.current) setMessage('Stopped. Cards already finished are kept.');
  };

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
        <button type="button" className="ghost" onClick={() => input.current?.click()}>
          Import list
        </button>
        <button type="button" className="ghost" onClick={() => artworkInput.current?.click()}>
          Add artwork
        </button>
        <button type="button" className="ghost" onClick={() => setAll(true)} disabled={!props.items.length}>
          Select all
        </button>
        <button type="button" className="ghost" onClick={() => setAll(false)} disabled={!selectedCount}>
          Select none
        </button>
        {props.items.length > 0 && (
          <button
            type="button"
            className="ghost"
            disabled={running}
            onClick={() => {
              props.onItems([]);
              // Drop the stored renders too, or the database keeps every glyph
              // from every library the user has ever imported.
              props.onClearGlyphs();
            }}
          >
            Clear
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
      </div>

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

      <p className="hint">
        7,300+ real SVG glyphs are built in. Add SVG/PNG artwork directly, or import a CSV, JSON
        manifest, or one name per line.
      </p>

      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!selectedCount || running || budgetBlocked || Boolean(props.generationBlocked && props.items.some(
            (item) => item.selected && (!item.sourceUrl || item.sourceMode === 'styled'),
          ))}
          onClick={() => runBatch(props.items.filter((item) => item.selected))}
        >
          {running ? 'Generating…'
            : `Generate ${selectedCount || ''} selected${nextEstimate.cost !== null ? ` · ~$${nextEstimate.cost.toFixed(2)}` : ''}`}
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
          <span className="field-label">At once</span>
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
        <p className={budgetBlocked ? 'status status-error' : 'hint'}>
          {nextEstimate.local} local/$0 · {nextEstimate.paid} paid output{nextEstimate.paid === 1 ? '' : 's'}
          {nextEstimate.cost !== null ? ` · estimated $${nextEstimate.cost.toFixed(2)} of $${props.maxBatchCost.toFixed(2)} limit` : ''}
        </p>
      )}

      {progress && (
        <p className="status status-busy">
          {progress.completed}/{progress.total} done · {progress.active} running
          {progress.failed ? ` · ${progress.failed} failed` : ''}
        </p>
      )}
      {message && <p className="status status-ok">{message}</p>}

      {props.items.length === 0 ? (
        <p className="hint">No icons yet. Import a list to get started.</p>
      ) : (
        <div className="card-grid">
          {props.items.map((item) => (
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

              <Thumb
                spec={props.spec}
                compose={composeFor(item)}
                empty={!props.glyphs.has(item.id)}
                transparent={props.options.wantAlpha}
                layers={props.options.wantAlpha
                  ? { material: null, glyph: props.glyphs.get(item.id) ?? null }
                  : !needsPaidGeneration(item)
                    ? { material: props.material, glyph: props.glyphs.get(item.id) ?? null }
                  : { material: props.glyphs.get(item.id) ?? null, glyph: null }}
              />

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
                  aria-label={`${item.name} description`}
                  value={item.concept}
                  placeholder="Describe this glyph"
                  onChange={(event) => patch(item.id, { concept: event.target.value })}
                />
                {item.sourceUrl && (
                  <button
                    type="button"
                    className="ghost tiny source-mode"
                    disabled={running}
                    onClick={() => patch(item.id, {
                      sourceMode: item.sourceMode === 'styled' ? 'exact' : 'styled',
                      status: 'draft',
                      selected: true,
                    })}
                  >
                    {item.sourceMode === 'styled' ? 'AI styled' : 'Exact artwork'}
                  </button>
                )}
                <label className="ghost tiny artwork-override">
                  Replace artwork
                  <input type="file" accept=".svg,image/svg+xml,image/png,image/webp,image/jpeg" hidden
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      patch(item.id, {
                        sourceUrl: await fileDataUrl(file),
                        sourceMode: 'exact',
                        status: 'draft',
                        selected: true,
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
                  disabled={running || Boolean(props.generationBlocked && (!item.sourceUrl || item.sourceMode === 'styled'))}
                  onClick={() => runBatch([item])}
                >
                  {item.status === 'ready' ? 'Redo' : 'Make'}
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
          ))}
        </div>
      )}
    </section>
  );
}
