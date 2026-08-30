/**
 * Render the icon containers from the simulation itself.
 *
 * The icon is not an illustration of the shaker, it is a photograph of one:
 * the page is loaded at icon aspect, driven to a chosen state with a
 * hand-turned clock, and then asked for a picture of itself. Everything the
 * wallpaper knows about — refraction through the bezel, caustics on the far
 * wall, the settled distribution of buoyant foil, a specular that belongs to
 * the light rather than to the flake — arrives in the icon for free, because
 * it is the same renderer.
 *
 * Determinism comes from two overrides installed before the page runs:
 * `Math.random` is replaced with a seeded generator so a colourway's flake
 * layout is reproducible, and `performance.now` is replaced with a counter
 * this script advances by hand, so the simulation is stepped by exact
 * timesteps rather than by however fast the machine happened to be.
 *
 *   node wallpaper/tools/render-icons.mjs
 *   ICON_OUT=/tmp/icons node wallpaper/tools/render-icons.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..', 'index.html');
const OUT = process.env.ICON_OUT ?? join(HERE, '..', 'icons');

/* Rendered once at 1024 and resampled down from that single frame, so every
 * size is the same moment of the same pour rather than a re-run that settled
 * somewhere slightly different. */
const MASTER = 1024;
const SIZES = [1024, 512, 192];

/* The container is square here, not phone-shaped, so the corner radius has to
 * be given explicitly: the page's default is a fraction of the short edge of
 * a screen, which on a square reads far too square for a tile. */
const CORNER = Math.round(MASTER * 0.22);

/* Settling time. The buoyant glitter has to rise, gather under the surface
 * and stop moving; below about eight seconds the flakes are still visibly
 * climbing and the set looks inconsistent from one colourway to the next. */
const SETTLE_S = 12;
const DT_MS = 1000 / 60;

/* Held at a tilt rather than upright. A level waterline cuts the tile in half
 * and reads as a horizon; on the diagonal it reads as liquid in a vessel,
 * and it drives the glitter into one corner instead of a flat band. */
const TILT_DEG = 18;

/* The suspension, retuned for something the size of a fingernail.
 *
 * Rendering the wallpaper's own numbers into a tile produces a field of
 * sub-pixel speckle: 620 flakes sized against a phone screen, seen at 48dp,
 * are blue noise. So the vessel is made physically smaller — `zoom` widens
 * every flake and bubble against the walls, and the counts come down to
 * match, which leaves roughly the same fraction of the glass covered by far
 * fewer, far more legible objects.
 *
 * The fill drops too. At 0.965 the waterline is jammed into the top corner
 * and reads as a stray highlight; lower, it is unmistakably a surface, and
 * the headspace above it is what says "vessel" at a glance. */
const SUSPENSION = {
  zoom: '3.2',
  stars: '130',
  bubbles: '26',
  fill: '0.86',
};

const COLOURWAYS = [
  { name: 'blue',    ramp: ['#0a5fd4', '#1a86f0', '#2aa8ee', '#3ec4e9'] },
  { name: 'candy',   ramp: ['#c2186b', '#ea4b96', '#f77fb8', '#ffb3d4'] },
  { name: 'violet',  ramp: ['#4c1d95', '#6d34c8', '#8f5cf0', '#b18cf7'] },
  { name: 'mint',    ramp: ['#046b52', '#0f9e74', '#2fc79a', '#6fe0bd'] },
  { name: 'amber',   ramp: ['#b4530a', '#e2851c', '#f5ad3f', '#ffd070'] },
  { name: 'graphite', ramp: ['#1c2230', '#333c4f', '#4e5a72', '#6f7d96'] },
];

mkdirSync(OUT, { recursive: true });

// --- serve the page --------------------------------------------------------
// Over http rather than file://, because the page installs a manifest from a
// blob URL and file:// origins are too restricted to allow it.
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

/* Accelerometer values for a phone tilted `TILT_DEG` from upright. The page
 * reads device axes and flips x to get canvas coordinates, so the signs here
 * are what the sensor would actually report at that angle. */
const rad = (TILT_DEG * Math.PI) / 180;
const AX = -9.81 * Math.sin(rad);
const AY = 9.81 * Math.cos(rad);

const written = [];

for (const [i, way] of COLOURWAYS.entries()) {
  const page = await browser.newPage({
    viewport: { width: MASTER, height: MASTER },
    deviceScaleFactor: 1,
  });

  await page.addInitScript(({ seed }) => {
    /* A clock this script turns by hand. The page steps its simulation from
     * the delta between frames, so with the real clock a fast machine takes
     * tiny steps and a slow one takes large ones; neither reaches the same
     * state. */
    let t = 0;
    Object.defineProperty(window, '__vt', {
      get: () => t,
      set: (v) => { t = v; },
    });
    performance.now = () => t;
    // Nothing may schedule itself: every step is taken explicitly below.
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};

    // mulberry32, so a colourway's flake layout is the same on every run.
    let s = seed >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let x = Math.imul(s ^ (s >>> 15), 1 | s);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }, { seed: 0x9e37 + i * 7919 });

  const q = new URLSearchParams({
    mode: 'full',
    corner: String(CORNER),
    ramp: way.ramp.join(','),
    // Fizz is seeded by vorticity and there is none in a vessel being held
    // still, so it would cost frames to simulate nothing.
    fizz: '0',
    ...SUSPENSION,
  });
  await page.goto(`${origin}/?${q}`, { waitUntil: 'load' });

  const frames = Math.round((SETTLE_S * 1000) / DT_MS);
  await page.evaluate(
    ({ ax, ay, frames, dt }) => {
      window.__shaker.drive();
      for (let f = 0; f < frames; f++) {
        // Reported every frame, as a real sensor would: the page low-passes
        // the reading to separate gravity from hand motion, and a single
        // sample never converges.
        window.__shaker.motion(ax, ay, 0, 0);
        window.__vt += dt;
        window.__shaker.tick();
      }
    },
    { ax: AX, ay: AY, frames, dt: DT_MS },
  );

  for (const size of SIZES) {
    const url = await page.evaluate((s) => window.__shaker.icon(s), size);
    const file = join(OUT, `shaker-${way.name}-${size}.png`);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    written.push(file);
  }

  // Non-empty is not enough: a clipped-but-undrawn canvas is a valid PNG of
  // nothing, which is exactly what the old placeholder path produced.
  const ink = await page.evaluate((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const img = new Image();
    img.src = window.__shaker.icon(s);
    return img.decode().then(() => {
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, s, s).data;
      let opaque = 0, lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8) {
          opaque++;
          if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
        }
      }
      return { opaque: opaque / (s * s), lit: lit / Math.max(1, opaque) };
    });
  }, 192);

  console.log(
    `${way.name.padEnd(9)} coverage=${(ink.opaque * 100).toFixed(1)}%` +
      ` lit=${(ink.lit * 100).toFixed(1)}%`,
  );
  if (ink.opaque < 0.5 || ink.lit < 0.9) {
    throw new Error(`${way.name}: icon is empty or unpainted — ` +
      `coverage ${ink.opaque.toFixed(3)}, lit ${ink.lit.toFixed(3)}`);
  }

  await page.close();
}

await browser.close();
server.close();
console.log(`\n${written.length} files -> ${OUT}`);
