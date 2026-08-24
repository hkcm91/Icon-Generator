import { useMemo, useRef, useState } from 'react';
import { composeIcon, type ComposeLayers, type ComposeOptions } from '../core/compose';
import { parseLibrary, type IconItem } from '../core/library';
import { runPool, type PoolProgress } from '../core/queue';
import type { ContainerSpec } from '../core/spec';
import type { GenerationOptions } from '../state/useGeneration';

interface Props {
  spec: ContainerSpec;
  compose: ComposeOptions;
  material: CanvasImageSource | null;
  items: IconItem[];
  concurrency: number;
  options: Omit<GenerationOptions, 'glyphSubject'>;
  onItems: (items: IconItem[]) => void;
  onConcurrency: (value: number) => void;
  generate: (options: GenerationOptions, subject: string) => Promise<CanvasImageSource>;
  /** Rendered glyphs, restored from storage and shared with the exporter. */
  glyphs: Map<string, CanvasImageSource>;
  onItemGlyph: (id: string, image: CanvasImageSource) => void;
  onClearGlyphs: () => void;
}

/** Thumbnail for one card: the real container, with this card's glyph in it. */
function Thumb({
  spec,
  compose,
  layers,
}: {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
}) {
  const src = useMemo(() => {
    const canvas = composeIcon({ ...spec, size: 128 }, layers, { ...compose, rimWidth: 0 });
    return canvas.toDataURL('image/png');
  }, [spec, compose, layers]);
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
  const stopped = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const selectedCount = props.items.filter((item) => item.selected).length;

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

  const runBatch = async (targets: IconItem[]) => {
    if (!targets.length || running) return;
    stopped.current = false;
    setRunning(true);
    setMessage('');

    const ids = new Set(targets.map((item) => item.id));
    props.onItems(
      props.items.map((item) =>
        ids.has(item.id) ? { ...item, status: 'queued', error: undefined } : item,
      ),
    );

    let current = props.items;
    const apply = (id: string, change: Partial<IconItem>) => {
      current = current.map((item) => (item.id === id ? { ...item, ...change } : item));
      props.onItems(current);
    };

    await runPool(
      targets,
      props.concurrency,
      async (item) => {
        apply(item.id, { status: 'generating' });
        try {
          const layer = await props.generate(
            { ...props.options, glyphSubject: item.concept || item.name },
            item.concept || item.name,
          );
          props.onItemGlyph(item.id, layer);
          // Deselect on success, so the next "Generate selected" targets only
          // what still needs doing.
          apply(item.id, { status: 'ready', revision: item.revision + 1, selected: false });
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
    <section className="panel">
      <div className="grid-head">
        <h2>Icon library</h2>
        <span className="muted-count">
          {props.items.length} icon{props.items.length === 1 ? '' : 's'}
          {selectedCount ? ` · ${selectedCount} selected` : ''}
        </span>
      </div>

      <div className="row">
        <button type="button" className="ghost" onClick={() => input.current?.click()}>
          Import list
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
      </div>

      <p className="hint">
        A CSV, a JSON manifest, or just one name per line. Hundreds at a time is fine.
      </p>

      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!selectedCount || running}
          onClick={() => runBatch(props.items.filter((item) => item.selected))}
        >
          {running ? 'Generating…' : `Generate ${selectedCount || ''} selected`}
        </button>
        {running && (
          <button type="button" className="ghost" onClick={() => { stopped.current = true; }}>
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
                compose={props.compose}
                layers={{ material: props.material, glyph: props.glyphs.get(item.id) ?? null }}
              />

              <div className="card-name" title={item.concept || item.name}>
                {item.name}
              </div>
              <div className="card-foot">
                <span className={`badge badge-${item.status}`}>
                  {item.status === 'ready' ? `v${item.revision}` : item.status}
                </span>
                <button
                  type="button"
                  className="ghost tiny"
                  disabled={running}
                  onClick={() => runBatch([item])}
                >
                  {item.status === 'ready' ? 'Redo' : 'Make'}
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
