import { useEffect, useRef, useState } from 'react';
import { generateSheet, parseSheetNames, SHEET_MODEL, splitSheet, type SheetRequest, type SheetResult } from '../core/iconSheet';
import { blobBytes, buildZip, download } from '../core/export';
import { getValue, putValue, PROJECTS } from '../core/store';

const RESULT_KEY = 'transparent-sheet:last-result';
const PENDING_KEY = 'icon-generator-pending-sheet-v1';
const EXAMPLES = ['Phone', 'Messages', 'Camera', 'Photos', 'Settings', 'Music', 'Mail', 'Calendar', 'Clock', 'Browser', 'Maps', 'Weather', 'Notes', 'Books', 'Calculator', 'Files', 'Shopping', 'Fitness', 'Contacts', 'Home'];
interface Pending { request: SheetRequest; id: string }
function readPending(): Pending | null {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}

export default function IconSheetPanel({ familyStyle, reference, subjects }: {
  familyStyle: string; reference?: string; subjects: string[];
}) {
  const [names, setNames] = useState(EXAMPLES.slice(0, 10).join('\n'));
  const [style, setStyle] = useState('Polished colorful 3D icons, rounded forms, consistent materials and lighting');
  const [quality, setQuality] = useState<SheetRequest['quality']>('medium');
  const [useReference, setUseReference] = useState(false);
  const [result, setResult] = useState<SheetResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(readPending);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [backdrop, setBackdrop] = useState('dark');
  const running = useRef(false);
  const parsed = parseSheetNames(names);
  const valid = parsed.length >= 10 && parsed.length <= 20 && !!style.trim();

  useEffect(() => {
    let alive = true;
    void getValue<SheetResult>(PROJECTS, RESULT_KEY).then(saved => {
      if (alive) { if (saved) setResult(saved); setLoaded(true); }
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!result) return;
    const url = URL.createObjectURL(result.png); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  async function run(resume?: Pending) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    setMessage(resume ? 'Retrieving your existing prediction…' : 'Generating the whole sheet in one request…');
    const request: SheetRequest = resume?.request ?? { names: parsed, style, quality, ...(useReference && reference ? { reference } : {}) };
    try {
      const sheet = await generateSheet(request, id => {
        const next = { request, id }; setPending(next);
        // Keep reference bytes out of localStorage; the resume path only polls.
        try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...next, request: { ...request, reference: undefined } })); } catch { /* session remains usable */ }
      }, resume?.id);
      setResult(sheet);
      const saved = await putValue(PROJECTS, RESULT_KEY, sheet);
      setPending(null);
      try { localStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
      setMessage(`Verified transparent background and clear cell boundaries for ${sheet.request.names.length} cells. Check the artwork and edges below.${saved === null ? ' Browser storage is unavailable; download before closing.' : ' Latest sheet saved in this browser.'}`);
    } catch (cause) {
      setError((cause as Error).message);
      setMessage('');
    } finally { running.current = false; setBusy(false); }
  }

  async function downloadIcons() {
    if (!result || running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const icons = await splitSheet(result);
      const files = await Promise.all(icons.map(async icon => ({ name: icon.name, bytes: await blobBytes(icon.blob) })));
      files.push({ name: 'sheet.png', bytes: await blobBytes(result.png) });
      files.push({ name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify({
        model: SHEET_MODEL, predictionId: result.predictionId, ...result.request,
        reference: result.request.reference ? 'Style reference supplied' : undefined,
        width: result.width, height: result.height, columns: 5, rows: Math.ceil(result.request.names.length / 5),
        files: icons.map(icon => icon.name),
      }, null, 2)) });
      download(buildZip(files), `transparent-icons-${icons.length}.zip`);
    } catch (cause) { setError((cause as Error).message); }
    finally { running.current = false; setBusy(false); }
  }

  return <details className="icon-sheet-panel">
    <summary><strong>Generate an icon sheet</strong><span>10–20 icons · transparent PNG</span></summary>
    <div className="icon-sheet-body">
      <p>Create the whole set in one image with GPT Image 2 on Replicate. Uses your connected API key.</p>
      <fieldset disabled={busy || !loaded}>
        <div className="icon-sheet-presets">
          {[10, 15, 20].map(count => <button key={count} type="button" onClick={() => setNames(EXAMPLES.slice(0, count).join('\n'))}>{count} sample subjects</button>)}
          {subjects.length >= 10 && subjects.length <= 20 && <button type="button" onClick={() => setNames(subjects.join('\n'))}>Use selected family subjects</button>}
        </div>
        <label className="field"><span className="field-label">Icon subjects — one per line ({parsed.length}/20)</span>
          <textarea aria-label="Sheet icon subjects" rows={8} value={names} onChange={e => setNames(e.target.value)} />
        </label>
        <label className="field"><span className="field-label">Shared style</span>
          <textarea aria-label="Sheet shared style" rows={3} value={style} maxLength={4000} onChange={e => setStyle(e.target.value)} />
        </label>
        {familyStyle.trim() && <button type="button" onClick={() => setStyle(familyStyle)}>Use family style</button>}
        <div className="icon-sheet-options">
          <label className="field"><span className="field-label">Sheet quality</span><select value={quality} onChange={e => setQuality(e.target.value as SheetRequest['quality'])}>
            <option value="low">Low — draft</option><option value="medium">Medium</option><option value="high">High — detailed</option>
          </select></label>
          {reference && <label><input type="checkbox" checked={useReference} onChange={e => setUseReference(e.target.checked)} /> Use master as style reference</label>}
        </div>
        <p className="hint">One paid output per click, with all {parsed.length} icons sharing its resolution. PNG + native alpha requested; opaque results are rejected. No color deletion.</p>
        <button className="primary" type="button" disabled={!valid} onClick={() => void run()}>Generate transparent sheet</button>
      </fieldset>
      {pending && <div className="icon-sheet-pending">
        <span>Prediction {pending.id}</span>
        <button type="button" disabled={busy} onClick={() => void run(pending)}>Retrieve existing result (no new generation)</button>
      </div>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="icon-sheet-error">{error}</p>}
      {result && preview && <div className="icon-sheet-result">
        <p><strong>Last verified sheet:</strong> {result.request.names.length} cells · {result.width} × {result.height}px · {Math.round(result.transparentFraction * 100)}% fully transparent pixels</p>
        <label className="field"><span className="field-label">Inspect edges against</span>
          <select aria-label="Sheet preview background" value={backdrop} onChange={e => setBackdrop(e.target.value)}>
            <option value="dark">Black</option><option value="light">White</option><option value="pink">Bright pink</option><option value="checker">Checkerboard</option>
          </select>
        </label>
        <div className={`icon-sheet-preview icon-sheet-${backdrop}`}><img src={preview} alt={`Generated sheet of ${result.request.names.join(', ')}`} /></div>
        <p className="hint">Check subject order, count, and edge quality before using the set. Preview colors are not included in downloads. Individual PNGs are cropped at the original resolution.</p>
        <div className="icon-sheet-presets">
          <button type="button" onClick={() => download(result.png, `transparent-sheet-${result.request.names.length}.png`)}>Download sheet PNG</button>
          <button type="button" disabled={busy} onClick={() => void downloadIcons()}>Download individual PNGs + sheet ZIP</button>
        </div>
      </div>}
    </div>
  </details>;
}
