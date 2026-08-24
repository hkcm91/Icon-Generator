import { SUPERELLIPSE_PRESETS, serializeSpec, type ContainerSpec, type ShapeKind } from '../core/spec';
import { effectiveCornerRadius } from '../core/geometry';

interface Props {
  spec: ContainerSpec;
  onChange: (patch: Partial<ContainerSpec>) => void;
}

const SHAPES: Array<{ value: ShapeKind; label: string }> = [
  { value: 'superellipse', label: 'Superellipse' },
  { value: 'rounded-rect', label: 'Rounded rect' },
  { value: 'circle', label: 'Circle' },
  { value: 'custom-path', label: 'Custom path' },
];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <b>
          {value}
          {suffix}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function SpecPanel({ spec, onChange }: Props) {
  const radius = effectiveCornerRadius(spec);

  return (
    <section className="panel">
      <h2>Container spec</h2>
      <p className="hint">
        These numbers are compiled to an exact path. They are never sent to the model as text.
      </p>

      <label className="field">
        <span className="field-label">Shape</span>
        <select value={spec.shape} onChange={(event) => onChange({ shape: event.target.value as ShapeKind })}>
          {SHAPES.map((shape) => (
            <option key={shape.value} value={shape.value}>
              {shape.label}
            </option>
          ))}
        </select>
      </label>

      {spec.shape === 'superellipse' && (
        <>
          <Slider
            label="Exponent (n)"
            value={spec.exponent}
            min={2}
            max={20}
            step={0.1}
            onChange={(exponent) => onChange({ exponent })}
          />
          <div className="chips">
            {Object.entries(SUPERELLIPSE_PRESETS).map(([name, value]) => (
              <button
                key={name}
                type="button"
                className={spec.exponent === value ? 'chip chip-on' : 'chip'}
                onClick={() => onChange({ exponent: value })}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}

      {(spec.shape === 'rounded-rect' || spec.shape === 'custom-path') && (
        <Slider
          label="Corner radius"
          value={spec.radius}
          min={0}
          max={50}
          step={0.5}
          suffix="%"
          onChange={(value) => onChange({ radius: value })}
        />
      )}

      {spec.shape === 'custom-path' && (
        <label className="field">
          <span className="field-label">Path data (0–1000 viewBox)</span>
          <textarea
            rows={4}
            spellCheck={false}
            placeholder="M 500 0 L 1000 500 L 500 1000 L 0 500 Z"
            value={spec.customPath}
            onChange={(event) => onChange({ customPath: event.target.value })}
          />
        </label>
      )}

      <Slider
        label="Optical padding"
        value={spec.padding}
        min={0}
        max={25}
        step={0.5}
        suffix="%"
        onChange={(padding) => onChange({ padding })}
      />
      <Slider
        label="Glyph safe inset"
        value={spec.glyphInset}
        min={0}
        max={40}
        step={0.5}
        suffix="%"
        onChange={(glyphInset) => onChange({ glyphInset })}
      />
      <Slider
        label="Canvas size"
        value={spec.size}
        min={128}
        max={2048}
        step={64}
        suffix="px"
        onChange={(size) => onChange({ size })}
      />
      <Slider
        label="Curve segments"
        value={spec.segments}
        min={16}
        max={256}
        step={8}
        onChange={(segments) => onChange({ segments })}
      />

      <div className="readout">
        <span>Effective corner radius</span>
        <b>{Number.isNaN(radius) ? '—' : `${radius.toFixed(2)} px`}</b>
      </div>

      <details>
        <summary>Spec JSON</summary>
        <pre className="code">{serializeSpec(spec)}</pre>
      </details>
    </section>
  );
}
