import { useEffect, useRef } from 'react';
import { renderMask } from '../core/compose';
import { normalizeSpec, type ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
}

const RUNS = 6;
const TILE = 96;
/** Spread of the simulated jitter, as a fraction of the nominal exponent. */
const JITTER = 0.18;

/**
 * Side-by-side illustration of the two pipelines.
 *
 * The top row is the spec compiled to a path six times. The bottom row is the
 * same nominal shape with a pseudo-random perturbation applied per run, which
 * is what asking a diffusion model for "radius 30%" amounts to in practice —
 * the number is a hint it reinterprets on every generation.
 *
 * The jitter is simulated and labelled as such: it stands in for prompted
 * geometry so the difference is visible without spending six API calls.
 */
export default function DriftLab({ spec }: Props) {
  const locked = useRef<HTMLDivElement>(null);
  const drifting = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const small: ContainerSpec = normalizeSpec({ ...spec, size: TILE });

    const lockedTiles = Array.from({ length: RUNS }, () => renderMask(small));

    // Deterministic pseudo-random so the demo is stable between renders while
    // still showing a different value per run.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const driftTiles = Array.from({ length: RUNS }, () =>
      renderMask(
        normalizeSpec({
          ...small,
          exponent: spec.exponent * (1 + (next() - 0.5) * 2 * JITTER),
          radius: spec.radius * (1 + (next() - 0.5) * 2 * JITTER),
        }),
      ),
    );

    const paint = (node: HTMLDivElement | null, tiles: HTMLCanvasElement[], tone: string) => {
      if (!node) return;
      for (const tile of tiles) {
        tile.className = 'drift-tile';
        tile.style.filter = `drop-shadow(0 0 0 ${tone})`;
      }
      node.replaceChildren(...tiles);
    };

    paint(locked.current, lockedTiles, 'transparent');
    paint(drifting.current, driftTiles, 'transparent');
  }, [spec]);

  return (
    <section className="panel">
      <h2>Drift comparison</h2>

      <div className="drift-row">
        <span className="drift-label drift-label-ok">Spec-compiled — {RUNS} runs</span>
        <div className="drift-strip" ref={locked} />
      </div>

      <div className="drift-row">
        <span className="drift-label drift-label-bad">
          Prompted geometry — {RUNS} runs (simulated ±{Math.round(JITTER * 100)}%)
        </span>
        <div className="drift-strip" ref={drifting} />
      </div>

      <p className="hint">
        Top row: six independent renders of the same spec. They are bit-identical, which the
        determinism check will confirm. Bottom row simulates what a prompted radius does — the
        shape is re-decided on every generation, so nothing in a family lines up.
      </p>
    </section>
  );
}
