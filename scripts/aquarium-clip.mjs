/**
 * Record the aquarium prototype to an mp4.
 *
 * Still frames cannot show the thing the prototype exists to prove — that a
 * cloud of points swims. So this drives the page on a fixed timestep through
 * `window.__aquarium.now`, captures every frame, and lets ffmpeg reassemble
 * them. Capture is far slower than real time, and that does not matter: the
 * scene only advances when the clock is advanced, so the result is smooth and
 * identical on every run rather than a recording of how busy the machine was.
 *
 *   node scripts/aquarium-clip.mjs
 *   CLIP_OUT=/tmp CLIP_SECONDS=6 node scripts/aquarium-clip.mjs '?pose=1&fish=4'
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = process.env.CLIP_OUT ?? new URL('../renders/', import.meta.url).pathname;
const PAGE = new URL('../aquarium/prototype.html', import.meta.url).href;
const QUERY = process.argv[2] ?? '?seed=7';
const FPS = Number(process.env.CLIP_FPS ?? 30);
const SECONDS = Number(process.env.CLIP_SECONDS ?? 12);
// Bursts are the interaction worth showing; by default one fires two thirds of
// the way in, leaving time for the points to be carried off and reassemble.
const BURST_AT = Number(process.env.CLIP_BURST ?? SECONDS * 0.62);
// Playwright bundles an ffmpeg, but it is a WebM-only build with no H.264
// encoder — a system ffmpeg is required for mp4.
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const frames = join(OUT, 'frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 1170 }, deviceScaleFactor: 1 });
await page.goto(`${PAGE}${QUERY}`);

// Take the clock before anything is drawn, so frame zero is the true start.
await page.evaluate(() => {
  window.__clipTime = 0;
  window.__aquarium.now = () => window.__clipTime;
});

const step = 1000 / FPS;
const total = Math.round(SECONDS * FPS);
const burstFrame = Math.round(BURST_AT * FPS);
let burst = false;

for (let i = 0; i < total; i++) {
  if (!burst && i >= burstFrame) {
    // A tap on the glass, which is the interaction the wallpaper actually
    // ships — it scatters the nearest fish. CLIP_BURST_ALL bursts the whole
    // school instead, which is showier and not what a tap does.
    if (process.env.CLIP_BURST_ALL) await page.keyboard.press('b');
    else await page.mouse.click(270, 470);
    burst = true;
  }
  // Advance the clock, then wait for the page's own loop to consume it. Any
  // extra rAF in between sees dt = 0 and redraws the same frame, so the timing
  // stays exact however many fire.
  await page.evaluate(
    (ms) => new Promise((done) => {
      window.__clipTime += ms;
      requestAnimationFrame(() => requestAnimationFrame(done));
    }),
    step,
  );
  await page.screenshot({ path: join(frames, `f${String(i).padStart(5, '0')}.png`) });
  if (i % FPS === 0) process.stdout.write(`\r  ${i / FPS}s / ${SECONDS}s`);
}
process.stdout.write('\r');
await browser.close();

const mp4 = join(OUT, 'aquarium-particle-fish.mp4');
execFileSync(FFMPEG, [
  '-y', '-framerate', String(FPS), '-i', join(frames, 'f%05d.png'),
  // yuv420p and even dimensions, or half the players in the world refuse it.
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', mp4,
], { stdio: 'inherit' });
rmSync(frames, { recursive: true, force: true });
console.log(mp4);
