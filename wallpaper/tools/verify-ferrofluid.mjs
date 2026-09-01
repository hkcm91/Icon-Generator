/**
 * Measure the ferrofluid wallpaper, and print the table that goes in
 * ../FERROFLUID.md under "Verified".
 *
 * This exists because two real defects got through a reading of the code and
 * a look at the stills. Both were the same shape: the liquid quietly stopped
 * being a liquid, in a way no error is thrown for and no single frame makes
 * obvious. A tap sent with a bad coordinate poisoned the field with NaN and
 * turned every magnet off for as long as the pole lived; two home-screen
 * swipes in a row left every drop pinned at the speed limit and still pinned
 * there ten seconds later. Neither is visible unless something is counting.
 *
 * So this counts. The one number that matters throughout is what fraction of
 * the drops are part of a body rather than flying alone — a liquid that has
 * come apart and cannot find itself again is the failure mode this whole
 * simulation is one guard away from at any time.
 *
 *   node wallpaper/tools/verify-ferrofluid.mjs
 *
 * Exits non-zero if anything regressed past a threshold, so it can be run as
 * a check and not only read.
 *
 * Env:
 *   FF_QUERY     extra page parameters
 *   PW_CHROMIUM  a chromium binary, if Playwright cannot find its own
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..', 'ferrofluid.html');
const QUERY = process.env.FF_QUERY ?? '';
const W = 420, H = 880, FPS = 60;

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

/* The page's clock and its randomness, both taken over, so a run is
 * reproducible and two runs of this file can be compared to each other. */
function harness() {
  let t = 0;
  Object.defineProperty(window, '__vt', { get: () => t, set: (v) => { t = v; } });
  window.__real = performance.now.bind(performance);
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

const errors = [];
async function open(qs = '', vp = { width: W, height: H }) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${qs || 'default'}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${qs}: ${m.text()}`); });
  await page.addInitScript(harness);
  await page.goto(`${origin}/?${QUERY}${QUERY && qs ? '&' : ''}${qs}`, { waitUntil: 'load' });
  await page.evaluate(() => window.__wallpaper.drive());
  return page;
}

/* Everything the page will not tell you from the outside. Reading its
 * module scope through eval is not pretty, but the alternative is an
 * inspection API on a wallpaper, which would be worse. */
const PROBE = `(() => {
  const n = N, D = den, R = REST, P = px, Q = py, VX = vx, VY = vy;
  let body = 0, escaped = 0, nan = 0, maxV = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) {
    if (D[i] > 0.5 * R) body++;
    if (!Number.isFinite(P[i]) || !Number.isFinite(Q[i])) { nan++; continue; }
    if (P[i] < -2 || Q[i] < -2 || P[i] > innerWidth + 2 || Q[i] > innerHeight + 2) escaped++;
    maxV = Math.max(maxV, Math.hypot(VX[i], VY[i]));
    x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]);
    y0 = Math.min(y0, Q[i]); y1 = Math.max(y1, Q[i]);
  }
  return { n, bodyPct: Math.round(100 * body / n), escaped, nan,
           maxV: Math.round(maxV), bbox: [x0|0, y0|0, x1|0, y1|0],
           spacing: +spacing.toFixed(1) };
})()`;
const probe = (page) => page.evaluate(PROBE);

/** Run `seconds` of simulated time under a motion script. */
const drive = (page, seconds, script = 'idle', fps = FPS) => page.evaluate(
  ({ seconds, script, fps }) => {
    const w = window.__wallpaper, dt = 1000 / fps, G = 9.81;
    for (let f = 0; f < Math.round(seconds * fps); f++) {
      const t = f / fps;
      let tilt = 0, sx = 0, sy = 0, spin = 0;
      if (script === 'tilt') tilt = Math.min(1, t / 2) * 0.9;
      if (script === 'flat') {
        // Face up on a desk: all of gravity is out of the screen's plane.
        w.motion(0, 0, 9.81, 0); window.__vt += dt; w.tick(); continue;
      }
      if (script === 'shake' && t > 1 && t < 3) {
        sx = 32 * Math.sin((t - 1) * 34);
        sy = 26 * Math.sin((t - 1) * 23 + 1.1);
        spin = 250 * Math.sin((t - 1) * 14);
      }
      w.motion(-G * Math.sin(tilt) + sx, G * Math.cos(tilt) + sy, 0, spin);
      window.__vt += dt;
      w.tick();
    }
  }, { seconds, script, fps });

const rows = [];
const fails = [];
const check = (name, ok, result) => {
  rows.push([name, result]);
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${result}`);
};

