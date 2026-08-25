import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { containerPath } from '../core/geometry';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../core/spec';
import { TUTORIAL, tutorialSeconds } from '../core/tutorial';

interface Props {
  /** Close the walkthrough and leave it off until it is asked for again. */
  onClose: () => void;
}

/** A container outline in a 0..100 box, drawn from the real geometry code. */
function shapePath(patch: Partial<ContainerSpec> = {}): string {
  return containerPath(normalizeSpec({ ...DEFAULT_SPEC, size: 100, padding: 6, ...patch }));
}

const SQUIRCLE = shapePath({ shape: 'superellipse', exponent: 5 });

/**
 * One tile: the app's own squircle, filled the way the composer fills it.
 * `delay` staggers a group so a family appears to assemble rather than snap in.
 */
function Tile({
  path = SQUIRCLE,
  from = '#38bdf8',
  to = '#1d4ed8',
  glyph,
  delay = 0,
  className = '',
}: {
  path?: string;
  from?: string;
  to?: string;
  glyph?: string;
  delay?: number;
  className?: string;
}) {
  // useId, not a colour-derived string: two tiles sharing a fill would
  // otherwise emit the same element id twice and both resolve to the first.
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 100" className={`tut-tile ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={path} />
        </clipPath>
      </defs>
      <path d={path} fill={`url(#${id})`} />
      {/* The gloss is the same contour, slid up and cut back to the tile. The
        * clip has to sit on a wrapper: clip-path on the transformed element
        * itself is resolved in the transformed space, which moves the cut
        * along with the highlight and lets it spill past the top edge. */}
      <g clipPath={`url(#${id}-clip)`}>
        <path d={path} fill="rgba(255,255,255,0.15)" transform="translate(0,-52)" />
      </g>
      {glyph && (
        <text x="50" y="50" className="tut-tile-glyph" textAnchor="middle" dominantBaseline="central">
          {glyph}
        </text>
      )}
    </svg>
  );
}

/** A field the way it looks in the studio, with its value typing itself in. */
function Field({ label, value, delay = 0 }: { label: string; value: string; delay?: number }) {
  return (
    <div className="tut-field" style={{ animationDelay: `${delay}ms` }}>
      <span className="tut-field-label">{label}</span>
      <span className="tut-field-box">
        <span className="tut-type" style={{ animationDelay: `${delay + 200}ms` }}>
          {value}
        </span>
      </span>
    </div>
  );
}

/* --- Scenes ---------------------------------------------------------------
 *
 * Each is a still picture plus CSS timing. They are remounted on every scene
 * change (the stage is keyed by scene id), so the animations restart on replay
 * without any imperative reset.
 */

const GLYPHS = ['✈', '★', '⚙', '☂', '♪', '⌘'];

function SceneStart() {
  return (
    <div className="tut-stage-inner tut-start">
      <Tile className="tut-hero" glyph="✈" />
      <div className="tut-fan">
        {GLYPHS.map((glyph, index) => (
          <Tile key={glyph} glyph={glyph} delay={600 + index * 160} className="tut-pop" />
        ))}
      </div>
    </div>
  );
}

function SceneContainer() {
  const shapes: Array<{ label: string; path: string }> = [
    { label: 'Squircle', path: shapePath({ shape: 'superellipse', exponent: 5 }) },
    { label: 'Rounded', path: shapePath({ shape: 'rounded-rect', radius: 22 }) },
    { label: 'Circle', path: shapePath({ shape: 'circle' }) },
    { label: 'Square', path: shapePath({ shape: 'rounded-rect', radius: 5 }) },
  ];
  return (
    <div className="tut-stage-inner tut-container-scene">
      <div className="tut-shape-row">
        {shapes.map((shape, index) => (
          <div key={shape.label} className="tut-shape-btn" style={{ animationDelay: `${index * 90}ms` }}>
            <svg viewBox="0 0 100 100" className="tut-shape-chip" aria-hidden="true">
              <path d={shape.path} fill="currentColor" />
            </svg>
            <span>{shape.label}</span>
          </div>
        ))}
        <div className="tut-shape-btn tut-shape-btn-on">
          <span className="tut-shape-chip tut-shape-drop">↑</span>
          <span>From my icon</span>
          <span className="tut-cursor" aria-hidden="true" />
        </div>
      </div>
      <div className="tut-drop">
        <Tile className="tut-drop-file" glyph="✈" />
        <span className="tut-drop-name">app-icon@1024.png</span>
      </div>
    </div>
  );
}

