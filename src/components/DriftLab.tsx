import { useEffect, useRef } from 'react';
import { containerPath } from '../core/geometry';
import { normalizeSpec, type ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
}

const RUNS = 6;
const TILE = 260;
/** Spread of the simulated jitter, as a fraction of the nominal value. */
const JITTER = 0.18;

/**
 * Side-by-side illustration of the two pipelines, drawn as *overlaid* contours
 * rather than a strip of separate tiles.
 *
 * Six thumbnails side by side hide the thing they are meant to show — a few
 * percent of corner difference is invisible at thumbnail size. Stacking the six
 * outlines in one frame makes it unmissable: identical geometry resolves to a
 * single crisp line, drifting geometry smears into a band whose width *is* the
 * drift.
 *
 * The jitter is simulated and labelled as such. It stands in for prompted
 * geometry so the contrast is visible without spending six API calls; the
 * Measure panel is where real files get real numbers.
 */
export default function DriftLab({ spec }: Props) {
  const locked = useRef<HTMLCanvasElement>(null);
  const drifting = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const base = normalizeSpec({ ...spec, size: TILE, padding: Math.max(spec.padding, 8) });

    const paint = (canvas: HTMLCanvasElement | null, variants: ContainerSpec[], stroke: string) => {
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = TILE * ratio;
      canvas.height = TILE * ratio;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, TILE, TILE);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = stroke;
      // Partial alpha so overlapping outlines accumulate: one line where the
      // runs agree, a visibly denser band where they do not.
      ctx.globalAlpha = 0.55;
      for (const variant of variants) ctx.stroke(new Path2D(containerPath(variant)));
    };

    paint(locked.current, Array.from({ length: RUNS }, () => base), '#34d399');

    // Deterministic pseudo-random: the demo stays stable between renders while
    // still showing a different value per run.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const wobble = (value: number) => value * (1 + (next() - 0.5) * 2 * JITTER);

    paint(
      drifting.current,
      Array.from({ length: RUNS }, () =>
        normalizeSpec({ ...base, exponent: wobble(base.exponent), radius: wobble(base.radius) }),
      ),
      '#f87171',
    );
  }, [spec]);

  return (
    <section className="panel">
      <h2>Drift comparison</h2>

      <div className="drift-pair">
        <figure>
          <canvas ref={locked} />
          <figcaption className="drift-label-ok">Spec-compiled — {RUNS} runs overlaid</figcaption>
        </figure>
        <figure>
          <canvas ref={drifting} />
          <figcaption className="drift-label-bad">
            Prompted geometry — {RUNS} runs (simulated ±{Math.round(JITTER * 100)}%)
          </figcaption>
        </figure>
      </div>

      <p className="hint">
        Six outlines are stacked in each frame. On the left they land on exactly the same path, so
        they read as one line. On the right the shape is re-decided every run, and the spread
        between the outlines is the drift.
      </p>
    </section>
  );
}
