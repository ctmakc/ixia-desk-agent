// Debug: raw Guardrails draft output from candidate models on Vultr.
import { vultrClient } from '../src/vultr';
import { draftMessages } from '../guard/prompts';
import { WORKSPACE } from '../src/task';
const v = vultrClient(process.env.VULTR_INFERENCE_KEY!);
const e = { name: 'Daniel', message: 'Hello, my employer in Ottawa has offered me a job and I need a work permit. Could I book a first consultation next week?' };
for (const m of (process.argv.slice(2))) {
  const t0 = Date.now();
  const out = await v.chat(m, draftMessages(WORKSPACE, e, WORKSPACE.kb, 'en') as any, { maxTokens: 700, json: true }).catch((x) => 'ERR ' + x);
  console.log('==', m, Date.now() - t0, 'ms', out.length, 'chars\n', out.slice(0, 500), '\n...', out.slice(-200));
}