function SceneRead() {
  return (
    <div className="tut-stage-inner tut-read">
      <div className="tut-read-master">
        <Tile glyph="✈" />
        <span className="tut-scan" aria-hidden="true" />
        <span className="tut-trace-ring" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <path d={SQUIRCLE} fill="none" stroke="var(--accent)" strokeWidth="2" />
          </svg>
        </span>
      </div>
      <ul className="tut-readout">
        {[
          ['Shape', 'traced — corner curve n ≈ 5.1'],
          ['Base colour', '#2340a8'],
          ['Surface', 'brushed deep indigo metal'],
          ['Symbol', 'a paper plane, solid white'],
        ].map(([label, value], index) => (
          <li key={label} style={{ animationDelay: `${400 + index * 500}ms` }}>
            <span className="tut-readout-label">{label}</span>
            <span className="tut-readout-value">{value}</span>
            <span className="tut-readout-tick">✓</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SceneDescribe() {
  return (
    <div className="tut-stage-inner tut-describe">
      <Tile glyph="✈" from="#4f7bf0" to="#1b2f8f" />
      <div className="tut-fields">
        <Field label="Surface" value="brushed deep indigo metal" delay={200} />
        <Field label="Symbol" value="a paper plane, solid white" delay={1400} />
        <div className="tut-field tut-field-inline" style={{ animationDelay: '2400ms' }}>
          <span className="tut-field-label">Colour</span>
          <span className="tut-swatch" />
        </div>
      </div>
    </div>
  );
}

function SceneOne() {
  return (
    <div className="tut-stage-inner tut-one">
      <div className="tut-one-tile">
        <Tile glyph="✈" />
        <span className="tut-shimmer" aria-hidden="true" />
      </div>
      <div className="tut-one-controls">
        <span className="tut-btn tut-btn-primary">
          Generate icon
          <span className="tut-press" aria-hidden="true" />
        </span>
        <span className="tut-progress-line" aria-hidden="true" />
        <span className="tut-one-status">Painting the surface…</span>
      </div>
    </div>
  );
}

function SceneFamily() {
  return (
    <div className="tut-stage-inner tut-family">
      <div className="tut-family-bar">
        <span className="tut-btn tut-btn-primary">Generate 6 selected</span>
        <span className="tut-atonce">
          At once
          <b>3</b>
        </span>
      </div>
      <div className="tut-cards">
        {GLYPHS.map((glyph, index) => (
          <div
            key={glyph}
            className="tut-card"
            // Three at a time: the first row lands together, the second waits
            // for a slot. This is the concurrency setting, drawn.
            style={{ animationDelay: `${900 + Math.floor(index / 3) * 1500 + (index % 3) * 120}ms` }}
          >
            <Tile glyph={glyph} />
            <span className="tut-card-badge">v1</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneDownload() {
  const targets = ['iOS', 'Android', 'macOS', 'Windows', 'web', '.ico', 'spec.json'];
  return (
    <div className="tut-stage-inner tut-download">
      <div className="tut-sizes">
        {[76, 58, 44, 32, 22].map((size, index) => (
          <span key={size} className="tut-size" style={{ animationDelay: `${index * 130}ms` }}>
            <Tile glyph="✈" />
          </span>
        ))}
      </div>
      <div className="tut-zip">
        {targets.map((target, index) => (
          <span key={target} className="tut-zip-row" style={{ animationDelay: `${700 + index * 130}ms` }}>
            {target}
          </span>
        ))}
      </div>
    </div>
  );
}

function SceneDone() {
  return (
    <div className="tut-stage-inner tut-done">
      <div className="tut-fan tut-fan-wide">
        {GLYPHS.map((glyph, index) => (
          <Tile key={glyph} glyph={glyph} delay={index * 110} className="tut-pop" />
        ))}
      </div>
      <span className="tut-done-note">One master · one look · every size</span>
    </div>
  );
}

const SCENES: Record<string, () => JSX.Element> = {
  start: SceneStart,
  container: SceneContainer,
  read: SceneRead,
  describe: SceneDescribe,
  one: SceneOne,
  family: SceneFamily,
  download: SceneDownload,
  done: SceneDone,
};

/**
 * The walkthrough: a short silent film of the minimum path, with the controls
 * of a video player.
 *
 * It plays itself because the point is to be watched, not operated — but every
 * scene is reachable directly from the chapter rail, and someone who reduces
 * motion gets it paused on scene one with the same words on screen.
 */
export default function Tutorial({ onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const closeButton = useRef<HTMLButtonElement>(null);

  const scene = TUTORIAL[index];
  const last = index === TUTORIAL.length - 1;

  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(TUTORIAL.length - 1, next)));
  }, []);

  // Someone who has asked for less motion should not be handed an autoplaying
  // slideshow. Same content, paused, theirs to advance.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (last) {
      // Stop on the last scene rather than looping: a walkthrough that will not
      // end reads as something you have to escape.
      const done = setTimeout(() => setPlaying(false), scene.seconds * 1000);
      return () => clearTimeout(done);
    }
    const timer = setTimeout(() => setIndex((current) => current + 1), scene.seconds * 1000);
    return () => clearTimeout(timer);
  }, [playing, index, last, scene.seconds]);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') { setPlaying(false); go(index + 1); }
      else if (event.key === 'ArrowLeft') { setPlaying(false); go(index - 1); }
      else if (event.key === ' ') { event.preventDefault(); setPlaying((current) => !current); }
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go, onClose]);

  const Scene = SCENES[scene.id] ?? SceneStart;
  const total = tutorialSeconds();

  return (
    <div className="tut-backdrop" role="dialog" aria-modal="true" aria-label="How this works">
      <figure className="tut">
        <div className="tut-rail">
          {TUTORIAL.map((entry, position) => (
            <button
              key={entry.id}
              type="button"
              className="tut-rail-seg"
              aria-label={`${entry.chapter}: ${entry.title}`}
              aria-current={position === index}
              onClick={() => { setPlaying(false); go(position); }}
            >
              <span
                className={position < index ? 'tut-rail-fill tut-rail-done' : 'tut-rail-fill'}
                style={
                  position === index
                    ? { animationDuration: `${entry.seconds}s`, animationPlayState: playing ? 'running' : 'paused' }
                    : undefined
                }
                data-live={position === index || undefined}
              />
            </button>
          ))}
        </div>

        <div className="tut-head">
          <span className="tut-chapter">{scene.chapter}</span>
          <span className="tut-runtime">
            {index + 1} / {TUTORIAL.length} · about {Math.round(total / 5) * 5}s in full
          </span>
          <button ref={closeButton} type="button" className="tut-close" onClick={onClose} aria-label="Close walkthrough">
            ✕
          </button>
        </div>

        {/* Keyed by scene: remounting is what restarts every CSS animation. */}
        <div className="tut-stage" key={scene.id}>
          <Scene />
        </div>

        <figcaption className="tut-copy">
          <h2>{scene.title}</h2>
          <p>{scene.caption}</p>
          <ul>
            {scene.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </figcaption>

        <div className="tut-controls">
          <button type="button" className="ghost" onClick={() => { setPlaying(false); go(index - 1); }} disabled={index === 0}>
            ‹ Back
          </button>
          <button type="button" className="ghost" onClick={() => setPlaying((current) => !current)}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          {last ? (
            <button type="button" className="primary" onClick={onClose}>
              Start making icons
            </button>
          ) : (
            <button type="button" className="ghost" onClick={() => { setPlaying(false); go(index + 1); }}>
              Next ›
            </button>
          )}
          <button type="button" className="tut-skip" onClick={onClose}>
            Skip — turn the tutorial off
          </button>
        </div>
      </figure>
    </div>
  );
}