// --- 1. every configuration loads, runs, resizes, and survives bad input ---
{
  const cases = [
    ['wallpaper', '', { width: W, height: H }],
    ['landscape', '', { width: H, height: W }],
    ['tiny', '', { width: 200, height: 320 }],
    ['pouch', 'mode=pouch&drops=380&fill=0.3', { width: 512, height: 512 }],
    ['no extras', 'gloss=0&shadow=0&filings=0', { width: W, height: H }],
    ['no magnets', 'poles=0', { width: W, height: H }],
    ['one magnet', 'poles=1', { width: W, height: H }],
    ['coarse grid', 'grid=9&drops=400', { width: W, height: H }],
  ];
  let worst = 100, bad = 0;
  for (const [, qs, vp] of cases) {
    const page = await open(qs, vp);
    await drive(page, 7);
    /* A host is a program and programs send rubbish. A pole at NaN is not a
     * pole that does nothing, it is a field that is NaN everywhere. */
    await page.evaluate(() => {
      const w = window.__wallpaper;
      w.tap(NaN, 0.5); w.tap(0.5, undefined); w.tap(Infinity, Infinity);
      w.motion(NaN, NaN, NaN, NaN); w.offset(NaN);
    });
    await drive(page, 3);
    const r = await probe(page);
    if (r.nan || r.escaped) bad++;
    worst = Math.min(worst, r.bodyPct);
    // A resize destroys and rebuilds every array in the page.
    await page.setViewportSize({ width: vp.width + 90, height: vp.height + 70 });
    await drive(page, 2);
    const after = await probe(page);
    if (after.nan || after.escaped) bad++;
    await page.close();
  }
  check('8 configurations, 4 viewports, resized',
        bad === 0 && errors.length === 0,
        `${errors.length} errors, ${bad} with a lost or escaped drop; worst in-a-body ${worst}%`);
}

// --- 2. containment and recoalescence -------------------------------------
{
  const page = await open();
  await drive(page, 8);
  const settled = await probe(page);
  await drive(page, 4, 'shake');
  const shaken = await probe(page);
  await drive(page, 10);
  const recovered = await probe(page);
  check('a 2 s shake, and 10 s after it',
        shaken.escaped === 0 && recovered.escaped === 0 && recovered.bodyPct >= 80,
        `in a body ${settled.bodyPct}% -> ${shaken.bodyPct}% -> ${recovered.bodyPct}%, ` +
        `0 escaped, peak speed ${shaken.maxV} px/s`);
  await page.close();
}

// --- 3. four taps, the worst a user can do --------------------------------
{
  const page = await open();
  await drive(page, 6);
  const before = await probe(page);
  await page.evaluate(() => window.__wallpaper.tap(0.44, 0.50));
  await drive(page, 1.6);
  await page.evaluate(() => window.__wallpaper.tap(0.62, 0.62));
  await drive(page, 1.4);
  await page.evaluate(() => window.__wallpaper.tap(0.35, 0.58));
  await drive(page, 1.4);
  await page.evaluate(() => window.__wallpaper.tap(0.55, 0.45));
  await drive(page, 4);
  const after = await probe(page);
  await drive(page, 10);
  const settled = await probe(page);
  check('four taps in nine seconds',
        after.bodyPct >= 80 && settled.bodyPct >= 80,
        `in a body ${before.bodyPct}% -> ${after.bodyPct}% -> ${settled.bodyPct}%`);
  await page.close();
}

// --- 4. home-screen swipes ------------------------------------------------
{
  const page = await open();
  await drive(page, 8);
  const before = await probe(page);
  /* Three page swipes with no frame in between, which is the largest jolt a
   * launcher can deliver: the page clamps each step, but nothing stops them
   * arriving together. */
  await page.evaluate(() => {
    const w = window.__wallpaper;
    w.offset(0); w.offset(0.5); w.offset(1); w.offset(0.5); w.offset(0);
  });
  await drive(page, 3);
  const after = await probe(page);
  await drive(page, 10);
  const settled = await probe(page);
  check('five home-screen swipes at once',
        after.bodyPct >= 80 && settled.bodyPct >= 80,
        `in a body ${before.bodyPct}% -> ${after.bodyPct}% -> ${settled.bodyPct}%, ` +
        `peak speed ${after.maxV} px/s`);
  await page.close();
}

// --- 5. a long hold at a steep tilt ---------------------------------------
{
  const page = await open();
  await drive(page, 14, 'tilt');
  const r = await probe(page);
  check('52 degrees of tilt, held 12 s',
        r.escaped === 0 && r.bodyPct >= 80,
        `in a body ${r.bodyPct}%, 0 escaped, occupying ${r.bbox} of ${W}x${H}`);
  await page.close();
}

// --- 5b. flat on a desk ---------------------------------------------------
{
  const page = await open();
  await drive(page, 8);
  const upright = await probe(page);
  /* The premise is a cell on its edge, and lying flat there is no in-plane
   * gravity at all. Without a floor under the weight the magnets had nothing
   * to work against and the liquid covered the whole screen; the test is that
   * it stays a pool, with the top half free for whatever the launcher puts
   * there.
   *
   * Averaged over the minute, not sampled at the end of it. This liquid is
   * chaotic and one frame of it says nothing: an earlier version of this
   * check read a single final bounding box and failed on a splash, while the
   * behaviour over the whole minute was fine. */
  let top = 0, body = 0, samples = 0;
  for (let k = 0; k < 12; k++) {
    await drive(page, 5, 'flat');
    const r = await probe(page);
    top += r.bbox[1] / H; body += r.bodyPct; samples++;
  }
  const flat = await probe(page);
  check('face up on a desk for a minute',
        flat.escaped === 0 && body / samples >= 75 && top / samples > 0.4,
        `in a body ${upright.bodyPct}% upright, ${Math.round(body / samples)}% flat; ` +
        `top of the liquid averages ${Math.round(100 * top / samples)}% down the screen`);
  await page.close();
}

