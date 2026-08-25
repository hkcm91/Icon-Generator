import { useEffect, useRef, useState } from 'react';
import { cleanGeneratedAlpha, hasNativeAlpha, keyOutBackground } from '../core/compose';
import {
  buildConditioning,
  type ConditioningMode,
} from '../core/condition';
import {
  MODELS,
  completeIconPrompt,
  conditionedMaterialPrompt,
  generateImage,
  glyphPrompt,
  loadImage,
  materialPrompt,
  modelConditioning,
  modelInput,
  modelSupportsAlpha,
  resumeGeneration,
  testConnection,
  type GenerateResult,
} from '../core/replicate';
import type { ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
  model: string;
  quality: 'low' | 'medium' | 'high';
  onQuality: (value: 'low' | 'medium' | 'high') => void;
  wantAlpha: boolean;
  onWantAlpha: (value: boolean) => void;
  master?: string | null;
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

const PENDING_ADVANCED_KEY = 'icon-generator-pending-advanced-v1';
type PendingAdvanced = {
  id: string;
  kind: 'material' | 'glyph' | 'complete';
  alphaRequested: boolean;
};

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
  const resumedPending = useRef(false);
  const alphaCapable = modelSupportsAlpha(props.model);
  const completeMode = props.model === 'openai/gpt-image-2' && !props.wantAlpha;
  const selectedModel = props.model === 'openai/gpt-image-2'
    ? `${props.model}#${props.quality}`
    : props.model;

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
  const useNativeAlpha = alphaCapable && props.wantAlpha;
  const glyph = completeMode
    ? completeIconPrompt(props.glyphSubject, props.materialDescription, Boolean(props.master))
    : glyphPrompt(props.glyphSubject, props.glyphStyle, useNativeAlpha);

  const forgetPending = () => {
    try { localStorage.removeItem(PENDING_ADVANCED_KEY); } catch { /* private storage */ }
  };

  const rememberPending = (kind: PendingAdvanced['kind'], alphaRequested: boolean) => (id: string) => {
    try {
      localStorage.setItem(PENDING_ADVANCED_KEY, JSON.stringify({ id, kind, alphaRequested }));
    } catch { /* private storage */ }
  };

  const applyFinished = async (
    pending: Pick<PendingAdvanced, 'kind' | 'alphaRequested'>,
    result: GenerateResult,
  ) => {
    const image = await loadImage(result.images[0]);
    if (pending.kind === 'material') {
      props.onMaterial(image);
      return 'Material result recovered and applied.';
    }
    if (pending.kind === 'complete') {
      props.onMaterial(image);
      props.onGlyph(null);
      return 'Complete opaque icon recovered and applied.';
    }
    const native = pending.alphaRequested && hasNativeAlpha(image);
    props.onGlyph(native ? cleanGeneratedAlpha(image, props.spec.size) : keyOutBackground(image, props.spec.size));
    return native ? 'Transparent glyph result recovered and applied.' : 'Glyph result recovered and applied.';
  };

  useEffect(() => {
    if (resumedPending.current) return;
    resumedPending.current = true;
    let pending: PendingAdvanced | null = null;
    try {
      const raw = localStorage.getItem(PENDING_ADVANCED_KEY);
      pending = raw ? JSON.parse(raw) as PendingAdvanced : null;
    } catch { pending = null; }
    if (!pending || !/^[A-Za-z0-9]+$/.test(pending.id)) return;

    let live = true;
    setStatus({ kind: 'busy', what: 'Recovering the generation started before refresh' });
    void resumeGeneration(pending.id)
      .then((result) => applyFinished(pending!, result))
      .then((message) => {
        forgetPending();
        if (live) setStatus({ kind: 'ok', message });
      })
      .catch((error) => {
        if (live) setStatus({ kind: 'error', message: `Could not recover prediction ${pending!.id}: ${(error as Error).message}` });
      });
    return () => { live = false; };
  // Recovery is intentionally one-shot for the mounted advanced panel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const result = await generateImage(
        props.model,
        modelInput(props.model, material, props.spec.size, [], conditioning, false, props.quality),
        rememberPending('material', false),
      );
      props.onMaterial(await loadImage(result.images[0]));
      forgetPending();
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
    setStatus({ kind: 'busy', what: completeMode ? 'Generating complete icon' : 'Generating glyph' });
    try {
      const conditioning = completeMode ? await buildConditioning(props.spec, effectiveMode) : undefined;
      // The glyph is deliberately never shape-conditioned: showing it the
      // container silhouette is an invitation to draw a container.
      const result = await generateImage(
        props.model,
        modelInput(
          props.model,
          glyph,
          props.spec.size,
          props.master ? [props.master] : [],
          conditioning,
          useNativeAlpha,
          props.quality,
        ),
        rememberPending(completeMode ? 'complete' : 'glyph', useNativeAlpha),
      );
      const image = await loadImage(result.images[0]);

      if (completeMode) {
        props.onMaterial(image);
        props.onGlyph(null);
        forgetPending();
        setStatus({ kind: 'ok', message: 'Complete opaque icon generated with its container.' });
        return;
      }

      // Prefer a real alpha channel when one actually came back; fall back to
      // keying the flat chroma field the prompt asked for otherwise.
      const native = result.alphaAccepted && hasNativeAlpha(image);
      props.onGlyph(
        native
          ? cleanGeneratedAlpha(image, props.spec.size)
          : keyOutBackground(image, props.spec.size),
      );
      forgetPending();

      setStatus({
        kind: 'ok',
        message: native
          ? 'Glyph applied using the model alpha channel, de-fringed and snapped to solid.'
          : result.alphaRequested
            ? 'Transparency was refused or ignored, so the glyph was chroma-keyed instead.'
            : 'Glyph applied and clipped to the safe area.',
      });
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
        <select value={selectedModel} onChange={(event) => {
          const [model, quality] = event.target.value.split('#');
          props.onModel(model);
          if (model === 'openai/gpt-image-2' && (quality === 'low' || quality === 'medium' || quality === 'high')) {
            props.onQuality(quality);
          }
        }}>
          <option value="openai/gpt-image-2#low">GPT Image 2 · Low — ~$0.012</option>
          <option value="openai/gpt-image-2#medium">GPT Image 2 · Medium — ~$0.047</option>
          <option value="openai/gpt-image-2#high">GPT Image 2 · High — ~$0.128</option>
          {MODELS.filter((entry) => entry.slug !== 'openai/gpt-image-2').map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label className="toggle toggle-row">
        <input
          type="checkbox"
          checked={props.wantAlpha && alphaCapable}
          disabled={!alphaCapable}
          onChange={(event) => props.onWantAlpha(event.target.checked)}
        />
        Request a real alpha channel
      </label>
      <p className="hint">
        {alphaCapable
          ? props.wantAlpha
            ? 'Transparent glyph mode. The request uses native alpha and excludes a container.'
            : 'Complete icon mode. The request is opaque and includes the container and symbol together.'
          : 'This model has no transparent-background parameter; glyphs are chroma-keyed.'}
      </p>

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
          {completeMode ? 'Generate complete icon' : 'Generate glyph'}
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
