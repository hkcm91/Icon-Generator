import { useEffect, useState } from 'react';
import { renderTransparentLayer, type ComposeOptions } from '../core/compose';
import { innerBox } from '../core/geometry';
import { measureAlpha, solveMeasuredSize, type SizeMetric } from '../core/measuredSizing';
import type { IconItem } from '../core/library';
import type { ContainerSpec } from '../core/spec';

interface Props {
  items: IconItem[];
  eligible: IconItem[];
  glyphs: Map<string, CanvasImageSource>;
  spec: ContainerSpec;
  compose: ComposeOptions;
  disabled: boolean;
  onItems: (items: IconItem[]) => void;
}
type Row = { item: IconItem; scale: number; before: string; after: string; width: number; height: number; coverage: number; limited: boolean };

export default function MeasuredIconSizing(props: Props) {
  const [metric, setMetric] = useState<SizeMetric>('longest');
  const [target, setTarget] = useState(50);
  const [margin, setMargin] = useState(10);
  const [includeManual, setIncludeManual] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [undo, setUndo] = useState<Row[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => setRows([]), [props.items, props.spec, props.compose, props.glyphs, metric, target, margin, includeManual]);
  const size = props.spec.size;
  const render = (item: IconItem, scale = item.opticalScale ?? 1, center = false) => renderTransparentLayer(props.spec, props.glyphs.get(item.id), {
    ...props.compose, glyphScale: props.compose.glyphScale * scale,
    glyphOffsetX: center ? 0 : item.opticalOffsetX ?? 0, glyphOffsetY: center ? 0 : item.opticalOffsetY ?? 0,
  });
  const thumbnail = (canvas: HTMLCanvasElement) => {
    const small = document.createElement('canvas'); small.width = small.height = 128;
    small.getContext('2d')!.drawImage(canvas, 0, 0, 128, 128);
    return small.toDataURL();
  };
  const measure = (canvas: HTMLCanvasElement) => measureAlpha(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  function preview() {
    try {
      const plan: Row[] = [];
      let skipped = 0;
      for (const item of props.eligible.filter(item => includeManual || !item.manualSizing)) {
        const image = props.glyphs.get(item.id)!;
        const source = document.createElement('canvas');
        source.width = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width;
        source.height = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height;
        source.getContext('2d')!.drawImage(image, 0, 0);
        const alpha = measure(source);
        const result = alpha && solveMeasuredSize(alpha, size,
          innerBox(props.spec).edge * (1 - props.spec.glyphInset / 100) * props.compose.glyphScale, metric, target, margin);
        if (!result) { skipped++; continue; }
        const after = render(item, result.scale, true);
        const measured = measure(after);
        if (!measured) { skipped++; continue; }
        plan.push({ item, scale: result.scale, before: thumbnail(render(item)), after: thumbnail(after),
          width: measured.width, height: measured.height, coverage: measured.mass / size ** 2 * 100, limited: result.limited });
      }
      setRows(plan);
      setMessage(`${plan.length} icons measured${skipped ? ` · ${skipped} empty or unavailable` : ''}. ${plan.length ? 'Review the grid, then apply.' : 'Select ready transparent icons, or include manual sizes.'}`);
    } catch (error) { setRows([]); setMessage(`Unable to measure icons: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return <details className="measured-sizing">
    <summary>Precise sizing · measured grid</summary>
    <p>Measure visible artwork on the {size} × {size} canvas. Uniform scaling preserves proportions. Applying centers each icon and saves a manual size.</p>
    <div className="measured-controls">
      <label>Match <select value={metric} onChange={e => { setMetric(e.target.value as SizeMetric); setTarget(e.target.value === 'coverage' ? 20 : 50); }}>
        <option value="longest">Longest visible edge</option><option value="width">Visible width</option><option value="height">Visible height</option><option value="coverage">Alpha-weighted area</option>
      </select></label>
      <label>Target (% of canvas{metric === 'coverage' ? ' area' : ''}) <input type="number" min={1} max={100} step={.1} value={target} onChange={e => setTarget(Number(e.target.value))} /></label>
      <label>Minimum margin (%) <input type="number" min={0} max={40} value={margin} onChange={e => setMargin(Number(e.target.value))} /></label>
      <label>Match reference <select defaultValue="" onChange={e => {
        const item = props.items.find(item => item.id === e.target.value); if (!item) return;
        const measured = measure(render(item)); if (!measured) return;
        setTarget(Number((metric === 'coverage' ? measured.mass / size ** 2 * 100 :
          (metric === 'width' ? measured.width : metric === 'height' ? measured.height : Math.max(measured.width, measured.height)) / size * 100).toFixed(3)));
        e.target.value = '';
      }}><option value="">Copy a reference's measurement…</option>{props.items.filter(item => item.status === 'ready' && item.outputMode === 'transparent' && props.glyphs.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><input type="checkbox" checked={includeManual} onChange={e => setIncludeManual(e.target.checked)} /> Include icons with manual sizes</label>
    </div>
    <p className="hint">{metric === 'coverage' ? 'Area uses the sum of pixel opacity. Scale = √(target area / source area). Thin shapes may reach the margin limit first.' : `Target: ${(target / 100 * size).toFixed(1)} px. Scale = target edge / source edge.`} All nonzero alpha counts, including faint edges. Pixel rounding can differ by about 1 px. Equal measured size does not guarantee equal perceived weight.</p>
    <button type="button" disabled={props.disabled || !Number.isFinite(target) || target <= 0 || target > 100 || !Number.isFinite(margin) || margin < 0 || margin > 40} onClick={preview}>Measure selected icons & preview</button>
    <p role="status">{message}</p>
    {rows.length > 0 && <>
      <div className="measured-grid">{rows.map(row => <figure key={row.item.id}>
        <figcaption>{row.item.name}</figcaption>
        <div className="measured-pair"><div><img src={row.before} alt={`${row.item.name} before`} /><small>Before</small></div><div><img src={row.after} alt={`${row.item.name} measured preview`} /><small>After</small></div></div>
        <small>{row.width} × {row.height} px · {row.coverage.toFixed(2)}% area<br />Scale {(row.scale * 100).toFixed(2)}%{row.limited && ' · target limited by margin or scale range'}</small>
      </figure>)}</div>
      <button type="button" disabled={props.disabled} onClick={() => {
        const changes = rows.filter(row => props.items.find(item => item.id === row.item.id) === row.item);
        props.onItems(props.items.map(item => changes.some(row => row.item.id === item.id) ? {
          ...item, opticalScale: changes.find(row => row.item.id === item.id)!.scale, opticalOffsetX: 0, opticalOffsetY: 0, manualSizing: true, approved: false,
        } : item));
        setUndo(changes); setRows([]); setMessage(`Applied measured sizing to ${changes.length} icons. Save your set to keep it.`);
      }}>Apply measured sizes to {rows.length} icons</button>
      <button type="button" className="ghost" onClick={() => setRows([])}>Cancel preview</button>
    </>}
    {undo.length > 0 && <button type="button" className="ghost" disabled={props.disabled} onClick={() => {
      let restored = 0;
      props.onItems(props.items.map(item => {
        const row = undo.find(row => row.item.id === item.id && (row.item.activeRevision ?? row.item.revision) === (item.activeRevision ?? item.revision) && item.opticalScale === row.scale && item.opticalOffsetX === 0 && item.opticalOffsetY === 0 && item.manualSizing && !item.approved);
        if (!row) return item; restored++;
        return { ...item, opticalScale: row.item.opticalScale, opticalOffsetX: row.item.opticalOffsetX, opticalOffsetY: row.item.opticalOffsetY, manualSizing: row.item.manualSizing, approved: row.item.approved };
      })); setUndo([]); setMessage(`Restored ${restored} icons. Later edits were kept.`);
    }}>Undo measured sizing</button>}
  </details>;
}
