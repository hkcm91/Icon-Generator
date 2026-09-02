/**
 * Render the ferrofluid wallpaper: a contact sheet for looking at it, and the
 * thumbnail the Android wallpaper picker shows.
 *
 * The clock is hand-turned rather than left to requestAnimationFrame, and for
 * a reason that matters more here than it looks. Under a software rasteriser
 * in a container a frame takes however long it takes, so with the real clock
 * the simulation would advance by whatever the machine load happened to be —
 * every run would produce a different picture, and the sheet would be a
 * measurement of the machine rather than of the wallpaper. Turned by hand,
 * frame n is always simulated time n/60, and two runs agree.
 *
 *   node wallpaper/tools/render-ferrofluid.mjs
 *
 * Env:
 *   FF_OUT       where to write            (default /tmp/ferrofluid)
 *   FF_TIMES     seconds to capture        (default 6,13,20,27,34,41)
 *   FF_QUERY     extra page parameters     (default none)
 *   FF_THUMB     also write the Android thumbnail here
 *   FF_THUMB_AT  the second of simulated time to catch it at
 *   PW_CHROMIUM  a chromium binary, if Playwright cannot find its own
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..', 'ferrofluid.html');
const OUT = process.env.FF_OUT ?? '/tmp/ferrofluid';
const QUERY = process.env.FF_QUERY ?? '';
const TIMES = (process.env.FF_TIMES ?? '6,13,20,27,34,41').split(',').map(Number);
const THUMB = process.env.FF_THUMB ??
  join(HERE, '..', '..', 'android', 'app', 'src', 'main',
       'res', 'drawable-nodpi', 'ferrofluid_thumb.png');

const W = 420, H = 880, FPS = 60, DT = 1000 / FPS;

/* The thumbnail is square because the picker's tile is, and it is rendered
 * square rather than cropped out of a portrait frame: the page lays the liquid
 * along the floor of whatever shape it is given, so a square viewport puts the
 * pool where a crop would have had to go looking for it. */
const THUMB_SIZE = 192;
const THUMB_AT = Number(process.env.FF_THUMB_AT ?? 5.2);  // a moment with a crest well up

/* The page's own clock, and a seeded Math.random, so a run is reproducible.
 * Without the seed the drop jitter differs every time and no two sheets can
 * be compared. */
function harness() {
  let t = 0;
  Object.defineProperty(window, '__vt', { get: () => t, set: (v) => { t = v; } });
  performance.now = () => t;
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  let s = 0x9e37 >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* The page fades its "drag a magnet" hint out on the first motion event, over
 * half a second of *wall* time — and this harness runs the page's clock by
 * hand, so no wall time passes and the hint is still there when the shutter
 * goes. It is an instruction to a person holding a phone, not part of the
 * picture, so it is taken out of the document instead. */
const dropHint = () => document.getElementById('tap')?.remove();

/** Advance the page to `seconds`, holding the phone still and upright. */
async function runTo(page, seconds, from = 0) {
  await page.evaluate(({ n, dt }) => {
    const w = window.__wallpaper;
    for (let f = 0; f < n; f++) {
      w.motion(0, 9.81, 0, 0);
      window.__vt += dt;
      w.tick();
    }
  }, { n: Math.round((seconds - from) * FPS), dt: DT });
  return seconds;
}

mkdirSync(OUT, { recursive: true });

const html = readFileSync(PAGE);
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb',
         '--disable-background-networking', '--disable-component-update'],
});

// --- the sheet -------------------------------------------------------------
const page = await browser.newPage({
  viewport: { width: W, height: H }, deviceScaleFactor: 1,
});
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
await page.addInitScript(harness);
await page.goto(`${origin}/?${QUERY}`, { waitUntil: 'load' });
await page.evaluate(() => window.__wallpaper.drive());
await page.evaluate(dropHint);

const shots = [];
let at = 0;
for (const t of TIMES.slice().sort((a, b) => a - b)) {
  at = await runTo(page, t, at);
  shots.push(await page.screenshot());
  console.log(`t=${t}s`);
}
await page.close();

const TILE = 300;
const sheet = await browser.newPage({ viewport: { width: 16, height: 16 } });
const sheetPng = await sheet.evaluate(async ({ list, labels, tw, th }) => {
  const imgs = [];
  for (const d of list) { const im = new Image(); im.src = d; await im.decode(); imgs.push(im); }
  const c = document.createElement('canvas');
  const LABEL = 22;
  c.width = list.length * tw; c.height = th + LABEL;
  const g = c.getContext('2d');
  g.fillStyle = '#8a8a8c'; g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, i) => {
    g.drawImage(im, i * tw, LABEL, tw, th);
    g.fillStyle = '#111'; g.font = '13px ui-monospace, monospace';
    g.fillText(labels[i] + 's', i * tw + 7, 15);
  });
  return c.toDataURL('image/png');
}, {
  list: shots.map((b) => 'data:image/png;base64,' + b.toString('base64')),
  labels: TIMES.slice().sort((a, b) => a - b).map(String),
  tw: TILE, th: Math.round(TILE * H / W),
});
const sheetPath = join(OUT, 'ferrofluid-sheet.png');
writeFileSync(sheetPath, Buffer.from(sheetPng.split(',')[1], 'base64'));
console.log(`\nsheet -> ${sheetPath}`);

// --- the picker thumbnail --------------------------------------------------
const thumbPage = await browser.newPage({
  viewport: { width: THUMB_SIZE * 2, height: THUMB_SIZE * 2 }, deviceScaleFactor: 1,
});
thumbPage.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
await thumbPage.addInitScript(harness);
await thumbPage.goto(`${origin}/?${QUERY}`, { waitUntil: 'load' });
await thumbPage.evaluate(() => window.__wallpaper.drive());
await thumbPage.evaluate(dropHint);
await runTo(thumbPage, THUMB_AT);
// Rendered at twice the size and taken down to it, so the hairline highlights
// survive the resample instead of aliasing into dashes.
const big = await thumbPage.screenshot();
const thumbPng = await sheet.evaluate(async ({ src, size }) => {
  const im = new Image(); im.src = src; await im.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, size, size);
  return c.toDataURL('image/png');
}, { src: 'data:image/png;base64,' + big.toString('base64'), size: THUMB_SIZE });
writeFileSync(THUMB, Buffer.from(thumbPng.split(',')[1], 'base64'));
console.log(`thumb -> ${THUMB}`);

await browser.close();
server.close();
