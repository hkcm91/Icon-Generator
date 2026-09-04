import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
export const INIT = `
  (() => { let now = 0; const q = [];
    window.__realNow = performance.now.bind(performance);
    performance.now = () => now; Date.now = () => 1600000000000 + now;
    window.requestAnimationFrame = (f) => { q.push(f); return q.length; };
    window.cancelAnimationFrame = (id) => { if (id) q[id - 1] = null; };
    window.__vclock = { pump(dtms){ now += dtms; const due=q.splice(0,q.length); for (const f of due) if (f) f(now); } }; })();
`;
export async function open(browser, port, query, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 393, height: 852 }, deviceScaleFactor: viewport ? 1 : 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(INIT);
  await page.goto(`http://127.0.0.1:${port}/?${query}`);
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) window.__vclock.pump(1000 / 60);
    const t = document.getElementById('tap'); if (t) t.style.display = 'none';
    window.__S = window.__shaker; window.__S.drive(); window.__hz = 60;
    window.__tick = (ax, ay) => { window.__S.motion(ax, ay, 0); window.__vclock.pump(1000/window.__hz); window.__S.tick(); };
    window.__still = (s) => { for (let i=0;i<Math.round(s*window.__hz);i++) window.__tick(0, 9.81); };
    window.__shake = (s) => { const n = Math.round(s*window.__hz);
      for (let i=0;i<n;i++){ const t=i/window.__hz, w=2*Math.PI*2.5;
        window.__tick(9.81*2.1*Math.sin(w*t), 9.81*(1+1.8*Math.cos(w*t*1.27))); } };
    window.__flip = () => { for (let i=0;i<Math.round(1.6*60);i++){
      const u=i/(1.6*60), e=u*u*(3-2*u), r=Math.PI*e;
      window.__tick(-9.81*Math.sin(r), 9.81*Math.cos(r)); } };
    window.__m = () => { const x = window.__S.stats(); return {
      blobs: x.blobs, oil: +x.oilFraction.toFixed(3), round: +x.roundness.toFixed(2),
      thick: +x.thickness.toFixed(0), lobes: +x.lobes.toFixed(1), div: +x.divergence.toFixed(3),
      cen: +x.centroid.toFixed(3), rms: +x.rms.toFixed(0),
      mean: +x.mean.toFixed(5), target: +x.targetMean.toFixed(5) }; };
  });
  page.errs = errs; return page;
}
export async function serve() {
  const html = readFileSync('wallpaper/oil-water.html', 'utf8');
  const server = createServer((q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end(html); }).listen(0);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  return { port: server.address().port, browser, close: async () => { await browser.close(); server.close(); } };
}
