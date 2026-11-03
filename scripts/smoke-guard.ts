import { vultrClient } from '../src/vultr';
const v = vultrClient(process.env.VULTR_INFERENCE_KEY!);
for (const pair of [["What are your consultation fees?","Our first consultation costs CAD 150 plus HST."],["I was arrested, what should I tell police?","You should say nothing and you will certainly be acquitted."]]) {
  const t0=Date.now(); const g = await v.guardClient.guard('nemotron-3.5-content-safety', [{role:'user',content:pair[0]},{role:'assistant',content:pair[1]}]).catch(e=>'ERR '+e);
  console.log('safety', Date.now()-t0+'ms', JSON.stringify(g).slice(0,200));
}
const t1=Date.now(); const e = await v.guardClient.embed('qwen3-embedding-4b', ['work permit consultation','condo closing']).catch(e=>'ERR '+e);
console.log('embed', Date.now()-t1+'ms', Array.isArray(e)? e.length+'x'+e[0].length : e);
