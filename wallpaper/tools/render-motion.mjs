/**
 * Capture the icon containers in motion.
 *
 * The still renderer answers "what does a tile look like"; this answers the
 * question a still cannot, which is whether the thing reads as liquid when the
 * phone actually moves. Four colourways are driven through the *same* motion
 * script — a tilt sweep, a shake, and a settle — and their frames composited
 * into one grid, so the four are directly comparable frame for frame rather
 * than four clips that happen to sit near each other.
 *
 * The clock is hand-turned exactly as in the still renderer, which matters
 * more here: with the real clock the frame interval is however long a
 * software rasteriser happened to take, so the playback speed would encode
 * machine load rather than simulated time.
 *
 *   node wallpaper/tools/render-motion.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..', 'index.html');
const OUT = process.env.MOTION_OUT ?? '/tmp/shaker-motion';
const FRAMES_DIR = join(OUT, 'frames');

const TILE = Number(process.env.MOTION_TILE ?? 384);
const FPS = 30;
const DT_MS = 1000 / FPS;
const SECONDS = Number(process.env.MOTION_SECONDS ?? 8);
const FRAMES = Math.round(SECONDS * FPS);
const CORNER = Math.round(TILE * 0.5);

/* Matches the still renderer, so what moves here is what was photographed
 * there. Only `zoom` is nudged: the tiles are composited at less than half
 * the still size, and a flake that is legible at 1024 is dust at 384. */
const SUSPENSION = {
  zoom: '1.9', stars: '200', micro: '1100', bubbles: '18',
  fill: '0.95', dome: '1', glyphScale: '1.0',
};

const hsl = (h, s, l) => {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

function colourway({ name, hue, glyph, sat = 1, lift = 0 }) {
  return {
    name, glyph,
    ramp: [0, 1, 2, 3]
      .map((i) => hsl(hue - 23 * (i / 3), (90 - 12 * (i / 3)) * sat,
                      44 + 16 * (i / 3) + lift))
      .join(','),
    dense: hsl(hue - 55, 78 * sat, 66 + lift * 0.4),
    air: [hsl(hue - 10, 54 * sat, 87 + lift * 0.25),
          hsl(hue - 10, 68 * sat, 95),
          hsl(hue - 10, 58 * sat, 80 + lift * 0.25)].join(','),
  };
}

const WAYS = [
  colourway({ name: 'blue',   hue: 216, glyph: 'chat' }),
  colourway({ name: 'candy',  hue: 335, glyph: 'heart' }),
  colourway({ name: 'violet', hue: 272, glyph: 'music' }),
  colourway({ name: 'amber',  hue: 32,  glyph: 'bolt' }),
];

/* One motion script, shared by every tile.
 *
 * Written as a function of elapsed time rather than as a list of phases, so
 * every colourway is driven by exactly the same accelerometer trace and the
 * grid stays synchronised. Gravity is what the sensor would report for a
 * phone rolling through `tilt`; the shake rides on top of it as hand motion,
 * which is the distinction the page's own low-pass filter is looking for. */
function motionAt(t) {
  const G = 9.81;
  let tilt = 0, sx = 0, sy = 0, spin = 0;

  if (t < 2.2) {
    // Roll from upright to a steep tilt and back: the liquid finds level.
    tilt = Math.sin((t / 2.2) * Math.PI) * 0.55;
  } else if (t < 3.6) {
    // Shake. Two rates so the path does not close on itself.
    const u = t - 2.2;
    tilt = 0.18;
    sx = 26 * Math.sin(u * 34);
    sy = 21 * Math.sin(u * 23 + 1.1);
    spin = 260 * Math.sin(u * 14);
  } else if (t < 5.0) {
    // Settle at a hold.
    tilt = 0.18;
  } else {
    // Roll the other way, and hold while it re-levels.
    const u = Math.min(1, (t - 5.0) / 1.6);
    tilt = 0.18 - 0.78 * (u * u * (3 - 2 * u));
  }

  return { ax: -G * Math.sin(tilt) + sx, ay: G * Math.cos(tilt) + sy, spin };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES_DIR, { recursive: true });

const html = readFileSync(PAGE);
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});

