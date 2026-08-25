import { useRef, useState } from 'react';
import Preview from './Preview';
import { containerPath } from '../core/geometry';
import { traceMaster } from '../core/trace';
import { describeMaster } from '../core/describe';
import { nameSymbol } from '../core/vision';
import { SHAPE_PRESETS, matchPreset, normalizeSpec, type ContainerSpec } from '../core/spec';
import type { ComposeLayers, ComposeOptions } from '../core/compose';
import { useGeneration, type GenerationOptions } from '../state/useGeneration';
import IconGrid from './IconGrid';
import type { IconItem } from '../core/library';
import {
  PLATFORM_TARGETS,
  blobBytes,
  buildIco,
  buildZip,
  canvasToBlob,
  download,
  ICO_SIZES,
  renderAtSize,
  svgMask,
} from '../core/export';
import { modelOutputCost } from '../core/cost';

interface Props {
  familyName: string;
  onFamilyName: (value: string) => void;
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
  model: string;
  onModel: (value: string) => void;
  quality: 'low' | 'medium' | 'high';
  onQuality: (value: 'low' | 'medium' | 'high') => void;
  premiumAllowed: boolean;
  onPremiumAllowed: (value: boolean) => void;
  visionModel: string;
  material: string;
  familyPrompt: string;
  negativePrompt: string;
  glyph: string;
  glyphColor: string;
  onSpec: (patch: Partial<ContainerSpec>) => void;
  onCompose: (patch: Partial<ComposeOptions>) => void;
  onMaterial: (value: string) => void;
  onFamilyPrompt: (value: string) => void;
  onNegativePrompt: (value: string) => void;
  onGlyph: (value: string) => void;
  onGlyphColor: (value: string) => void;
  onMaterialLayer: (image: CanvasImageSource | null) => void;
  onGlyphLayer: (image: CanvasImageSource | null) => void;
  master: { name: string; dataUrl: string } | null;
  onMaster: (master: { name: string; dataUrl: string } | null) => void;
  items: IconItem[];
  onItems: (items: IconItem[]) => void;
  concurrency: number;
  onConcurrency: (value: number) => void;
  materialLayer: CanvasImageSource | null;
  glyphs: Map<string, CanvasImageSource>;
  onItemGlyph: (id: string, image: CanvasImageSource, revision?: number) => void;
  onRestoreRevision: (id: string, revision: number) => Promise<boolean>;
  onClearGlyphs: () => void;
  lockedContainer: boolean;
  onLockedContainer: (value: boolean) => void;
  references: Array<{ name: string; dataUrl: string }>;
  onReferences: (value: Array<{ name: string; dataUrl: string }>) => void;
  exportApprovedOnly: boolean;
  onExportApprovedOnly: (value: boolean) => void;
  exportSelectedOnly: boolean;
  onExportSelectedOnly: (value: boolean) => void;
  calibrationRequired: boolean;
  onCalibrationRequired: (value: boolean) => void;
  maxBatchCost: number;
  onMaxBatchCost: (value: number) => void;
}

/** Small filled thumbnail of a shape, for the preset buttons. */
function ShapeChip({ spec }: { spec: ContainerSpec }) {
  const preview = normalizeSpec({ ...spec, size: 48, padding: 4 });
  return (
    <svg viewBox="0 0 48 48" className="shape-chip" aria-hidden="true">
      <path d={containerPath(preview)} fill="currentColor" />
    </svg>
  );
}

/** Decode once, returning both the pixels to analyse and a URL to send. */
async function readMaster(
  file: File,
): Promise<{ pixels: ImageData; dataUrl: string; stored: string; layer: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
    dataUrl: canvas.toDataURL('image/png'),
    // A separate, smaller copy for persistence. A full-size master is easily
    // half a megabyte as a data URL and localStorage caps out around five,
    // which a family project would blow through on the master alone.
    stored: downscale(canvas, 384),
    layer: canvas,
  };
}

