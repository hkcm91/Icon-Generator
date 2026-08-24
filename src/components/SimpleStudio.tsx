import { useRef, useState } from 'react';
import Preview from './Preview';
import { containerPath } from '../core/geometry';
import { traceMaster } from '../core/trace';
import { SHAPE_PRESETS, matchPreset, normalizeSpec, type ContainerSpec } from '../core/spec';
import type { ComposeLayers, ComposeOptions } from '../core/compose';
import { useGeneration } from '../state/useGeneration';
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

interface Props {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
  model: string;
  material: string;
  glyph: string;
  onSpec: (patch: Partial<ContainerSpec>) => void;
  onCompose: (patch: Partial<ComposeOptions>) => void;
  onMaterial: (value: string) => void;
  onGlyph: (value: string) => void;
  onMaterialLayer: (image: CanvasImageSource | null) => void;
  onGlyphLayer: (image: CanvasImageSource | null) => void;
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

async function readPixels(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
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
  const { status, generateIcon } = useGeneration();
  const [tracing, setTracing] = useState('');
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = matchPreset(props.spec);

  const useMaster = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setTracing('Reading your master…');
    try {
      const result = traceMaster(await readPixels(file), 'symmetric', props.spec);
      props.onSpec(result.spec);
      setTracing(
        `Shape taken from ${file.name}. Corner curve n ≈ ${result.exponent.toFixed(1)}.`,
      );
    } catch (error) {
      setTracing(`Could not read that image: ${(error as Error).message}`);
    }
  };

  const run = () =>
    generateIcon(
      {
        spec: props.spec,
        model: props.model,
        material: props.material,
        // The guided view keeps one symbol field; style words in the same
        // sentence work fine, so there is no reason to split it in two.
        glyphSubject: props.glyph,
        glyphStyle: '',
        conditioning: 'auto',
        wantAlpha: true,
      },
      props.onMaterialLayer,
      props.onGlyphLayer,
    );

  const downloadAll = async () => {
    setExporting(true);
    try {
      const files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> = [];
      for (const target of PLATFORM_TARGETS) {
        const canvas = renderAtSize(props.spec, target.size, props.layers, props.compose);
        files.push({
          name: `${target.platform}/${target.name}.png`,
          bytes: await blobBytes(await canvasToBlob(canvas)),
        });
      }
      const ico = [];
      for (const size of ICO_SIZES) {
        const canvas = renderAtSize(props.spec, size, props.layers, props.compose);
        ico.push({ size, bytes: await blobBytes(await canvasToBlob(canvas)) });
      }
      files.push({ name: 'windows/icon.ico', bytes: await blobBytes(await buildIco(ico)) });
      files.push({ name: 'container-mask.svg', bytes: new TextEncoder().encode(svgMask(props.spec)) });
      files.push({
        name: 'container-spec.json',
        bytes: new TextEncoder().encode(JSON.stringify(props.spec, null, 2)),
      });
      download(buildZip(files), 'icons.zip');
    } finally {
      setExporting(false);
    }
  };

  const busy = status.kind === 'busy';

  return (
    <div className="studio">
      <Preview spec={props.spec} compose={props.compose} layers={props.layers} showGuides={false} />

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
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void useMaster(event.target.files)}
            />
          </div>
          {tracing && <p className="hint">{tracing}</p>}
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
        </li>

        <li>
          <h3>
            <span className="step-num">3</span> Make it
          </h3>
          <div className="row">
            <button type="button" className="primary" onClick={run} disabled={busy}>
              {busy ? 'Working…' : 'Generate icon'}
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
            <span className="step-num">4</span> Download
          </h3>
          <button type="button" onClick={downloadAll} disabled={exporting}>
            {exporting ? 'Rendering every size…' : 'Download all icon sizes'}
          </button>
          <p className="hint">
            iOS, Android, macOS, Windows and web, plus a .ico and the shape spec. Every size is
            rendered fresh, not shrunk down.
          </p>
        </li>
      </ol>
    </div>
  );
}
