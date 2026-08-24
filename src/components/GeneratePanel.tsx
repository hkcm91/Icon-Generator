import { useState } from 'react';
import { keyOutBackground } from '../core/compose';
import {
  MODELS,
  generate,
  glyphPrompt,
  loadImage,
  materialPrompt,
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

export default function GeneratePanel(props: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [showPrompts, setShowPrompts] = useState(false);

  const material = materialPrompt(props.materialDescription);
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
      const result = await generate(props.model, modelInput(props.model, material, props.spec.size));
      props.onMaterial(await loadImage(result.images[0]));
      setStatus({ kind: 'ok', message: 'Material applied. The silhouette did not move.' });
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
        The model supplies surface and symbol only. It is never asked for a shape.
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
          Note what is absent: no radius, no padding percentage, no shape word. Those live in the
          spec, where they can be honoured exactly.
        </p>
        <pre className="code">{material}</pre>
        <pre className="code">{glyph}</pre>
      </details>
    </section>
  );
}
