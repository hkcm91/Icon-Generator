import { useEffect, useState } from 'react';
import { keyOutBackground } from '../core/compose';
import {
  buildConditioning,
  type ConditioningMode,
} from '../core/condition';
import {
  MODELS,
  conditionedMaterialPrompt,
  generate,
  glyphPrompt,
  loadImage,
  materialPrompt,
  modelConditioning,
  modelInput,
  testConnection,
} from '../core/replicate';
import type { ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
  model: string;
  materialDescription: string;
  glyphSubject: string;
  glyphStyle: string;
  onModel: (value: string) => void;
  onMaterialDescription: (value: string) => void;
  onGlyphSubject: (value: string) => void;
  onGlyphStyle: (value: string) => void;
  onMaterial: (image: CanvasImageSource | null) => void;
  onGlyph: (image: CanvasImageSource | null) => void;
}

type Status = { kind: 'idle' } | { kind: 'busy'; what: string } | { kind: 'error'; message: string } | { kind: 'ok'; message: string };

const CONDITIONING_MODES: Array<{ value: ConditioningMode; label: string; blurb: string }> = [
  { value: 'off', label: 'Clip only', blurb: 'Model paints a free texture; code cuts the shape.' },
  {
    value: 'reference',
    label: 'Shape reference',
    blurb: 'Model is shown the silhouette and lights that object.',
  },
  {
    value: 'masked-fill',
    label: 'Masked fill',
    blurb: 'Model repaints only inside the container mask.',
  },
];

export default function GeneratePanel(props: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [showPrompts, setShowPrompts] = useState(false);
  const [mode, setMode] = useState<ConditioningMode>('reference');
  const [platePreview, setPlatePreview] = useState<string>('');

  const supports = modelConditioning(props.model);
  // Masked fill needs a model that takes a mask; everything else can still be
  // shown the silhouette as a plain reference image.
  const effectiveMode: ConditioningMode =
    supports === 'none' ? 'off' : mode === 'masked-fill' && supports !== 'inpaint' ? 'reference' : mode;

  useEffect(() => {
    let live = true;
    if (effectiveMode === 'off') {
      setPlatePreview('');
      return;
    }
    void buildConditioning(props.spec, effectiveMode).then((conditioning) => {
      if (live) setPlatePreview(conditioning.reference ?? '');
    });
    return () => {
      live = false;
    };
  }, [props.spec, effectiveMode]);

  const material =
    effectiveMode === 'off'
      ? materialPrompt(props.materialDescription)
      : conditionedMaterialPrompt(props.materialDescription);
  const glyph = glyphPrompt(props.glyphSubject, props.glyphStyle);

  const check = async () => {
    setStatus({ kind: 'busy', what: 'Testing connection' });
    try {
      setStatus({ kind: 'ok', message: `Connected as ${await testConnection()}.` });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  };

  const runMaterial = async () => {
    setStatus({ kind: 'busy', what: 'Generating material' });
    try {
      const conditioning = await buildConditioning(props.spec, effectiveMode);
      const result = await generate(
        props.model,
        modelInput(props.model, material, props.spec.size, [], conditioning),
      );
      props.onMaterial(await loadImage(result.images[0]));
      setStatus({
        kind: 'ok',
        message:
          effectiveMode === 'off'
            ? 'Material applied and clipped to the exact path.'
            : 'Material applied. The model was shown the silhouette, and the result was clipped to it anyway.',
      });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  };

  const runGlyph = async () => {
    setStatus({ kind: 'busy', what: 'Generating glyph' });
    try {
      const result = await generate(props.model, modelInput(props.model, glyph, props.spec.size));
      const image = await loadImage(result.images[0]);
      // Models routinely ignore "transparent background", so the flat chroma
      // field requested in the prompt is keyed out here instead.
      props.onGlyph(keyOutBackground(image, props.spec.size));
      setStatus({ kind: 'ok', message: 'Glyph applied and clipped to the safe area.' });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  };

  const busy = status.kind === 'busy';

  return (
    <section className="panel">
      <h2>Generate</h2>
      <p className="hint">
        The model supplies surface and symbol. Geometry reaches it as an image it can see, never
        as a number it would have to interpret — and the result is clipped to the exact path
        either way.
      </p>

      <label className="field">
        <span className="field-label">Model</span>
        <select value={props.model} onChange={(event) => props.onModel(event.target.value)}>
          {MODELS.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Shape conditioning</span>
        <select
          value={mode}
          disabled={supports === 'none'}
          onChange={(event) => setMode(event.target.value as ConditioningMode)}
        >
          {CONDITIONING_MODES.map((entry) => (
            <option
              key={entry.value}
              value={entry.value}
              disabled={entry.value === 'masked-fill' && supports !== 'inpaint'}
            >
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {CONDITIONING_MODES.find((entry) => entry.value === effectiveMode)?.blurb}
        {mode === 'masked-fill' && supports !== 'inpaint' && (
          <span className="status-error"> This model takes no mask — using shape reference.</span>
        )}
      </p>

      {platePreview && (
        <div className="plate">
          <img src={platePreview} alt="Conditioning plate sent to the model" />
          <span>Sent to the model as the shape reference</span>
        </div>
      )}

      <label className="field">
        <span className="field-label">Material</span>
        <textarea
          rows={2}
          value={props.materialDescription}
          onChange={(event) => props.onMaterialDescription(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">Glyph subject</span>
        <input value={props.glyphSubject} onChange={(event) => props.onGlyphSubject(event.target.value)} />
      </label>

      <label className="field">
        <span className="field-label">Glyph style</span>
        <input value={props.glyphStyle} onChange={(event) => props.onGlyphStyle(event.target.value)} />
      </label>

      <div className="row">
        <button type="button" onClick={runMaterial} disabled={busy}>
          Generate material
        </button>
        <button type="button" onClick={runGlyph} disabled={busy}>
          Generate glyph
        </button>
      </div>
      <div className="row">
        <button type="button" className="ghost" onClick={check} disabled={busy}>
          Test connection
        </button>
        <button type="button" className="ghost" onClick={() => { props.onMaterial(null); props.onGlyph(null); }}>
          Clear layers
        </button>
      </div>

      {status.kind === 'busy' && <p className="status status-busy">{status.what}…</p>}
      {status.kind === 'error' && <p className="status status-error">{status.message}</p>}
      {status.kind === 'ok' && <p className="status status-ok">{status.message}</p>}

      <details open={showPrompts} onToggle={(event) => setShowPrompts((event.target as HTMLDetailsElement).open)}>
        <summary>Prompts actually sent</summary>
        <p className="hint">
          Note what is absent even here: no radius, no padding percentage, no shape word. The
          geometry travels as an <em>image</em> the model can see, never as a number it would have
          to interpret — and the result is clipped to the exact path regardless.
        </p>
        <pre className="code">{material}</pre>
        <pre className="code">{glyph}</pre>
      </details>
    </section>
  );
}
