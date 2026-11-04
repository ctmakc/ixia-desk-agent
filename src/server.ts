// IXIA Desk controller: intake API, live run view (SSE), review queue (approve/reject), public demo limits.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startRun, getRun, listRuns, subscribe, decide, loadRuns, shotPath, type Config } from './task';
import { usage } from './vultr';
import { verifyChain } from '../guard/audit';

const env = (k: string, d?: string) => { const v = process.env[k] ?? d; if (v === undefined) { console.error(`missing ${k}`); process.exit(1); } return v; };
const cfg: Config = {
  vultrKey: env('VULTR_INFERENCE_KEY'),
  portalOrigin: env('PORTAL_ORIGIN'),
  portalAdminKey: env('PORTAL_ADMIN_KEY'),
  dataDir: env('DESK_DATA', path.join(process.cwd(), 'data')),
  plannerModel: env('PLANNER_MODEL'),
  visionModel: env('VISION_MODEL'),
  guardModels: { draft: env('GUARD_DRAFT_MODEL'), verifier: env('GUARD_VERIFIER_MODEL'), safety: env('GUARD_SAFETY_MODEL'), embed: env('GUARD_EMBED_MODEL') },
};
fs.mkdirSync(cfg.dataDir, { recursive: true });
const restored = loadRuns(cfg.dataDir); if (restored) console.log(`restored ${restored} finished runs`);
const PORT = +env('PORT', '8080');
const STAFF_KEY = env('DESK_STAFF_KEY', '');           // approve/reject from the review queue
const DAILY_LIMIT = +env('DEMO_DAILY_RUNS', '150');
const PROXY_CONTAINER = env('PROXY_CONTAINER', 'desk-proxy');
const PUBLIC = path.join(process.cwd(), 'public');

let day = new Date().toISOString().slice(0, 10); let today = 0;
let active = 0; const MAX_ACTIVE = +env('MAX_PARALLEL_RUNS', '3');

const proxyNow = () => Date.now();
function proxyDenials(since: number): string[] {
  try {
    const out = execFileSync('docker', ['logs', '--since', new Date(since - 1000).toISOString(), PROXY_CONTAINER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    return out.split('\n').map((l) => { try { return JSON.parse(l).deny; } catch { return undefined; } }).filter(Boolean);
  } catch { return []; }
}

const json = (res: http.ServerResponse, code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
async function body(req: http.IncomingMessage, limit = 32 * 1024) { let s = ''; for await (const c of req) { s += c; if (s.length > limit) throw new Error('too large'); } return s ? JSON.parse(s) : {}; }
const staffOk = (req: http.IncomingMessage) => {
  if (!STAFF_KEY) return true; // public demo: judges act as the firm's staff member
  const k = String(req.headers['x-staff-key'] || '');
  return k.length === STAFF_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(STAFF_KEY));
};
const strip = (r: any) => ({ ...r, events: r.events?.map((e: any) => ({ ...e, shot: e.shot ? true : undefined })), approval: r.approval ? { ...r.approval, shot: !!r.approval.shot } : undefined });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  const p = u.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, active, today, limit: DAILY_LIMIT });
    if (p === '/api/intake' && req.method === 'POST') {
      const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; today = 0; }
      if (today >= DAILY_LIMIT) return json(res, 429, { error: `Demo limit of ${DAILY_LIMIT} runs per day reached. Recorded runs remain visible.` });
      if (active >= MAX_ACTIVE) return json(res, 429, { error: 'All sandboxes are busy, try again in a minute.' });
      const b = await body(req);
      const message = String(b.message || '').slice(0, 3000);
      if (message.length < 10) return json(res, 400, { error: 'message is required' });
      today++; active++;
      const r = startRun(cfg, { name: String(b.name || '').slice(0, 120), email: String(b.email || '').slice(0, 160), phone: String(b.phone || '').slice(0, 40), message }, !!b.redTeam, proxyNow, proxyDenials);
      const off = subscribe(r.id, (e) => { if (e.type === 'finished') { active--; off(); } });
      return json(res, 200, { id: r.id });
    }
    if (p === '/api/runs') return json(res, 200, listRuns().slice(0, 50).map((r) => ({ id: r.id, created: r.created, status: r.status, redTeam: r.redTeam, name: r.enquiry.name, decision: r.triage?.decision })));
    let m = p.match(/^\/api\/runs\/(\w+)$/);
    if (m) { const r = getRun(m[1]); return r ? json(res, 200, strip(r)) : json(res, 404, { error: 'not found' }); }
    m = p.match(/^\/api\/runs\/(\w+)\/shot\/(\d+|approval)$/);
    if (m) {
      const r = getRun(m[1]); const shot = m[2] === 'approval' ? r?.approval?.shot : r?.events[+m[2]]?.shot;
      if (!shot) return json(res, 404, { error: 'no screenshot' });
      if (shot === 'disk') { const f = shotPath(cfg.dataDir, m[1], m[2]); if (!fs.existsSync(f)) return json(res, 404, { error: 'no screenshot' }); res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); return res.end(fs.readFileSync(f)); }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' }); return res.end(Buffer.from(shot, 'base64'));
    }
    m = p.match(/^\/api\/runs\/(\w+)\/events$/);
    if (m) {
      const r = getRun(m[1]); if (!r) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', run: strip(r) })}\n\n`);
      const off = subscribe(r.id, (e) => res.write(`data: ${JSON.stringify(e.type === 'event' ? { ...e, event: { ...e.event, shot: !!e.event.shot } } : e.type === 'finished' ? { type: 'finished' } : e)}\n\n`));
      const ka = setInterval(() => res.write(': ka\n\n'), 15_000);
      req.on('close', () => { off(); clearInterval(ka); });
      return;
    }
    m = p.match(/^\/api\/runs\/(\w+)\/(approve|reject)$/);
    if (m && req.method === 'POST') {
      if (!staffOk(req)) return json(res, 401, { error: 'staff key required' });
      return json(res, decide(m[1], m[2] === 'approve', 'staff') ? 200 : 409, { ok: true });
    }
    if (p === '/api/stats') {
      const lines = fs.existsSync(path.join(cfg.dataDir, 'audit.jsonl')) ? fs.readFileSync(path.join(cfg.dataDir, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      const chain = await verifyChain(lines.map(({ run, ...r }: any) => r));
      return json(res, 200, { usage, audit: { records: lines.length, ...chain }, models: { planner: cfg.plannerModel, vision: cfg.visionModel, ...cfg.guardModels } });
    }
    // static UI
    const f = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (f.startsWith(PUBLIC) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const type = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' } as Record<string, string>)[path.extname(f)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return fs.createReadStream(f).pipe(res);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String((e as Error).message || e).slice(0, 200) }); }
});
server.listen(PORT, () => console.log(JSON.stringify({ desk: PORT, portal: cfg.portalOrigin, planner: cfg.plannerModel, vision: cfg.visionModel })));
