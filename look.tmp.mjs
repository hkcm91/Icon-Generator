import { serve, open } from './harness.tmp.mjs';
import { mkdirSync } from 'node:fs';
const OUT='/tmp/claude-0/-home-user/f1700e31-4a57-5630-b066-dacea030c274/scratchpad/mono';
mkdirSync(OUT,{recursive:true});
const h = await serve();
console.log('oil spread | seeded blobs / oil / biggest-vs-smallest radius');
for (const [oil,sp] of [[0.25,5],[0.32,12],[0.32,20],[0.40,12]]) {
  const p = await open(h.browser, h.port, `seed=17&oil=${oil}&spread=${sp}`);
  const m = await p.evaluate(()=>window.__m());
  console.log(`${String(oil).padEnd(4)} ${String(sp).padEnd(6)} | ${m.blobs} blobs, oil ${m.oil}, round ${m.round}, thick ${m.thick}${p.errs.length?' ERR '+p.errs[0]:''}`);
  try{ await p.screenshot({path:`${OUT}/o${oil}s${sp}.png`,timeout:60000}); }catch(e){}
  await p.close();
}
await h.close();
