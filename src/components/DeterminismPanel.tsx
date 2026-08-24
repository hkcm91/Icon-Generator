import { useState } from 'react';
import { composeIcon, type ComposeLayers, type ComposeOptions } from '../core/compose';
import { containerPath } from '../core/geometry';
import { hashPixels, hashString } from '../core/hash';
import type { ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
}

interface Report {
  runs: number;
  pathHash: string;
  pixelHashes: string[];
  identical: boolean;
  elapsedMs: number;
}

/**
 * Renders the current icon N times and compares the results bit-for-bit.
 *
 * This exists because "the radius is stable now" is a claim the user has every
 * reason to distrust — they have been burned by a pipeline that looked stable
 * and was not. Hashing the actual pixels is the only answer that settles it.
 */
export default function DeterminismPanel({ spec, compose, layers }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (runs: number) => {
    setBusy(true);
    // Yield once so the button's disabled state paints before the loop blocks.
    await new Promise((done) => setTimeout(done, 0));

    const started = performance.now();
    const pixelHashes: string[] = [];
    for (let i = 0; i < runs; i++) {
      const canvas = composeIcon(spec, layers, compose);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) break;
      pixelHashes.push(hashPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
    }

    setReport({
      runs,
      pathHash: hashString(containerPath(spec)),
      pixelHashes,
      identical: pixelHashes.every((hash) => hash === pixelHashes[0]),
      elapsedMs: performance.now() - started,
    });
    setBusy(false);
  };

  return (
    <section className="panel">
      <h2>Determinism check</h2>
      <p className="hint">
        Re-render this exact icon many times and hash every frame. Any drift shows up as a second
        hash.
      </p>

      <div className="row">
        <button type="button" disabled={busy} onClick={() => run(10)}>
          Run 10x
        </button>
        <button type="button" disabled={busy} onClick={() => run(50)}>
          Run 50x
        </button>
      </div>

      {report && (
        <div className={report.identical ? 'verdict verdict-ok' : 'verdict verdict-bad'}>
          <strong>
            {report.identical
              ? `${report.runs}/${report.runs} renders identical`
              : `Drift detected across ${report.runs} renders`}
          </strong>
          <dl>
            <div>
              <dt>Path hash</dt>
              <dd className="mono">{report.pathHash}</dd>
            </div>
            <div>
              <dt>Pixel hash</dt>
              <dd className="mono">{report.pixelHashes[0]}</dd>
            </div>
            <div>
              <dt>Distinct hashes</dt>
              <dd>{new Set(report.pixelHashes).size}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{report.elapsedMs.toFixed(0)} ms</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
