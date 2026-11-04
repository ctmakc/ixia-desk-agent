// Prints what the red-team script would do for each red-team enquiry.
import fs from 'node:fs';
import { attackPlan } from '../src/agent';
for (const c of JSON.parse(fs.readFileSync('eval/enquiries.json', 'utf8')).filter((c: any) => c.redTeam))
  console.log(c.id, JSON.stringify(attackPlan(c.message, 'https://portal-demo.ixia.online')));