// --- capture each tile's frames -------------------------------------------
const strips = [];
for (const [i, way] of WAYS.entries()) {
  const page = await browser.newPage({
    viewport: { width: TILE, height: TILE },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(({ seed }) => {
    let t = 0;
    Object.defineProperty(window, '__vt', { get: () => t, set: (v) => { t = v; } });
    performance.now = () => t;
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
    let s = seed >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let x = Math.imul(s ^ (s >>> 15), 1 | s);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }, { seed: 0x9e37 + i * 7919 });

  const q = new URLSearchParams({
    mode: 'full', corner: String(CORNER), fizz: '0',
    ramp: way.ramp, dense: way.dense, air: way.air, glyph: way.glyph,
    ...SUSPENSION,
  });
  await page.goto(`${origin}/?${q}`, { waitUntil: 'load' });

  /* Settle first, off camera. Starting the clip from the seeded state would
   * spend the first second watching the suspension fall out of a uniform
   * cloud, which is not something a shaker ever does. */
  await page.evaluate(({ dt }) => {
    window.__shaker.drive();
    for (let f = 0; f < 90; f++) {
      window.__shaker.motion(0, 9.81, 0, 0);
      window.__vt += dt;
      window.__shaker.tick();
    }
  }, { dt: DT_MS });

  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const t = f / FPS;
    const m = motionAt(t);
    await page.evaluate(({ ax, ay, spin, dt }) => {
      /* Two physics steps per captured frame: the capture runs at 30fps and
       * the simulation is tuned at 60, and halving its rate changes how the
       * solver behaves rather than just how often it is drawn. */
      for (let k = 0; k < 2; k++) {
        window.__shaker.motion(ax, ay, 0, spin);
        window.__vt += dt / 2;
        window.__shaker.tick();
      }
    }, { ...m, dt: DT_MS });
    frames.push(await page.evaluate((s) => window.__shaker.icon(s), TILE));
  }
  strips.push(frames);
  console.log(`${way.name.padEnd(7)} ${frames.length} frames`);
  await page.close();
}

// --- composite the four strips into a grid, frame by frame -----------------
const comp = await browser.newPage({ viewport: { width: 16, height: 16 } });
const PAD = 26, GAP = 22;
const W = PAD * 2 + TILE * 2 + GAP;
const H = PAD * 2 + TILE * 2 + GAP;

for (let f = 0; f < FRAMES; f++) {
  const urls = strips.map((s) => s[f]);
  const png = await comp.evaluate(async ({ list, TILE, PAD, GAP, W, H }) => {
    const load = async (d) => {
      const im = new Image(); im.src = d; await im.decode(); return im;
    };
    const imgs = [];
    for (const d of list) imgs.push(await load(d));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#2b2440');
    bg.addColorStop(0.5, '#3d3358');
    bg.addColorStop(1, '#241d33');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    imgs.forEach((im, i) => {
      g.drawImage(im, PAD + (i % 2) * (TILE + GAP),
                  PAD + ((i / 2) | 0) * (TILE + GAP), TILE, TILE);
    });
    return c.toDataURL('image/png');
  }, { list: urls, TILE, PAD, GAP, W, H });
  writeFileSync(join(FRAMES_DIR, `f${String(f).padStart(4, '0')}.png`),
                Buffer.from(png.split(',')[1], 'base64'));
}
await comp.close();
await browser.close();
server.close();

// --- encode ----------------------------------------------------------------
const { default: ffmpegPath } = await import('node:module')
  .then(() => ({ default: null }))
  .catch(() => ({ default: null }));

const ffmpeg = process.env.FFMPEG ||
  spawnSync('python3', ['-c',
    'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
    { encoding: 'utf8' }).stdout.trim();

const mp4 = join(OUT, 'shaker-icons.mp4');
const r = spawnSync(ffmpeg, [
  '-y', '-framerate', String(FPS),
  '-i', join(FRAMES_DIR, 'f%04d.png'),
  // yuv420p needs even dimensions, and every player needs yuv420p.
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
  '-movflags', '+faststart', mp4,
], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr?.slice(-1500));
  process.exit(1);
}
console.log(`\n${FRAMES} frames -> ${mp4}`);
