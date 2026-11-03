// Smoke test of candidate models on Vultr Serverless Inference: latency, JSON validity, vision.
// Usage: VULTR_INFERENCE_KEY=... tsx scripts/smoke-models.ts [model ...]
import fs from 'node:fs';
import { vultrClient, parseJsonLoose, usage } from '../src/vultr';
const key = process.env.VULTR_INFERENCE_KEY!; if (!key) throw new Error('VULTR_INFERENCE_KEY');
const v = vultrClient(key);
const models: any = await fetch('https://api.vultrinference.com/v1/models', { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
const ids: string[] = (models.data || []).map((m: any) => m.id);
console.log('catalogue:', ids.length, 'models');
fs.writeFileSync('scripts/models-live.json', JSON.stringify(models, null, 1));
const chatCands = process.argv.slice(2).length ? process.argv.slice(2) : ids.filter((i) => /qwen|deepseek|glm|mimo|llama|kimi|gpt|mistral|nemotron/i.test(i) && !/embed|rerank|whisper|safety|guard/i.test(i));
const shot = fs.existsSync('scripts/sample-shot.jpg') ? fs.readFileSync('scripts/sample-shot.jpg').toString('base64') : null;
for (const m of chatCands) {
  const t0 = Date.now(); let ok = false; let out = '';
  try {
    out = await v.chat(m, [{ role: 'system', content: 'Reply with JSON only.' }, { role: 'user', content: 'Page has a field labelled "Full name" and a button "Save contact". Goal: enter the name Ana Lee. Reply {"action":{"op":"fill","label":...,"value":...}}' }], { json: true, maxTokens: 300 });
    const j = parseJsonLoose(out); ok = j?.action?.op === 'fill' && /Ana Lee/.test(j.action.value);
  } catch (e) { out = String(e).slice(0, 160); }
  let vis = '-';
  if (shot) {
    const tv = Date.now();
    try {
      const r = await v.chat(m, [{ role: 'user', content: [{ type: 'text', text: 'Reply JSON {"ok":true|false,"observed":"..."}: does this screenshot show a form titled "New contact"?' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } }] }], { json: true, maxTokens: 150 });
      vis = `${parseJsonLoose(r).ok} ${Date.now() - tv}ms`;
    } catch (e) { vis = 'no-vision: ' + String(e).slice(0, 80); }
  }
  console.log(`${m.padEnd(40)} plan=${ok ? 'OK ' : 'BAD'} ${Date.now() - t0}ms  vision=${vis}  ${ok ? '' : out.slice(0, 100).replace(/\n/g, ' ')}`);
}
console.log('usage', JSON.stringify(usage));
