import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { containerPath } from '../core/geometry';
import { DEFAULT_SPEC, normalizeSpec, type ContainerSpec } from '../core/spec';
import { TRACKS, tutorialSeconds } from '../core/tutorial';

interface Props {
  /** Which track to open on. */
  track: string;
  onTrack: (id: string) => void;
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

/* --- Making a family ----------------------------------------------------- */

/** The glyph picker: catalogue tabs, a search, rows ticking themselves. */
function SceneLibrary() {
  const rows: Array<[string, string]> = [
    ['rocket', 'a rocket taking off'],
    ['rocket_launch', 'a launch with exhaust'],
    ['satellite_alt', 'an orbiting satellite'],
    ['travel_explore', 'a globe with a magnifier'],
  ];
  // Ticks land one after another; the count in the button keeps up with them.
  const tick = (index: number) => 2000 + index * 420;
  return (
    <div className="tut-stage-inner tut-library">
      <div className="tut-picker">
        <div className="tut-picker-tabs">
          <span className="tut-chip tut-chip-on">Material Symbols (3,899)</span>
          <span className="tut-chip">Brands (3,453)</span>
          <span className="tut-chip">Y2K Dream (48)</span>
        </div>
        <span className="tut-search">
          <span className="tut-type tut-type-short">rocket</span>
        </span>
        <div className="tut-picker-list">
          {rows.map(([name, concept], index) => (
            <span className="tut-picker-row" key={name} style={{ animationDelay: `${900 + index * 130}ms` }}>
              <span className="tut-box" style={{ animationDelay: `${tick(index)}ms` }} />
              <span className="tut-picker-name">{name}</span>
              <span className="tut-picker-concept">{concept}</span>
            </span>
          ))}
        </div>
        <span className="tut-btn tut-btn-primary tut-picker-add">Add 4 checked</span>
      </div>
    </div>
  );
}

/** The batch: six cards, three at a time, with the At once control beside it. */
function SceneBatch() {
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

/** One bad card among good ones, re-rolled on its own. */
function SceneRedo() {
  return (
    <div className="tut-stage-inner tut-redo">
      <div className="tut-cards tut-cards-4">
        {['✈', '★', '⚙', '☂'].map((glyph, index) => (
          <div key={glyph} className={index === 2 ? 'tut-card tut-card-bad' : 'tut-card'}>
            {index === 2 ? (
              <>
                {/* The same card twice, cross-faded: failed, then remade. */}
                <span className="tut-card-fail" aria-hidden="true">
                  !
                </span>
                <span className="tut-card-fixed">
                  <Tile glyph={glyph} />
                </span>
                <span className="tut-card-badge tut-card-badge-swap" data-before="failed" data-after="v2" />
              </>
            ) : (
              <>
                <Tile glyph={glyph} />
                <span className="tut-card-badge">v1</span>
              </>
            )}
            <span className={index === 2 ? 'tut-redo-btn tut-redo-btn-live' : 'tut-redo-btn'}>
              {index === 2 ? 'Redo' : 'Redo'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Opaque block in, keyed glyph out — and the switch that asks the model instead. */
function SceneAlpha() {
  return (
    <div className="tut-stage-inner tut-alpha">
      <div className="tut-alpha-row">
        <figure className="tut-alpha-side">
          <span className="tut-alpha-plate tut-alpha-opaque">✈</span>
          <figcaption>as returned</figcaption>
        </figure>
        <span className="tut-alpha-arrow" aria-hidden="true">
          →
        </span>
        <figure className="tut-alpha-side">
          <span className="tut-alpha-plate tut-alpha-clear">✈</span>
          <figcaption>background keyed out</figcaption>
        </figure>
        <span className="tut-alpha-arrow" aria-hidden="true">
          →
        </span>
        <figure className="tut-alpha-side">
          <Tile glyph="✈" className="tut-alpha-final" />
          <figcaption>composited</figcaption>
        </figure>
      </div>
      <span className="tut-toggle-row">
        <span className="tut-check" aria-hidden="true" />
        Request a real alpha channel
        <em>All controls → Generate</em>
      </span>
    </div>
  );
}

/** The family coming back after a reload. */
function SceneKeep() {
  return (
    <div className="tut-stage-inner tut-keep">
      <span className="tut-reload" aria-hidden="true">
        ⟳
      </span>
      <div className="tut-cards">
        {GLYPHS.map((glyph, index) => (
          <div key={glyph} className="tut-card tut-card-back" style={{ animationDelay: `${900 + index * 90}ms` }}>
            <Tile glyph={glyph} />
            <span className="tut-card-badge">v1</span>
          </div>
        ))}
      </div>
      <span className="tut-done-note">Same tab tomorrow · same family</span>
    </div>
  );
}

const SCENES: Record<string, () => JSX.Element> = {
  start: SceneStart,
  container: SceneContainer,
  read: SceneRead,
  describe: SceneDescribe,
  one: SceneOne,
  download: SceneDownload,
  done: SceneDone,
  library: SceneLibrary,
  batch: SceneBatch,
  redo: SceneRedo,
  alpha: SceneAlpha,
  keep: SceneKeep,
};

/**
 * The walkthrough: two short silent films, with the controls of a video player.
 *
 * They play themselves because the point is to be watched, not operated — but
 * every scene is reachable directly from the chapter rail, and someone who
 * reduces motion gets it paused on scene one with the same words on screen.
 */
export default function Tutorial({ track, onTrack, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const closeButton = useRef<HTMLButtonElement>(null);

  const current = TRACKS.find((entry) => entry.id === track) ?? TRACKS[0];
  const scenes = current.scenes;
  // A stale index would index past a shorter track for one render; clamping
  // here rather than in an effect avoids that frame entirely.
  const position = Math.min(index, scenes.length - 1);
  const scene = scenes[position];
  const last = position === scenes.length - 1;
  const nextTrack = TRACKS[TRACKS.indexOf(current) + 1];

  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(scenes.length - 1, next))),
    [scenes.length],
  );

  const switchTo = useCallback(
    (id: string) => {
      onTrack(id);
      setIndex(0);
      setPlaying(true);
    },
    [onTrack],
  );

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
    const timer = setTimeout(() => setIndex((value) => value + 1), scene.seconds * 1000);
    return () => clearTimeout(timer);
  }, [playing, position, last, scene.seconds]);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') { setPlaying(false); go(position + 1); }
      else if (event.key === 'ArrowLeft') { setPlaying(false); go(position - 1); }
      else if (event.key === ' ') { event.preventDefault(); setPlaying((value) => !value); }
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [position, go, onClose]);

  const Scene = SCENES[scene.id] ?? SceneStart;
  const total = tutorialSeconds(scenes);

  return (
    <div className="tut-backdrop" role="dialog" aria-modal="true" aria-label="How this works">
      <figure className="tut">
        <div className="tut-tracks">
          {TRACKS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === current.id ? 'tut-chip tut-chip-on' : 'tut-chip'}
              aria-current={entry.id === current.id}
              onClick={() => switchTo(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          <span className="tut-blurb">{current.blurb}</span>
          <button ref={closeButton} type="button" className="tut-close" onClick={onClose} aria-label="Close walkthrough">
            ✕
          </button>
        </div>

        <div className="tut-rail">
          {scenes.map((entry, at) => (
            <button
              key={entry.id}
              type="button"
              className="tut-rail-seg"
              aria-label={`${entry.chapter}: ${entry.title}`}
              aria-current={at === position}
              onClick={() => { setPlaying(false); go(at); }}
            >
              <span
                className={at < position ? 'tut-rail-fill tut-rail-done' : 'tut-rail-fill'}
                style={
                  at === position
                    ? { animationDuration: `${entry.seconds}s`, animationPlayState: playing ? 'running' : 'paused' }
                    : undefined
                }
                data-live={at === position || undefined}
              />
            </button>
          ))}
        </div>

        <div className="tut-head">
          <span className="tut-chapter">{scene.chapter}</span>
          <span className="tut-runtime">
            {position + 1} / {scenes.length} · about {Math.round(total / 5) * 5}s in full
          </span>
        </div>

        {/* Keyed by track and scene: remounting is what restarts every CSS animation. */}
        <div className="tut-stage" key={`${current.id}-${scene.id}`}>
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
          <button type="button" className="ghost" onClick={() => { setPlaying(false); go(position - 1); }} disabled={position === 0}>
            ‹ Back
          </button>
          <button type="button" className="ghost" onClick={() => setPlaying((value) => !value)}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          {!last ? (
            <button type="button" className="ghost" onClick={() => { setPlaying(false); go(position + 1); }}>
              Next ›
            </button>
          ) : nextTrack ? (
            <button type="button" className="primary" onClick={() => switchTo(nextTrack.id)}>
              Next: {nextTrack.label} ›
            </button>
          ) : (
            <button type="button" className="primary" onClick={onClose}>
              Start making icons
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
