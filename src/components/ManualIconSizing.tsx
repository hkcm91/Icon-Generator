import DeferredDetails from './DeferredDetails';
import type { IconItem } from '../core/library';

export default function ManualIconSizing({ item, disabled, onChange }: {
  item: IconItem; disabled: boolean; onChange: (patch: Partial<IconItem>) => void;
}) {
  const percent = Math.round((item.opticalScale ?? 1) * 100);
  const update = (patch: Partial<IconItem>) => onChange({ ...patch, manualSizing: true, approved: false });
  const size = (value: number) => {
    if (Number.isFinite(value)) update({ opticalScale: Math.min(200, Math.max(25, value)) / 100 });
  };
  return <DeferredDetails className="manual-icon-sizing" summary={`Adjust size${item.manualSizing ? ' · manual' : ''}`}>
    <fieldset disabled={disabled}>
      <label>Size · {percent}%
        <input aria-label={`${item.name} size slider`} type="range" min={25} max={200} step={1}
          value={percent} onChange={event => size(Number(event.target.value))} />
      </label>
      <div className="manual-size-row">
        <button type="button" aria-label={`Make ${item.name} smaller`} onClick={() => size(percent - 5)}>−</button>
        <input aria-label={`${item.name} size percent`} type="number" min={25} max={200} step={1}
          value={percent} onChange={event => { if (event.target.value !== '') size(event.target.valueAsNumber); }} />
        <span>%</span>
        <button type="button" aria-label={`Make ${item.name} larger`} onClick={() => size(percent + 5)}>+</button>
      </div>
      <label>Left / right
        <input aria-label={`${item.name} horizontal position`} type="range" min={-25} max={25} step={1}
          value={item.opticalOffsetX ?? 0} onChange={event => update({ opticalOffsetX: Number(event.target.value) })} />
      </label>
      <label>Up / down
        <input aria-label={`${item.name} vertical position`} type="range" min={-25} max={25} step={1}
          value={item.opticalOffsetY ?? 0} onChange={event => update({ opticalOffsetY: Number(event.target.value) })} />
      </label>
      <button type="button" className="ghost tiny" onClick={() => update({ opticalScale: 1, opticalOffsetX: 0, opticalOffsetY: 0 })}>Reset size & position</button>
      {item.manualSizing && <button type="button" className="ghost tiny" onClick={() => onChange({ manualSizing: false })}>Allow automatic sizing</button>}
      <small>Live preview · used in exports · no generation. Manual choices are kept during automatic sizing.</small>
    </fieldset>
  </DeferredDetails>;
}
