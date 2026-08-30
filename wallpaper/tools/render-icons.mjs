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
const CORNER = Math.round(MASTER * 0.5);

/* The icon is captured mid-swirl, not at rest.
 *
 * The glitter is buoyant, so left alone it rises, gathers in a band under
 * the surface and stays there — which empties the lower two thirds of the
 * tile and wastes most of the area. A shaker is only itself while it is
 * settling, so the vessel is held still long enough for gravity to converge,
 * shaken, and then photographed part-way through the float-back, with the
 * flakes still spread through the body of the liquid.
 *
 * RELAX_S is the composition dial: shorter is busier and more chaotic,
 * longer drifts back towards the empty settled state. */
const HOLD_S = 2;
const SHAKE_S = 1.2;
const RELAX_S = 0.45;
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
  zoom: '2.6',
  stars: '130',
  bubbles: '26',
  fill: '0.86',
  // Icons are small objects seen whole, so the front face is a surface
  // that curves. A wallpaper has no edge to curve over and leaves this off.
  dome: '1',
  /* The mark takes about half the tile. The page's own default is sized for
   * a charm floating in a wallpaper, which in a launcher grid reads as an
   * emblem lost in the middle of a large empty container. */
  glyphScale: '1.0',
};

/* Every colourway is generated from a single hue.
 *
 * Hand-picked hex is how the first set was built and it is why the tiles did
 * not read as a family: each ramp spanned its own lightness range at its own
 * saturation, so side by side they looked like seven separate experiments
 * rather than one product in seven finishes. Cohesion is not something to
 * eyeball across eight swatches — it is a property of sharing a formula.
 *
 * So a colourway is a hue plus two modifiers, and the structure below is
 * identical for all of them:
 *
 *   ramp   deepest at the top of the pour, lifting and drifting toward the
 *          cool side as it lightens, because a real body of liquid loses
 *          both saturation and warmth with depth of view,
 *   dense  the second phase, rotated off the hue and lifted well above it,
 *          so it marbles rather than silts,
 *   air    the headspace, the same hue drained of nearly all its chroma —
 *          tinted air, but air in *this* vessel.
 *
 * `sat` and `lift` are the only per-colourway freedom: they make graphite and
 * clear members of the family rather than outliers, by pulling chroma out and
 * lightness up while every other relationship holds.
 */
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

function colourway({ name, hue, glyph, sat = 1, lift = 0, glass }) {
  const ramp = [0, 1, 2, 3].map((i) => {
    const t = i / 3;
    return hsl(hue - 23 * t, (90 - 12 * t) * sat, 44 + 16 * t + lift);
  });
  return {
    name, glyph, glass,
    ramp,
    dense: hsl(hue - 55, 78 * sat, 66 + lift * 0.4),
    air: [
      hsl(hue - 10, 54 * sat, 87 + lift * 0.25),
      hsl(hue - 10, 68 * sat, 95),
      hsl(hue - 10, 58 * sat, 80 + lift * 0.25),
    ].join(','),
  };
}

const COLOURWAYS = [
  colourway({ name: 'blue',     hue: 216, glyph: 'chat' }),
  colourway({ name: 'candy',    hue: 335, glyph: 'heart' }),
  colourway({ name: 'violet',   hue: 272, glyph: 'music' }),
  colourway({ name: 'mint',     hue: 158, glyph: 'gear' }),
  colourway({ name: 'amber',    hue: 32,  glyph: 'bolt' }),
  // The neutral of the family: same construction, chroma pulled almost out.
  colourway({ name: 'graphite', hue: 215, glyph: 'camera', sat: 0.14 }),
  // Colourless liquid, which is what most real shakers hold. Still not white:
  // drain the tint entirely and it matches the headspace, the waterline
  // disappears, and the tile stops reading as a vessel with something in it.
  colourway({ name: 'clear',    hue: 200, glyph: 'heart', sat: 0.42, lift: 30 }),
  // Glass: the fluid thins to a tint and the PNG keeps its alpha, so a
  // launcher composites the container over the wallpaper behind it.
  colourway({ name: 'glass',    hue: 200, glyph: 'bolt', sat: 0.55, lift: 18, glass: '1' }),
].filter((w) => !process.env.ICON_ONLY || w.name === process.env.ICON_ONLY);

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
    dense: way.dense,
    air: way.air,
    glass: way.glass ?? '0',
    // ICON_GLYPH overrides the set; ICON_GLYPH= renders the vessels empty.
    glyph: process.env.ICON_GLYPH ?? way.glyph ?? '',
    /* Fizz is seeded by vorticity, so the shake does raise some — but it is
     * the fastest thing in the vessel and has cleared by the time the shot is
     * taken. Simulating it would only cost frames. */
    fizz: '0',
    ...SUSPENSION,
  });
  await page.goto(`${origin}/?${q}`, { waitUntil: 'load' });

  await page.evaluate(
    ({ ax, ay, dt, hold, shake, relax }) => {
      window.__shaker.drive();

      /* Reported every frame, as a real sensor would. The page low-passes the
       * reading to split gravity from hand motion, so a single sample never
       * converges and the vessel would never learn which way is down. */
      const run = (seconds, at) => {
        const n = Math.round((seconds * 1000) / dt);
        for (let f = 0; f < n; f++) {
          at(f / n, f);
          window.__vt += dt;
          window.__shaker.tick();
        }
      };

      run(hold, () => window.__shaker.motion(ax, ay, 0, 0));

      /* A shake is hand motion on top of gravity, not a change in which way
       * down is: two axes at different rates so the path does not close on
       * itself, which is what makes a real shake stir rather than rock. */
      run(shake, (u) => {
        const t = u * shake * Math.PI * 2;
        window.__shaker.motion(
          ax + 15 * Math.sin(t * 5.5),
          ay + 12 * Math.sin(t * 3.7 + 1.1),
          0,
          260 * Math.sin(t * 2.3),
        );
      });

      run(relax, () => window.__shaker.motion(ax, ay, 0, 0));
    },
    { ax: AX, ay: AY, dt: DT_MS, hold: HOLD_S, shake: SHAKE_S, relax: RELAX_S },
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