// --- 6. idle, at length ---------------------------------------------------
{
  const page = await open();
  await drive(page, 45);
  const r = await probe(page);
  check('45 s idle',
        r.escaped === 0 && r.nan === 0 && r.bodyPct >= 80,
        `in a body ${r.bodyPct}%, ${r.n} drops, 0 escaped`);
  await page.close();
}

// --- 7. the display rate must not change the physics ----------------------
{
  const a = await open(); await drive(a, 8, 'idle', 60);
  const b = await open(); await drive(b, 8, 'idle', 30);
  const [pa, pb] = await Promise.all([
    a.evaluate(() => Array.from(px).concat(Array.from(py))),
    b.evaluate(() => Array.from(px).concat(Array.from(py))),
  ]);
  const n = pa.length / 2;
  let sum = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pa[i] - pb[i], pa[n + i] - pb[n + i]);
    sum += d; max = Math.max(max, d);
  }
  const { spacing } = await probe(a);
  check('60 fps against 30 fps, 8 s idle',
        sum / n < spacing,
        `mean ${(sum / n).toFixed(1)} px apart, max ${max.toFixed(0)} px ` +
        `(drop spacing ${spacing} px)`);
  await a.close(); await b.close();
}

// --- 8. flicker: what moves when nothing should ---------------------------
{
  const page = await open('poles=0');
  await drive(page, 10);
  /* Two consecutive frames of a pool with no magnets near it. Whatever
   * differs between them is either a drop still settling or the renderer
   * being unstable, and before the surface normal was measured over arc
   * length it was mostly the latter — the highlight boiled along the whole
   * edge of a liquid that was not moving. */
  const shot = async () => (await page.screenshot()).toString('base64');
  const a = await shot();
  await drive(page, 1 / FPS);
  const b = await shot();
  const d = await page.evaluate(async ({ A, B }) => {
    const load = async (s) => { const im = new Image(); im.src = s; await im.decode(); return im; };
    const [x, y] = await Promise.all([load(A), load(B)]);
    const c = document.createElement('canvas');
    c.width = x.width; c.height = x.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(x, 0, 0);
    const da = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(y, 0, 0);
    const db = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, moved = 0;
    for (let i = 0; i < da.length; i += 4) {
      const v = Math.abs(da[i] - db[i]);
      sum += v; if (v > 12) moved++;
    }
    const n = da.length / 4;
    return { mean: sum / n, pct: 100 * moved / n };
  }, { A: 'data:image/png;base64,' + a, B: 'data:image/png;base64,' + b });
  check('frame to frame with the liquid at rest', d.pct < 0.6,
        `${d.mean.toFixed(2)}/255 mean, ${d.pct.toFixed(2)}% of pixels moved more than 12 levels`);
  await page.close();
}

// --- 9. cost --------------------------------------------------------------
for (const qs of ['', 'drops=700']) {
  const page = await open(qs);
  await drive(page, 8);
  /* Frames spaced out, and reported as a median rather than a mean.
   *
   * Both of those were wrong here before, and in the same direction. Driven
   * back to back with no gap, the canvas eventually stalls waiting to flush,
   * which puts a handful of forty-millisecond frames into the sample: the
   * median stays at 3.7 ms while the mean climbs past 11, and it was the mean
   * that got written down. A wallpaper draws once per vsync and sleeps for the
   * rest of it, so a gap is the honest condition, and a median with a 95th
   * percentile beside it says more than either average. */
  const ms = await page.evaluate(async ({ n }) => {
    const R = window.__real, w = window.__wallpaper;
    const t = [];
    for (let f = 0; f < n; f++) {
      await new Promise((r) => setTimeout(r, 4));
      const t0 = R();
      w.motion(0, 9.81, 0, 0); window.__vt += 1000 / 60; w.tick();
      t.push(R() - t0);
    }
    t.sort((a, b) => a - b);
    return { p50: t[t.length >> 1], p95: t[Math.floor(t.length * 0.95)] };
  }, { n: 200 });
  const r = await probe(page);
  check(`JavaScript per frame, ${r.n} drops`, ms.p95 < 12,
        `${ms.p50.toFixed(1)} ms median, ${ms.p95.toFixed(1)} ms at the 95th percentile`);
  await page.close();
}

await browser.close();
server.close();

if (errors.length) {
  console.log(`\n${errors.length} page errors:`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall ok');
process.exit(fails.length ? 1 : 0);
