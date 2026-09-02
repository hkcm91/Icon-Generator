/* Drives wallpaper/lava.html in headless Chromium through the same
 * window.__shaker calls the Android service makes, and checks that the wax
 * answers gravity and the twist the way a lamp should.
 *
 *   node scripts/lava-wallpaper-test.mjs [out-dir]
 *
 * Screenshots land in out-dir (default: build/lava-test). Exit code is the
 * verdict. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "build/lava-test";
fs.mkdirSync(out, { recursive: true });
const pageUrl = "file://" + path.resolve("wallpaper/lava.html");

const launch = { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] };
if (process.env.CHROMIUM) launch.executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 540, height: 1200 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(pageUrl);
await page.waitForTimeout(300);

// The host takes the clock, as the software fallback does.
await page.evaluate(() => window.__shaker.drive());

const centroid = () => page.evaluate(() => {
  const b = window.__lava.blobs;
  let x = 0, y = 0, m = 0;
  for (const q of b) { const w = q.r * q.r; x += q.x * w; y += q.y * w; m += w; }
  return { x: x / m, y: y / m, g: { ...window.__lava.gDir }, flow: { ...window.__lava.flow } };
});

async function run(seconds, motion) {
  await page.evaluate(({ steps, motion }) => {
    for (let i = 0; i < steps; i++) {
      if (motion) window.__shaker.motion(...motion);
      window.__lava.step(1 / 60);
    }
    window.__shaker.tick();
  }, { steps: Math.round(seconds * 60), motion });
}

await page.screenshot({ path: `${out}/upright.png` });
const c0 = await centroid();
// Right side down for 12 s: upright reads +9.81 on y, right-down reads -9.81 on x.
await run(12, [-9.81, 0, 0, 0]);
const c1 = await centroid();
await page.screenshot({ path: `${out}/right-side-down.png` });
// A 180 deg/s twist for 2 s.
await run(2, [0, 9.81, 0, 180]);
const c2 = await centroid();
// Upright again.
await run(12, [0, 9.81, 0, 0]);
const c3 = await centroid();
await page.screenshot({ path: `${out}/upright-again.png` });
// A tap in the middle, and the home screen swiped a page.
await page.evaluate(() => { window.__shaker.tap(0.5, 0.5); window.__shaker.offset(0); window.__shaker.offset(0.25); window.__shaker.tick(); });
const c4 = await centroid();

const checks = [
  ["gravity points +x when the right side is down", c1.g.x > 0.9],
  ["hot wax climbed away from the low side", c1.x < c0.x - 0.05],
  ["the twist spun the liquid", Math.abs(c2.flow.w) > 0.05],
  ["gravity settled back to down", c3.g.y < -0.9 && Math.abs(c3.g.x) < 0.1],
  ["a page swipe dragged the liquid", Math.abs(c4.flow.x) > 0.05],
  ["no page errors", errors.length === 0],
];
for (const [name, pass] of checks) console.log(pass ? "PASS" : "FAIL", name);
if (errors.length) console.log(errors);
await browser.close();
process.exit(checks.every((c) => c[1]) ? 0 : 1);
