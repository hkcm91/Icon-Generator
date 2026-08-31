/**
 * Capture the ferrofluid wallpaper in motion.
 *
 * The still renderer answers "what does it look like"; this answers the
 * question a still cannot, which is whether it reads as a magnetic liquid when
 * something is actually happening to it. One clip, one motion script: the
 * magnets working the pool on their own, then a tap, then a roll, then a
 * shake, then the settle after it.
 *
 * The clock is hand-turned, as in the still renderer, and it matters more
 * here. With the real clock the frame interval is however long a software
 * rasteriser happened to take, so the playback speed would encode machine load
 * rather than simulated time — the same clip would run at a different speed on
 * a different machine. Turned by hand, one captured frame is always 1/30 s of
 * simulated time.
 *
 * Frames are piped straight into ffmpeg rather than written out and read back.
 * A minute of this at device resolution is several hundred megabytes of PNG
 * that nothing ever wants to look at, and on a container with a fixed disk
 * allowance that is the difference between a clip and a failed render.
 *
 *   node wallpaper/tools/render-ferrofluid-motion.mjs
 *
 * Env:
 *   FF_MP4       where to write            (default /tmp/ferrofluid/ferrofluid.mp4)
 *   FF_SECONDS   clip length               (default 23)
 *   FF_QUERY     extra page parameters     (default none)
 *   FFMPEG       an ffmpeg with libx264
 *   PW_CHROMIUM  a chromium binary, if Playwright cannot find its own
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..', 'ferrofluid.html');
const MP4 = process.env.FF_MP4 ?? '/tmp/ferrofluid/ferrofluid.mp4';
const QUERY = process.env.FF_QUERY ?? '';
const SECONDS = Number(process.env.FF_SECONDS ?? 30);

/* A phone-shaped viewport at twice the scale. Both dimensions have to stay
 * even: yuv420p subsamples chroma by two, and every player wants yuv420p. */
const W = 432, H = 912, SCALE = 2;
const FPS = 30;                    // captured
const SUB = 2;                     // physics steps per captured frame
const DT = 1000 / (FPS * SUB);     // so the simulation still runs at 60 Hz

/* An ffmpeg, from wherever there is one.
 *
 * Not a declared dependency, deliberately — it is a thirty-megabyte binary
 * that only this one tool wants, and the shaker's motion renderer already
 * takes the same "bring your own" line. Any of these will do, as long as it
 * has libx264: Playwright's bundled build does not, so it is not on the list.
 *
 *   FFMPEG=/path/to/ffmpeg          an explicit one, checked first
 *   npm i --no-save ffmpeg-static   a static build, no system packages
 *   pip install imageio-ffmpeg      what the shaker's renderer uses
 *   apt install ffmpeg              whatever is on PATH
 */
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return createRequire(import.meta.url)('ffmpeg-static'); } catch (e) { /* next */ }
  const py = spawnSync('python3',
    ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
    { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  return 'ffmpeg';
}

/* One motion script, as a function of elapsed time rather than a list of
 * phases, so the clip is reproducible and a change to it is a change to one
 * expression. Gravity is what the sensor would report for a phone rolling
 * through `tilt`; the shake rides on top of it as hand motion, which is the
 * distinction the page's own low-pass filter is looking for. */
function motionAt(t) {
  const G = 9.81;
  let tilt = 0, sx = 0, sy = 0, spin = 0;

  if (t >= 13 && t < 19) {
    // Roll over and hold, so the liquid has to find a new level, then back.
    const u = t < 15.5 ? (t - 13) / 2.5 : t < 17.5 ? 1 : 1 - (t - 17.5) / 1.5;
    tilt = 0.8 * (u * u * (3 - 2 * u));
  } else if (t >= 19 && t < 20.4) {
    /* Shake. Two rates, so the path does not close on itself — and short,
     * because what is worth watching is not the two seconds of chaos but the
     * ten after it, where the beads find each other and become a pool again. */
    const u = t - 19;
    sx = 26 * Math.sin(u * 33);
    sy = 21 * Math.sin(u * 23 + 1.1);
    spin = 240 * Math.sin(u * 14);
  }
  return { ax: -G * Math.sin(tilt) + sx, ay: G * Math.cos(tilt) + sy, spin };
}

/** Taps, as [second, x, y] in fractions of the surface. */
const TAPS = [[5.5, 0.45, 0.53], [9.5, 0.62, 0.41]];

mkdirSync(dirname(MP4), { recursive: true });

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
const page = await browser.newPage({
  viewport: { width: W, height: H }, deviceScaleFactor: SCALE,
});
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });

await page.addInitScript(() => {
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
});
await page.goto(`${origin}/?${QUERY}`, { waitUntil: 'load' });
await page.evaluate(() => {
  window.__wallpaper.drive();
  /* The hint fades out over half a second of *wall* time and this harness runs
   * the page's clock by hand, so no wall time passes and it would sit there
   * for the whole clip. It is an instruction to someone holding a phone, not
   * part of the picture. */
  document.getElementById('tap')?.remove();
});

const ff = spawn(ffmpegPath(), [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
  '-movflags', '+faststart', MP4,
], { stdio: ['pipe', 'ignore', 'pipe'] });
let ffErr = '';
ff.stderr.on('data', (d) => { ffErr += d; });
const done = new Promise((res, rej) => {
  ff.on('close', (code) => code === 0 ? res() : rej(new Error(ffErr.slice(-1800))));
  ff.on('error', rej);
});

const FRAMES = Math.round(SECONDS * FPS);
const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) {
  const t = f / FPS;
  const m = motionAt(t);
  const tap = TAPS.find(([at]) => at >= t && at < t + 1 / FPS);
  await page.evaluate(({ ax, ay, spin, dt, sub, tap }) => {
    const w = window.__wallpaper;
    if (tap) w.tap(tap[0], tap[1]);
    for (let k = 0; k < sub; k++) {
      w.motion(ax, ay, 0, spin);
      window.__vt += dt;
      w.tick();
    }
  }, { ...m, dt: DT, sub: SUB, tap: tap ? [tap[1], tap[2]] : null });

  const png = await page.screenshot();
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 60 === 0) process.stdout.write(`  ${t.toFixed(0)}s / ${SECONDS}s\n`);
}
ff.stdin.end();
await done;

await browser.close();
server.close();
console.log(`\n${FRAMES} frames at ${W * SCALE}x${H * SCALE} -> ${MP4}` +
            `  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
