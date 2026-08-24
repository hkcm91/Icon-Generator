/**
 * Capture the app's UI for documentation.
 *
 * Synthesises a batch of container PNGs with deliberately drifting corner
 * radii, feeds them through the Measure panel, and captures each surface.
 * Run against a built preview server: `npm run build && npx vite preview`.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

// Override with SHOT_OUT; defaults to docs/screenshots next to this script.
const OUT = process.env.SHOT_OUT ?? new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const URL = 'http://127.0.0.1:4173/';

const browser = await chromium.launch({
  // Set PW_CHROMIUM when the sandbox ships a pinned browser build.
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});
const page = await browser.newPage({
  viewport: { width: 1700, height: 1150 },
  deviceScaleFactor: 2,
});

// --- 1. Synthesise a batch of "drifting" container PNGs in-page -------------
// Circular-arc corners at radii that wander run to run, which is the failure
// mode being measured. One is rendered opaque to exercise the keying path.
const specs = [
  { name: 'container-run-01.png', radius: 92, opaque: false },
  { name: 'container-run-02.png', radius: 104, opaque: false },
  { name: 'container-run-03.png', radius: 88, opaque: false },
  { name: 'container-run-04.png', radius: 111, opaque: false },
  { name: 'container-run-05.png', radius: 97, opaque: true },
];

await page.goto('about:blank');
const dataUrls = await page.evaluate((list) => {
  return list.map(({ radius, opaque }) => {
    const size = 512;
    const edge = 400;
    const origin = (size - edge) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (opaque) {
      ctx.fillStyle = '#3c3c3c';
      ctx.fillRect(0, 0, size, size);
    }
    ctx.fillStyle = '#e8ecf5';
    ctx.beginPath();
    ctx.roundRect(origin, origin, edge, edge, radius);
    ctx.fill();
    return canvas.toDataURL('image/png');
  });
}, specs);

const files = specs.map((spec, index) => ({
  name: spec.name,
  mimeType: 'image/png',
  buffer: Buffer.from(dataUrls[index].split(',')[1], 'base64'),
}));

// --- 2. Load the app -------------------------------------------------------
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const shot = async (name, target = page) => {
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log('captured', name);
};

await shot('01-full-app');
await shot('07-conditioning', page.locator('.panel', { hasText: 'Shape conditioning' }));

// --- 3. Determinism check --------------------------------------------------
await page.getByRole('button', { name: 'Run 50x' }).click();
await page.waitForSelector('.verdict', { timeout: 30000 });
await page.waitForTimeout(400);
await shot('02-determinism', page.locator('.column').nth(2));

// --- 4. Feed the drifting PNGs to the estimator ----------------------------
await page.locator('.panel:has-text("Measure imported") input[type=file]').setInputFiles(files);
await page.waitForSelector('.measure-table', { timeout: 30000 });
await page.waitForTimeout(400);
await shot('03-measure', page.locator('.panel', { hasText: 'Measure imported' }));

// Capture the measured numbers as text too, so the claim is checkable.
const table = await page.locator('.measure-table').innerText();
const verdict = await page.locator('.panel', { hasText: 'Measure imported' }).locator('.verdict').innerText();
writeFileSync(`${OUT}/measured.txt`, `${verdict}\n\n${table}\n`);

// --- 4b. Trace a deliberately lopsided master ------------------------------
// Superellipse with the top-left quadrant pulled in, so the tracer has real
// asymmetry to report rather than a shape it can fit perfectly.
const masterUrl = await page.evaluate(() => {
  const size = 512;
  const a = 200;
  const c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const frame = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = (x + (sx + 0.5) / 4 - c) / a;
          const py = (y + (sy + 0.5) / 4 - c) / a;
          const k = px < 0 && py < 0 ? 0.88 : 1;
          if (Math.pow(Math.abs(px) / k, 5) + Math.pow(Math.abs(py) / k, 5) <= 1) hits++;
        }
      }
      const at = (y * size + x) * 4;
      frame.data[at] = frame.data[at + 1] = frame.data[at + 2] = 232;
      frame.data[at + 3] = Math.round((hits / 16) * 255);
    }
  }
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/png');
});

await page.locator('.panel:has-text("Trace a master") input[type=file]').setInputFiles({
  name: 'approved-master.png',
  mimeType: 'image/png',
  buffer: Buffer.from(masterUrl.split(',')[1], 'base64'),
});
await page.waitForSelector('.trace-stats', { timeout: 30000 });
await page.waitForTimeout(400);
await shot('08-trace', page.locator('.panel', { hasText: 'Trace a master' }));

const traceStats = await page.locator('.trace-stats').innerText();
writeFileSync(`${OUT}/traced.txt`, traceStats + '\n');

// --- 5. Apply a measured spec, then show the drift lab ---------------------
await page.locator('.measure-table tbody tr').nth(1).getByRole('button', { name: 'Use' }).click();
await page.waitForTimeout(500);
await shot('04-applied-spec', page.locator('.column').first());
await shot('04b-measure-applied', page.locator('.panel', { hasText: 'Measure imported' }));

// --- 6. Superellipse mode, preview + drift comparison ----------------------
await page.selectOption('.panel:has-text("Container spec") select', 'superellipse');
await page.waitForTimeout(300);
await page.locator('.chip', { hasText: 'ios-icon' }).click();
await page.locator('.panel-preview input[type=range]').first().evaluate((el) => {
  // Rim width slider: give the preview a visible analytic highlight.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '6');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(600);
await shot('05-preview-drift', page.locator('.column-center'));

await shot('06-full-app-superellipse');

await browser.close();
console.log('done');
