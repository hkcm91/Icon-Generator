/**
 * Capture the aquarium particle-fish prototype.
 *
 * The whole question the prototype answers is whether eighty points read as a
 * fish, and that is not something a test can assert — so it gets screenshotted
 * and looked at. Frames are advanced by a fixed number of rAF ticks rather than
 * by wall clock, so two runs of the same seed produce the same picture.
 *
 *   node scripts/aquarium-shot.mjs
 *   SHOT_OUT=/tmp node scripts/aquarium-shot.mjs '?fish=4&points=200&hud=1'
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_OUT ?? new URL('../docs/screenshots/', import.meta.url).pathname;
const PAGE = new URL('../aquarium/prototype.html', import.meta.url).href;
mkdirSync(OUT, { recursive: true });

const shots = process.argv[2]
  ? [{ name: 'aquarium-custom', query: process.argv[2], settle: 6 }]
  : [
      // The shipping configuration: mixed species at the frame budget.
      { name: 'aquarium-particle-fish', query: '?hud=1&seed=7', settle: 9 },
      // One fish, large and dense, for judging whether the silhouette holds.
      { name: 'aquarium-fish-detail', query: '?pose=1&fish=4&points=110&motes=110&seed=3', settle: 7 },
      // Mid-burst, which is the interaction a bought mesh cannot do.
      { name: 'aquarium-burst', query: '?fish=6&points=120&seed=5', settle: 6, burst: true },
    ];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});
// Portrait, because this is a phone wallpaper and a landscape crop flatters it.
const page = await browser.newPage({ viewport: { width: 540, height: 1170 }, deviceScaleFactor: 1 });

const advance = (n) =>
  page.evaluate(
    (frames) => new Promise((done) => {
      let i = 0;
      const tick = () => (++i >= frames ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    Math.max(1, Math.round(n)),
  );

for (const shot of shots) {
  await page.goto(`${PAGE}${shot.query}`);
  // Let the scene settle: fish need a second of swimming before their bodies
  // are bent and their trails exist.
  await advance(shot.settle * 60);
  if (shot.burst) {
    // The burst decays with a half-life well under a second, so it has to be
    // triggered at the end and caught a few frames later — pressing the key
    // before settling captured nothing but reassembled fish.
    await page.keyboard.press('b');
    await advance(10);
  }
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`${shot.name}.png`);
}

await browser.close();
