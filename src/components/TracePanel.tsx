import { useRef, useState } from 'react';
import { containerPath } from '../core/geometry';
import { traceMaster, type TraceMode, type TraceResult } from '../core/trace';
import type { ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
  onApply: (spec: ContainerSpec) => void;
}

const MODES: Array<{ value: TraceMode; label: string; blurb: string }> = [
  {
    value: 'symmetric',
    label: 'Traced, evened out',
    blurb: "Your master's own corner curve, averaged across all four corners.",
  },
  {
    value: 'exact',
    label: 'Traced, verbatim',
    blurb: 'The contour exactly as drawn, asymmetry included.',
  },
  {
    value: 'parametric',
    label: 'Closest ideal shape',
    blurb: 'The nearest clean superellipse. Changes the look by the deviation shown.',
  },
];

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
 * Derive the container spec from an approved master, rather than picking a
 * preset and hoping it matches.
 *
 * If the master is itself slightly irregular, fitting it to an idealised shape
 * bakes that mismatch into every icon that follows — so the master defines the
 * container, not the other way round.
 */
export default function TracePanel({ spec, onApply }: Props) {
  const [pixels, setPixels] = useState<ImageData | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<TraceMode>('symmetric');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const run = (source: ImageData | null, next: TraceMode) => {
    if (!source) return;
    try {
      setResult(traceMaster(source, next, spec));
      setError('');
    } catch (cause) {
      setResult(null);
      setError((cause as Error).message);
    }
  };

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const data = await readPixels(file);
      setPixels(data);
      setName(file.name);
      run(data, mode);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <section className="panel">
      <h2>Trace a master into the spec</h2>
      <p className="hint">
        Drop the icon master you already approved. Its outline becomes the container, so the family
        inherits the shape you signed off rather than an approximation of it.
      </p>

      <div
        className="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void handleFile(event.dataTransfer.files);
        }}
      >
        {name || 'Drop one master PNG here, or click to choose'}
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void handleFile(event.target.files)}
        />
      </div>

      {error && <p className="status status-error">{error}</p>}

      {result && (
        <>
          <div className="chips">
            {MODES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={mode === entry.value ? 'chip chip-on' : 'chip'}
                onClick={() => {
                  setMode(entry.value);
                  run(pixels, entry.value);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="hint">{MODES.find((entry) => entry.value === mode)?.blurb}</p>

          <div className="trace-body">
            <svg viewBox={`0 0 ${result.spec.size} ${result.spec.size}`} className="trace-preview">
              <rect width={result.spec.size} height={result.spec.size} fill="#0a0e17" />
              <path d={containerPath(result.spec)} fill="#38bdf8" fillOpacity="0.18" stroke="#38bdf8" strokeWidth={result.spec.size / 220} />
            </svg>

            <dl className="trace-stats">
              <div>
                <dt>Closest exponent</dt>
                <dd>n ≈ {result.exponent.toFixed(2)}</dd>
              </div>
              <div>
                <dt title="How far the master strays from that ideal shape">Off-ideal</dt>
                <dd>
                  {result.maxDeviation.toFixed(1)}px ({result.deviationPercent.toFixed(2)}%)
                </dd>
              </div>
              <div>
                <dt title="Largest difference between mirrored points — how lopsided the master is">
                  Asymmetry
                </dt>
                <dd>{result.asymmetry.toFixed(1)}px</dd>
              </div>
              <div>
                <dt>Optical padding</dt>
                <dd>{result.spec.padding.toFixed(2)}%</dd>
              </div>
            </dl>
          </div>

          <p className={result.deviationPercent > 1 ? 'status status-error' : 'status status-ok'}>
            {result.deviationPercent > 1
              ? 'This master is not a clean superellipse. Idealising it would visibly change the shape you approved — prefer a traced mode.'
              : 'This master is very close to an ideal superellipse, so any mode will look near-identical.'}
          </p>

          <button type="button" onClick={() => onApply(result.spec)}>
            Use as container spec
          </button>
        </>
      )}
    </section>
  );
}
