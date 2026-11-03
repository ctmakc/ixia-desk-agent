// One enquiry end to end: Guardrails → task token → sandbox → agent → approval → teardown → audit.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { triage } from '../guard/pipeline';
import type { GuardModels, Workspace, TriageResult } from '../guard/types';
import { appendRecord, type AuditRecord } from '../guard/audit';
import { Sandbox } from './sandbox';
import { runAgent, type AgentEvent, type Facts } from './agent';
import { vultrClient, usage } from './vultr';

export interface Config {
  vultrKey: string; portalOrigin: string; portalAdminKey: string; dataDir: string;
  plannerModel: string; visionModel: string; guardModels: GuardModels;
}

export interface Run {
  id: string; created: number; status: 'guard' | 'held' | 'blocked' | 'running' | 'awaiting_approval' | 'booked' | 'rejected' | 'stopped' | 'error' | 'contained';
  redTeam: boolean; enquiry: { name?: string; email?: string; phone?: string; message: string };
  triage?: Pick<TriageResult, 'decision' | 'checks' | 'draft' | 'trace'>;
  events: AgentEvent[]; approval?: { summary: string; shot: string | null; decided?: boolean; approved?: boolean; by?: string };
  sandbox?: { name: string; removed?: boolean; lifetimeMs?: number; killedByTimer?: boolean };
  proxyDenied: string[]; portalBefore?: any; portalAfter?: any; finished?: number; tokens?: { calls: number; inTok: number; outTok: number };
}

const runs = new Map<string, Run>();
const listeners = new Map<string, Set<(e: any) => void>>();
const approvals = new Map<string, (ok: boolean) => void>();
let lastAudit: AuditRecord | null = null;

export const getRun = (id: string) => runs.get(id);
export const listRuns = () => [...runs.values()].sort((a, b) => b.created - a.created);
export function subscribe(id: string, fn: (e: any) => void) { let s = listeners.get(id); if (!s) listeners.set(id, (s = new Set())); s.add(fn); return () => s!.delete(fn); }
const publish = (r: Run, e: any) => { for (const fn of listeners.get(r.id) || []) fn(e); };
export function decide(id: string, ok: boolean, by: string) { const f = approvals.get(id); const r = runs.get(id); if (!f || !r?.approval) return false; r.approval.decided = true; r.approval.approved = ok; r.approval.by = by; approvals.delete(id); f(ok); return true; }

export const WORKSPACE: Workspace = {
  name: 'Rowan & Clarke Law (fictional)',
  businessDesc: 'A fictional small law firm in Ottawa, Canada: immigration (work and study permits), family law, real estate closings, small business incorporation, wills and estates. Clients write in English, French and Ukrainian.',
  slaMinutes: 15,
  contactEmail: 'intake@rowanclarke.example',
  kb: [
    { id: 'areas', title: 'Practice areas', text: 'Immigration (work permits, study permits), family law, real estate closings, small business incorporation, wills and estates. We do not take criminal defence matters.' },
    { id: 'consult', title: 'First consultation', text: 'The first consultation takes 45 minutes by video or at our Ottawa office and costs CAD 150 plus HST, credited to the first invoice if you instruct us.' },
    { id: 'hours', title: 'Office hours', text: 'Monday to Friday, 09:00 to 17:30 Toronto time.' },
    { id: 'booking', title: 'How booking works', text: 'After your enquiry we reserve a consultation slot and confirm it by email within one business day.' },
    { id: 'documents', title: 'What to prepare', text: 'For immigration bring your passport, current permit and job offer or admission letter. For real estate bring the agreement of purchase and sale.' },
  ],
};

function audit(cfg: Config, r: Run, action: string, actor: string, decision: string) {
  void (async () => {
    const rec = await appendRecord(lastAudit, {
      at: new Date().toISOString(), leadRef: crypto.createHash('sha256').update(r.enquiry.message).digest('hex').slice(0, 16),
      decision, checks: (r.triage?.checks || []).map((c) => ({ id: c.id, status: c.status })),
      models: { planner: cfg.plannerModel, vision: cfg.visionModel, ...cfg.guardModels }, promptVersion: 'desk-2026-11-03', actor, action,
    });
    lastAudit = rec;
    fs.appendFileSync(path.join(cfg.dataDir, 'audit.jsonl'), JSON.stringify({ run: r.id, ...rec }) + '\n');
  })();
}

async function portalAdmin(cfg: Config, p: string, body?: any) {
  const res = await fetch(cfg.portalOrigin + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${cfg.portalAdminKey}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`portal admin ${p} ${res.status}`);
  return res.json();
}

