import { useRef, useState } from 'react';
import { batchStats, measureImage, type Measurement } from '../core/measure';
import type { ContainerSpec } from '../core/spec';

interface Props {
  onApply: (patch: Partial<ContainerSpec>) => void;
}

interface Row {
  name: string;
  measurement: Measurement;
}

/** Decode a file into pixels without letting a huge PNG stall the main thread. */
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
 * Decide whether a silhouette is a circular-arc rounded rectangle or a
 * continuous-curvature superellipse, by comparing how well each model fits.
 * Reported rather than assumed, because the answer changes which spec field
 * the user should carry forward.
 */
function classify(measurement: Measurement): { label: string; patch: Partial<ContainerSpec> } {
  const { exponent, exponentResidual, circleResidual, radiusPercent } = measurement;

  if (Number.isFinite(exponent) && exponent < 2.15) {
    return { label: 'circle', patch: { shape: 'circle' } };
  }
  // A true arc corner fits a circle to well under a pixel; a squircle does not.
  if (Number.isFinite(circleResidual) && circleResidual < 0.8) {
    return {
      label: 'rounded rect',
      patch: { shape: 'rounded-rect', radius: Number(Math.min(50, radiusPercent).toFixed(2)) },
    };
  }
  if (Number.isFinite(exponent) && exponentResidual < 0.05) {
    return {
      label: `superellipse n≈${exponent.toFixed(2)}`,
      patch: { shape: 'superellipse', exponent: Number(exponent.toFixed(3)) },
    };
  }
  return { label: 'irregular', patch: {} };
}

export default function MeasurePanel({ onApply }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const next: Row[] = [];
    const failures: string[] = [];

    for (const file of Array.from(files)) {
      try {
        next.push({ name: file.name, measurement: measureImage(await readPixels(file)) });
      } catch (cause) {
        failures.push(`${file.name}: ${(cause as Error).message}`);
      }
    }

    setRows(next);
    if (failures.length) setError(failures.join(' · '));
    setBusy(false);
  };

  const stats = rows.length > 1 ? batchStats(rows.map((row) => row.measurement)) : null;

  return (
    <section className="panel">
      <h2>Measure imported PNGs</h2>
      <p className="hint">
        Drop your existing generated containers here to get the real numbers: corner radius,
        superellipse exponent, and how far apart they landed across runs.
      </p>

      <div
        className="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void handleFiles(event.dataTransfer.files);
        }}
      >
        {busy ? 'Measuring…' : 'Drop PNGs here, or click to choose'}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {error && <p className="status status-error">{error}</p>}

      {stats && (
        <div
          className={
            stats.radiusPercent.spread > 1 ? 'verdict verdict-bad' : 'verdict verdict-ok'
          }
        >
          <strong>
            {stats.radiusPercent.spread > 1
              ? `Radius drifts ${stats.radiusPercent.spread.toFixed(2)} points across ${stats.count} files`
              : `Radius is stable across ${stats.count} files`}
          </strong>
          <dl>
            <div>
              <dt>Radius %</dt>
              <dd>
                {stats.radiusPercent.min.toFixed(2)}–{stats.radiusPercent.max.toFixed(2)} (σ{' '}
                {stats.radiusPercent.stdev.toFixed(2)})
              </dd>
            </div>
            <div>
              <dt>Exponent</dt>
              <dd>
                {stats.exponent.min.toFixed(2)}–{stats.exponent.max.toFixed(2)} (σ{' '}
                {stats.exponent.stdev.toFixed(2)})
              </dd>
            </div>
          </dl>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="measure-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Radius</th>
                <th>%</th>
                <th>Shape</th>
                <th>Skew</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const verdict = classify(row.measurement);
                return (
                  <tr key={row.name}>
                    <td className="ellipsis" title={row.name}>
                      {row.name}
                      {row.measurement.keyed && <span className="tag">keyed</span>}
                    </td>
                    <td className="num">{row.measurement.radius.toFixed(1)}px</td>
                    <td className="num">{row.measurement.radiusPercent.toFixed(2)}</td>
                    <td>{verdict.label}</td>
                    <td className="num" title="Max minus min across the four corners">
                      {row.measurement.cornerSpread.toFixed(1)}px
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost tiny"
                        disabled={!Object.keys(verdict.patch).length}
                        onClick={() =>
                          onApply({
                            ...verdict.patch,
                            padding: Number(row.measurement.padding.toFixed(2)),
                          })
                        }
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="hint">
          <b>Use</b> writes that file's measured geometry into the spec — so the container you
          already liked becomes the one you get every time from now on.
        </p>
      )}
    </section>
  );
}