function downscale(source: HTMLCanvasElement, size: number): string {
  const scale = Math.min(1, size / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * The guided view: shape, look, generate, download.
 *
 * Everything that is a *diagnostic* or a *fine adjustment* lives in the full
 * view instead. The geometry controls in particular are deliberately absent —
 * the presets and the trace cover what people actually need, and exposing an
 * exponent slider by default invites fiddling with the one thing that is
 * supposed to be settled.
 */
export default function SimpleStudio(props: Props) {
  const { status, generateIcon, generateGlyph, generateForItem, setStatus } = useGeneration();
  const [tracing, setTracing] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lockedInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const active = matchPreset(props.spec);
  const scaleSaverQuality = 'low' as const;
  const cost = modelOutputCost(props.model, scaleSaverQuality);
  const premiumBlocked = cost !== null && cost > 0.05 && !props.premiumAllowed;
  const premiumMessage = premiumBlocked
    ? `Premium generation is locked: this setting is about $${cost.toFixed(3)} per output.`
    : undefined;

  /**
   * One upload does everything: shape, colour, material wording, and — where a
   * vision model is reachable — the name of the symbol. Every field it fills
   * stays editable; this is a starting point, not a decision.
   */
  const useMaster = async (files: FileList | null, exact = false) => {
    const file = files?.[0];
    if (!file) return;
    setTracing('Reading your icon…');
    setNotes([]);

    let dataUrl = '';
    try {
      const master = await readMaster(file);
      dataUrl = master.dataUrl;
      // Registered before anything else can fail, so a later vision error still
      // leaves every generation referencing the approved master.
      props.onMaster({ name: file.name, dataUrl: master.stored });
      props.onLockedContainer(exact);
      if (exact) props.onMaterialLayer(master.layer);

      const traced = traceMaster(master.pixels, 'symmetric', props.spec);
      props.onSpec(traced.spec);

      const described = describeMaster(master.pixels, traced.spec.glyphInset);
      props.onMaterial(described.material);
      props.onCompose({ baseColor: described.baseColor });
      setNotes(described.notes);
      setTracing(
        `Shape and colours taken from ${file.name}. Corner curve n ≈ ${traced.exponent.toFixed(1)}.`,
      );

      if (!described.glyph.present) {
        props.onGlyph('');
        return;
      }
      // Local analysis can prove a symbol is there and what colour it is, but
      // not what it depicts. Only that last step needs the network.
      // Clear first: whatever is in the field describes the *previous* icon,
      // and leaving it would have the field assert something about this master
      // that was never established.
      props.onGlyph('');
      setTracing('Working out what the symbol is…');
      const named = await nameSymbol(dataUrl, props.visionModel);
      props.onGlyph(named ? `${named}, ${described.glyph.colorName}` : '');
      setTracing(
        named
          ? `Read everything from ${file.name}. Edit anything below.`
          : `Read ${file.name}. Could not name the symbol — describe it yourself.`,
      );
    } catch (error) {
      // A vision failure must not lose the shape and colour work already done.
      setTracing(
        dataUrl
          ? `Shape and colours read. Naming the symbol failed: ${(error as Error).message}`
          : `Could not read that image: ${(error as Error).message}`,
      );
    }
  };

  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return;
    const added = await Promise.all(Array.from(files).map(async (file) => {
      const image = await readMaster(file);
      return { name: file.name, dataUrl: image.stored };
    }));
    props.onReferences([...props.references, ...added].slice(0, 6));
  };

  const run = () => {
    if (premiumMessage) {
      setStatus({ kind: 'error', message: premiumMessage });
      return;
    }
    const options: GenerationOptions = {
        spec: props.spec,
        model: props.model,
        material: props.material,
        // The guided view keeps one symbol field; style words in the same
        // sentence work fine, so there is no reason to split it in two.
        glyphSubject: props.glyph,
        glyphStyle: '',
        conditioning: 'auto',
        wantAlpha: true,
        master: props.master?.dataUrl ?? null,
        references: props.references.map((reference) => reference.dataUrl),
        familyPrompt: props.familyPrompt,
        negativePrompt: props.negativePrompt,
        quality: scaleSaverQuality,
      };
    if (props.lockedContainer && props.materialLayer) {
      if (!props.glyph.trim()) {
        setStatus({ kind: 'ok', message: 'Approved container kept exactly; no glyph requested.' });
        return;
      }
      void generateGlyph(options, props.onGlyphLayer);
      return;
    }
    void generateIcon(options, props.onMaterialLayer, props.onGlyphLayer);
  };

  const downloadAll = async () => {
    setExporting(true);
    try {
      const files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> = [];
      const contacts: Array<{ name: string; canvas: HTMLCanvasElement }> = [];
      const safe = (value: string) =>
        value.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/[. ]+$/g, '').slice(0, 96) || 'icon';
      const ready = props.items.filter((item) =>
        item.status === 'ready' &&
        props.glyphs.has(item.id) &&
        (!props.exportApprovedOnly || item.approved),
      ).filter((item) => !props.exportSelectedOnly || item.selected);
      if (props.items.length && !ready.length) {
        throw new Error(props.exportApprovedOnly
          ? 'Approve at least one finished icon before exporting approved-only.'
          : props.exportSelectedOnly
            ? 'Select at least one finished icon before exporting selected-only.'
          : 'Generate at least one family icon before exporting.');
      }
      const targets = ready.length
        ? ready.map((item) => ({ item, glyph: props.glyphs.get(item.id)! }))
        : [{ item: { id: 'current', name: props.glyph || 'Icon', revision: 1 }, glyph: props.layers.glyph }];

      for (const { item, glyph } of targets) {
        const stem = safe(item.name);
        const layers = { material: props.materialLayer, glyph };
        const itemCompose: ComposeOptions = {
          ...props.compose,
          glyphScale: props.compose.glyphScale * ('opticalScale' in item ? (item.opticalScale ?? 1) : 1),
          glyphOffsetX: 'opticalOffsetX' in item ? (item.opticalOffsetX ?? 0) : 0,
          glyphOffsetY: 'opticalOffsetY' in item ? (item.opticalOffsetY ?? 0) : 0,
        };
        for (const target of PLATFORM_TARGETS) {
          const canvas = renderAtSize(props.spec, target.size, layers, itemCompose);
          files.push({
            name: `${stem}/${target.platform}/${target.name}.png`,
            bytes: await blobBytes(await canvasToBlob(canvas)),
          });
        }
        const ico = [];
        for (const size of ICO_SIZES) {
          const canvas = renderAtSize(props.spec, size, layers, itemCompose);
          ico.push({ size, bytes: await blobBytes(await canvasToBlob(canvas)) });
        }
        files.push({ name: `${stem}/windows/${stem}.ico`, bytes: await blobBytes(await buildIco(ico)) });
        contacts.push({ name: item.name, canvas: renderAtSize(props.spec, 128, layers, itemCompose) });
      }
      if (contacts.length) {
        const columns = Math.min(5, contacts.length);
        const rows = Math.ceil(contacts.length / columns);
        const sheet = document.createElement('canvas');
        sheet.width = columns * 160;
        sheet.height = rows * 176;
        const ctx = sheet.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(0, 0, sheet.width, sheet.height);
          ctx.fillStyle = '#0f172a';
          ctx.font = '13px system-ui';
          ctx.textAlign = 'center';
          contacts.forEach((contact, index) => {
            const x = (index % columns) * 160;
            const y = Math.floor(index / columns) * 176;
            ctx.drawImage(contact.canvas, x + 16, y + 8, 128, 128);
            ctx.fillText(contact.name.slice(0, 22), x + 80, y + 157);
          });
          files.push({ name: 'family-contact-sheet.png', bytes: await blobBytes(await canvasToBlob(sheet)) });
        }
      }
      files.push({ name: 'container-mask.svg', bytes: new TextEncoder().encode(svgMask(props.spec)) });
      files.push({
        name: 'container-spec.json',
        bytes: new TextEncoder().encode(JSON.stringify(props.spec, null, 2)),
      });
      files.push({
        name: 'family-manifest.json',
        bytes: new TextEncoder().encode(JSON.stringify({
          schemaVersion: 1,
          familyName: props.familyName,
          exportedAt: new Date().toISOString(),
          iconCount: targets.length,
          icons: targets.map(({ item }) => ({
            id: item.id,
            name: item.name,
            revision: 'activeRevision' in item ? (item.activeRevision ?? item.revision) : item.revision,
            latestRevision: item.revision,
            category: 'category' in item ? item.category : undefined,
            keywords: 'keywords' in item ? item.keywords : undefined,
            approved: 'approved' in item ? item.approved : undefined,
            anchor: 'anchor' in item ? item.anchor : undefined,
            calibration: 'calibration' in item ? item.calibration : undefined,
            complexity: 'complexity' in item ? item.complexity : undefined,
            role: 'role' in item ? item.role : undefined,
            opticalScale: 'opticalScale' in item ? item.opticalScale : undefined,
            opticalOffsetX: 'opticalOffsetX' in item ? item.opticalOffsetX : undefined,
            opticalOffsetY: 'opticalOffsetY' in item ? item.opticalOffsetY : undefined,
            notes: 'notes' in item ? item.notes : undefined,
          })),
          containerSpec: props.spec,
        }, null, 2)),
      });
      files.push({
        name: 'package-index.txt',
        bytes: new TextEncoder().encode(files.map((file) => file.name).sort().join('\n')),
      });
      download(buildZip(files), `${safe(props.familyName)}.zip`);
      setStatus({ kind: 'ok', message: `Exported ${targets.length} icon${targets.length === 1 ? '' : 's'} with manifest.` });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const busy = status.kind === 'busy';

  return (
    <div className="studio">
      <Preview spec={props.spec} compose={props.compose} layers={props.layers} showGuides={false} />
      <div className="studio-flow">
        <label className="field family-name-field">
          <span className="field-label">Family name</span>
          <input value={props.familyName} onChange={(event) => props.onFamilyName(event.target.value)} />
        </label>
        <ol className="steps">
        <li>
          <h3>
            <span className="step-num">1</span> Pick a shape
          </h3>
          <div className="shape-row">
            {SHAPE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={active === preset.id ? 'shape-btn shape-btn-on' : 'shape-btn'}
                onClick={() => props.onSpec(preset.patch)}
              >
                <ShapeChip spec={normalizeSpec({ ...props.spec, ...preset.patch })} />
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={active === null ? 'shape-btn shape-btn-on' : 'shape-btn'}
              onClick={() => input.current?.click()}
            >
              <span className="shape-chip shape-chip-drop">↑</span>
              From my icon
            </button>
            <button
              type="button"
              className={props.lockedContainer ? 'shape-btn shape-btn-on' : 'shape-btn'}
              onClick={() => lockedInput.current?.click()}
            >
              <span className="shape-chip shape-chip-drop">✓</span>
              Exact container
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void useMaster(event.target.files)}
            />
            <input
              ref={lockedInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void useMaster(event.target.files, true)}
            />
          </div>
          {props.master && (
            <p className="status status-ok">
              Master: {props.master.name} — {props.lockedContainer
                ? 'container pixels are locked; only glyphs will change.'
                : 'every generation references it.'}
            </p>
          )}
          {tracing && <p className="hint">{tracing}</p>}
          {notes.length > 0 && (
            <ul className="notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </li>

        <li>
          <h3>
            <span className="step-num">2</span> Describe the look
          </h3>
          <label className="field">
            <span className="field-label">Surface</span>
            <input
              value={props.material}
              placeholder="brushed deep indigo metal"
              onChange={(event) => props.onMaterial(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Symbol — leave empty for a plain tile</span>
            <input
              value={props.glyph}
              placeholder="a paper plane, solid white"
              onChange={(event) => props.onGlyph(event.target.value)}
            />
          </label>
          <label className="field field-inline">
            <span className="field-label">Colour</span>
            <input
              type="color"
              value={props.compose.baseColor}
              onChange={(event) => props.onCompose({ baseColor: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Family art direction</span>
            <textarea value={props.familyPrompt} placeholder="shared lighting, material, camera and style rules"
              onChange={(event) => props.onFamilyPrompt(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Exclude</span>
            <input value={props.negativePrompt} placeholder="text, extra objects, inconsistent perspective"
              onChange={(event) => props.onNegativePrompt(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Generation model</span>
            <input value={props.model} placeholder="owner/model" onChange={(event) => props.onModel(event.target.value)} />
          </label>
          {props.model === 'openai/gpt-image-2' && (
            <div className="field">
              <span className="field-label">Quality and cost</span>
              <div className="scale-saver-quality">Scale Saver Low — about $0.012/output</div>
              <p className="hint">Final exports keep this tier; size and finishing are handled locally.</p>
            </div>
          )}
          {cost !== null && <p className={cost > 0.05 ? 'status status-error' : 'status status-ok'}>
            Estimated Replicate charge: about ${cost.toFixed(3)} per generated output.
            {' '}A new material plus an AI glyph uses two outputs; exact library artwork uses none.
          </p>}
          {cost !== null && cost > 0.05 && (
            <label className="toggle premium-lock">
              <input type="checkbox" checked={props.premiumAllowed}
                onChange={(event) => props.onPremiumAllowed(event.target.checked)} />
              Allow premium generation at about ${cost.toFixed(3)} per output
            </label>
          )}
          <label className="field field-inline">
            <span className="field-label">Glyph colour</span>
            <input
              type="color"
              value={props.glyphColor}
              onChange={(event) => props.onGlyphColor(event.target.value)}
            />
          </label>
          <div className="row reference-row">
            <button type="button" className="ghost" onClick={() => referenceInput.current?.click()}>
              Add appearance references
            </button>
            <input
              ref={referenceInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => void addReferences(event.target.files)}
            />
            {props.references.map((reference, index) => (
              <button
                key={`${reference.name}-${index}`}
                type="button"
                className="chip"
                title="Remove reference"
                onClick={() => props.onReferences(props.references.filter((_, at) => at !== index))}
              >
                {reference.name} ×
              </button>
            ))}
          </div>
          <div className="style-grid simple-controls">
            <label className="field">
              <span className="field-label">Glyph size <b>{Math.round(props.compose.glyphScale * 100)}%</b></span>
              <input type="range" min={50} max={140} value={props.compose.glyphScale * 100}
                onChange={(event) => props.onCompose({ glyphScale: Number(event.target.value) / 100 })} />
            </label>
            <label className="field">
              <span className="field-label">Rim <b>{props.compose.rimWidth}px</b></span>
              <input type="range" min={0} max={24} value={props.compose.rimWidth}
                onChange={(event) => props.onCompose({ rimWidth: Number(event.target.value) })} />
            </label>
            <label className="field">
              <span className="field-label">Shadow <b>{props.compose.shadowBlur}px</b></span>
              <input type="range" min={0} max={120} value={props.compose.shadowBlur}
                onChange={(event) => props.onCompose({ shadowBlur: Number(event.target.value) })} />
            </label>
          </div>
        </li>

        <li>
          <h3>
            <span className="step-num">3</span> Make it
          </h3>
          <div className="row">
            <button type="button" className="primary" onClick={run} disabled={busy || premiumBlocked}>
              {busy ? 'Working…' : `Generate icon${cost !== null ? ` · ~${(cost * (props.glyph.trim() ? 2 : 1)).toFixed(3)}` : ''}`}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                props.onMaterialLayer(null);
                props.onGlyphLayer(null);
              }}
              disabled={busy}
            >
              Clear
            </button>
          </div>
          {status.kind === 'busy' && <p className="status status-busy">{status.what}…</p>}
          {status.kind === 'error' && <p className="status status-error">{status.message}</p>}
          {status.kind === 'ok' && <p className="status status-ok">{status.message}</p>}
        </li>

        <li>
          <h3>
            <span className="step-num">4</span> Make a whole family
          </h3>
          <div className="scale-saver">
            <strong>Scale saver</strong>
            <label className="toggle">
              <input type="checkbox" checked={props.calibrationRequired}
                onChange={(event) => props.onCalibrationRequired(event.target.checked)} />
              Generate and approve six paid samples before the full batch
            </label>
            <label className="field field-inline">
              <span className="field-label">Hard limit per batch</span>
              <span>$</span>
              <input type="number" min={0} step={0.25} value={props.maxBatchCost}
                onChange={(event) => props.onMaxBatchCost(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <p className="hint">Exact SVG/custom artwork renders locally for $0. Identical AI requests reuse the saved result.</p>
          </div>
          <IconGrid
            spec={props.spec}
            compose={props.compose}
            material={props.materialLayer}
            glyphColor={props.glyphColor}
            items={props.items}
            concurrency={props.concurrency}
            onItems={props.onItems}
            onConcurrency={props.onConcurrency}
            generate={generateForItem}
            glyphs={props.glyphs}
            onItemGlyph={props.onItemGlyph}
            onRestoreRevision={props.onRestoreRevision}
            onClearGlyphs={props.onClearGlyphs}
            options={{
              spec: props.spec,
              model: props.model,
              material: props.material,
              glyphStyle: '',
              conditioning: 'auto',
              wantAlpha: true,
              master: props.master?.dataUrl ?? null,
              references: props.references.map((reference) => reference.dataUrl),
              familyPrompt: props.familyPrompt,
              negativePrompt: props.negativePrompt,
              quality: scaleSaverQuality,
            }}
            generationBlocked={premiumMessage}
            calibrationRequired={props.calibrationRequired}
            maxBatchCost={props.maxBatchCost}
          />
        </li>

        <li>
          <h3>
            <span className="step-num">5</span> Download
          </h3>
          <button type="button" onClick={downloadAll} disabled={exporting}>
            {exporting ? 'Rendering every size…' : 'Download all icon sizes'}
          </button>
          <label className="toggle export-gate">
            <input
              type="checkbox"
              checked={props.exportApprovedOnly}
              onChange={(event) => {
                props.onExportApprovedOnly(event.target.checked);
                if (event.target.checked) props.onExportSelectedOnly(false);
              }}
            />
            Export approved icons only
          </label>
          <label className="toggle export-gate">
            <input
              type="checkbox"
              checked={props.exportSelectedOnly}
              onChange={(event) => {
                props.onExportSelectedOnly(event.target.checked);
                if (event.target.checked) props.onExportApprovedOnly(false);
              }}
            />
            Export selected ready icons only
          </label>
          <div className="qa-summary" aria-label="Family QA summary">
            <span className="badge badge-ready">
              {props.items.filter((item) => item.status === 'ready').length} ready
            </span>
            <span className="badge">
              {props.items.filter((item) => item.approved).length} approved
            </span>
            <span className="badge">
              {props.items.filter((item) => item.status === 'failed').length} failed
            </span>
            <span className="badge">
              {props.items.filter((item) => item.status === 'draft').length} draft
            </span>
          </div>
          {status.kind === 'error' && <p className="status status-error">{status.message}</p>}
          {status.kind === 'ok' && <p className="status status-ok">{status.message}</p>}
          <p className="hint">
            iOS, Android, macOS, Windows and web, plus a .ico and the shape spec. Every size is
            rendered fresh, not shrunk down.
          </p>
        </li>
        </ol>
      </div>
    </div>
  );
}