export function startRun(cfg: Config, enquiry: Run['enquiry'], redTeam: boolean, proxyLogSince: () => number, proxyDenials: (since: number) => string[]): Run {
  const r: Run = { id: crypto.randomBytes(6).toString('hex'), created: Date.now(), status: 'guard', redTeam, enquiry, events: [], proxyDenied: [] };
  runs.set(r.id, r);
  const emit = (e: AgentEvent) => { r.events.push(e); publish(r, { type: 'event', event: e }); };
  const set = (s: Run['status']) => { r.status = s; publish(r, { type: 'status', status: s }); };
  const u0 = { calls: usage.calls, inTok: usage.inTok, outTok: usage.outTok };
  const v = vultrClient(cfg.vultrKey);

  void (async () => {
    let sbx: Sandbox | null = null; let token = ''; const since = proxyLogSince();
    try {
      // 1. Guardrails on the enquiry
      const tr = await triage(v.guardClient, WORKSPACE, enquiry, cfg.guardModels);
      r.triage = { decision: tr.decision, checks: tr.checks, draft: tr.draft, trace: tr.trace };
      emit({ t: Date.now(), kind: 'info', msg: `Guardrails: ${tr.decision}` });
      audit(cfg, r, 'triaged', 'ixia-guard', tr.decision);
      if (tr.decision === 'block' && !redTeam) { set('blocked'); return; }
      if (tr.decision === 'hold_for_review' && !redTeam) { set('held'); emit({ t: Date.now(), kind: 'info', msg: 'Held for a person in the review queue; the agent does not run on held enquiries.' }); return; }
      if (redTeam) emit({ t: Date.now(), kind: 'info', msg: 'Red-team mode: Guardrails decision ignored and the raw enquiry goes to the planner, to test the sandbox boundary.' });

      // 2. Task token (one contact, one booking, 10 min) and portal snapshot
      r.portalBefore = await portalAdmin(cfg, '/admin/state').then((s) => ({ contacts: s.contacts, bookings: s.bookings }));
      token = (await portalAdmin(cfg, '/admin/tokens', { task: r.id })).token;
      emit({ t: Date.now(), kind: 'info', msg: 'Task token minted: one contact, one booking, expires in 10 min. It never leaves the sign-in link.' });

      // 3. Sandbox
      set('running');
      sbx = new Sandbox(); r.sandbox = { name: sbx.name };
      sbx.onLog = (m) => emit({ t: Date.now(), kind: 'info', msg: 'sandbox: ' + m.trim() });
      await sbx.start();
      emit({ t: Date.now(), kind: 'info', msg: `Sandbox ${sbx.name} started: read-only, no capabilities, 1 GB, 256 processes, internal network, proxy-only egress, ${Math.round((+process.env.SANDBOX_WALL_MS! || 120000) / 1000)} s limit.` });

      const facts: Facts = {
        name: enquiry.name || 'Unknown', email: enquiry.email, phone: enquiry.phone,
        matter: tr.draft.matterType || 'Other', summary: (tr.draft.summary || enquiry.message).slice(0, 400),
      };
      const res = await runAgent(sbx, `${cfg.portalOrigin}/login?t=${encodeURIComponent(token)}`, facts, {
        chat: v.chat, plannerModel: cfg.plannerModel, visionModel: cfg.visionModel, portalOrigin: cfg.portalOrigin, emit, redTeam, rawEnquiry: enquiry.message,
        approve: (summary, shot) => new Promise<boolean>((ok) => {
          r.approval = { summary, shot }; set('awaiting_approval');
          approvals.set(r.id, (x) => { set('running'); audit(cfg, r, x ? 'approved' : 'rejected', r.approval?.by || 'staff', x ? 'book' : 'no_booking'); ok(x); });
        }),
      });
      if (sbx.killedByTimer) set('contained');
      else set(res.booked ? 'booked' : res.reason === 'rejected by staff' ? 'rejected' : 'stopped');
    } catch (e) {
      emit({ t: Date.now(), kind: 'error', msg: String((e as Error).message || e).slice(0, 300) });
      set(sbx?.killedByTimer ? 'contained' : 'error');
    } finally {
      // 4. Teardown always
      if (sbx) { const d = await sbx.destroy(); r.sandbox = { name: sbx.name, removed: d.removed, lifetimeMs: d.lifetimeMs, killedByTimer: sbx.killedByTimer }; emit({ t: Date.now(), kind: 'info', msg: `Sandbox removed: ${d.removed ? 'yes' : 'NO'} after ${(d.lifetimeMs / 1000).toFixed(1)} s` }); }
      if (token) await portalAdmin(cfg, `/admin/tokens/${token}/revoke`, {}).then(() => emit({ t: Date.now(), kind: 'info', msg: 'Task token revoked.' })).catch(() => {});
      r.proxyDenied = proxyDenials(since);
      if (r.proxyDenied.length) emit({ t: Date.now(), kind: 'blocked', msg: `Egress proxy refused: ${[...new Set(r.proxyDenied)].join(', ')}` });
      r.portalAfter = await portalAdmin(cfg, '/admin/state').then((s) => ({ contacts: s.contacts, bookings: s.bookings })).catch(() => null);
      r.tokens = { calls: usage.calls - u0.calls, inTok: usage.inTok - u0.inTok, outTok: usage.outTok - u0.outTok };
      r.finished = Date.now();
      audit(cfg, r, 'run_finished', 'desk-controller', r.status);
      fs.appendFileSync(path.join(cfg.dataDir, 'runs.jsonl'), JSON.stringify({ ...r, events: r.events.map(({ shot, ...e }) => e), approval: r.approval ? { ...r.approval, shot: undefined } : undefined }) + '\n');
      publish(r, { type: 'finished', run: { ...r, events: undefined } });
    }
  })();
  return r;
}
