import { serve, open } from './harness.tmp.mjs';
import { mkdirSync } from 'node:fs';
const OUT='/tmp/claude-0/-home-user/f1700e31-4a57-5630-b066-dacea030c274/scratchpad/ship8';
mkdirSync(OUT,{recursive:true});
const h = await serve();
const errs=[];
const runs=[];
for (let k=0;k<3;k++){
  const p = await open(h.browser, h.port, 'seed=17');
  await p.evaluate(()=>{ window.__still(4); window.__shake(2.5); window.__still(10); });
  runs.push(JSON.stringify(await p.evaluate(()=>window.__m())));
  errs.push(...p.errs); await p.close();
}
console.log('determinism:', runs.every(r=>r===runs[0])?'identical x3':('DIVERGES\n'+runs.join('\n')));
for (const sd of [3,17,99]) {
  const p = await open(h.browser, h.port, `seed=${sd}`);
  const m = await p.evaluate(()=>window.__m());
  console.log(`seed ${String(sd).padEnd(3)} blobs ${m.blobs} oil ${m.oil} round ${m.round}`);
  try{ await p.screenshot({path:`${OUT}/seed${sd}.png`,timeout:60000}); }catch(e){}
  errs.push(...p.errs); await p.close();
}
const p = await open(h.browser, h.port, 'seed=17');
const seq=[];
const step = async (tag, fn, n) => { seq.push([tag, await p.evaluate(fn)]);
  try{ await p.screenshot({path:`${OUT}/${n}.png`,timeout:60000}); }catch(e){} };
await step('rest', ()=>{window.__still(4); return window.__m();}, '0-rest');
await step('shake', ()=>{window.__shake(2.5); return window.__m();}, '1-shake');
await step('+3s', ()=>{window.__still(3); return window.__m();}, '2-plus3s');
await step('settled', ()=>{window.__still(30); return window.__m();}, '3-settled');
await step('flip+4s', ()=>{window.__flip(); for(let i=0;i<240;i++) window.__tick(0,-9.81); return window.__m();}, '4-flip4');
for (const [k,v] of seq)
  console.log(k.padEnd(8), `blobs ${v.blobs} round ${v.round} thick ${String(v.thick).padStart(3)} lobes ${String(v.lobes).padStart(4)} | div ${v.div} oil ${v.oil} drift ${(v.mean-v.target).toFixed(5)} | cen ${v.cen} rms ${v.rms}`);
errs.push(...p.errs); await p.close();
// the colourway must still work
const c = await open(h.browser, h.port, 'seed=17&ramp=%230a5fd4,%231a86f0,%232aa8ee,%233ec4e9&tint=%23e8806c');
await c.evaluate(()=>window.__still(4));
try{ await c.screenshot({path:`${OUT}/colourway.png`,timeout:60000}); }catch(e){}
console.log('colourway via URL:', JSON.stringify(await c.evaluate(()=>window.__m())));
errs.push(...c.errs); await c.close();
const r = await h.browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:2 });
await r.goto(`http://127.0.0.1:${h.port}/?seed=17`); await r.waitForTimeout(2500);
console.log('fps at rest:', (await r.evaluate(()=>new Promise(res=>{let n=0;const t0=performance.now();
  const f=()=>{n++; if(performance.now()-t0<3000) requestAnimationFrame(f); else res(n/((performance.now()-t0)/1000));};
  requestAnimationFrame(f);}))).toFixed(1));
await r.close();
console.log(errs.length?('ERRORS: '+[...new Set(errs)].join(' | ')):'no page errors');
await h.close();
