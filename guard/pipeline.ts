import type { Check, Decision, Draft, Enquiry, GuardModels, ModelClient, TriageResult, TraceStep, Workspace } from './types';
import { DEFAULT_MODELS } from './types';
import { AI_DISCLOSURE, GREETING_ANON, GREETING_NAMED, SAFE_ACK, detectLang, fill, normalizeLang } from './lang';
import { foreignContacts, promisesOutcome, promptInjection, specialCategories, ungroundedNumbers, urgent } from './detectors';
import { retrieve } from './retrieve';
import { PROMPT_VERSION, draftMessages, parseJson, verifierMessages } from './prompts';

// Llama Guard 3 hazard taxonomy. S6 (specialized advice) and S7 (privacy) are
// the everyday risks of a law-firm inbox: a human reviews. Anything else from
// the safety model blocks the draft outright.
const GUARD_CATEGORIES: Record<string, string> = {
  S1: 'violent crimes', S2: 'non-violent crimes', S3: 'sex-related crimes', S4: 'child sexual exploitation',
  S5: 'defamation', S6: 'specialized advice', S7: 'privacy', S8: 'intellectual property',
  S9: 'indiscriminate weapons', S10: 'hate', S11: 'suicide & self-harm', S12: 'sexual content',
  S13: 'elections', S14: 'code interpreter abuse',
};
const REVIEW_CATEGORIES = new Set(['S6', 'S7']);
const VERIFIER_TIMEOUT_MS = 25_000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, bad) => {
    const t = setTimeout(() => bad(new Error(`timeout ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); bad(e); });
  });
}
const SENSITIVE = new Set(['health', 'criminal', 'migration_status', 'minor', 'safety_risk', 'religion_orientation_ethnicity', 'trade_union']);

async function timed<T>(trace: TraceStep[], step: string, model: string | undefined, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { return await fn(); } finally { trace.push({ step, model, ms: Date.now() - t0 }); }
}

export async function triage(llm: ModelClient, ws: Workspace, enquiry: Enquiry,
  models: GuardModels = DEFAULT_MODELS): Promise<TriageResult> {
  const trace: TraceStep[] = [];
  const checks: Check[] = [];
  const message = (enquiry.message || '').slice(0, 4000);
  const e: Enquiry = { ...enquiry, message };

  // 1. Inbound checks (deterministic)
  const heuristicLang = detectLang(message);
  const injected = promptInjection(message);
  checks.push({ id: 'prompt_injection', label: 'Instructions aimed at the AI in the enquiry', source: 'rule',
    status: injected ? 'review' : 'pass', detail: injected ? 'Enquiry contains text that tries to steer the model.' : 'None found.' });
  const special = specialCategories(message);
  checks.push({ id: 'special_category_data', label: 'Sensitive personal data (GDPR Art. 9 and similar)', source: 'rule',
    status: special.length ? 'review' : 'pass',
    detail: special.length ? `Mentions: ${special.join(', ')}. A human answers; the auto-reply repeats none of it.` : 'None found.' });

  // 2. Grounding: retrieve the workspace knowledge relevant to this enquiry
  const { hits, mode } = await timed(trace, 'retrieve', models.embed, () => retrieve(llm, models.embed, message, ws.kb, 4));
  if (mode === 'lexical') trace[trace.length - 1].note = 'embedding failed, lexical fallback';
  const kbHits = hits.filter((h) => h.score > 0).map((h) => h.snippet);
  // Workspace settings the reply may always state: the SLA promise and how to
  // reach the firm. They come from configuration, not from retrieval.
  const grounding = [...kbHits, ...systemFacts(ws).filter((f) => !kbHits.some((h) => h.id === f.id))];

  // 3. Draft
  let draft: Draft = { lang: heuristicLang, matterType: 'general enquiry', urgency: 'medium', summary: message.slice(0, 160), reply: '', citations: [] };
  let draftOk = false;
  try {
    const raw = await timed(trace, 'draft', models.draft, () =>
      llm.chat(models.draft, draftMessages(ws, e, grounding, heuristicLang), { maxTokens: 700, json: true }));
    const j = parseJson<any>(raw);
    if (j && typeof j.reply === 'string' && j.reply.trim()) {
      draft = {
        lang: String(j.lang || heuristicLang),
        matterType: String(j.matter_type || 'general enquiry').slice(0, 60),
        urgency: ['low', 'medium', 'high'].includes(j.urgency) ? j.urgency : 'medium',
        summary: String(j.summary || '').slice(0, 200),
        reply: String(j.reply).slice(0, 2000),
        citations: Array.isArray(j.citations) ? j.citations.map(String).slice(0, 8) : [],
        raw,
      };
      draftOk = true;
      const modelSensitive: string[] = Array.isArray(j.sensitive_data) ? j.sensitive_data.map(String).filter((c: string) => SENSITIVE.has(c)) : [];
      const extra = modelSensitive.filter((c) => !special.includes(c));
      if (extra.length) {
        const c = checks.find((x) => x.id === 'special_category_data')!;
        special.push(...extra);
        c.status = 'review'; c.source = special.length > extra.length ? 'rule' : 'verifier';
        c.detail = `Mentions: ${special.join(', ')} (${extra.join(', ')} found by the draft model). A human answers; the auto-reply repeats none of it.`;
      }
    }
  } catch (err: any) {
    trace.push({ step: 'draft_error', ms: 0, note: String(err?.message || err).slice(0, 200) });
  }
  checks.push({ id: 'draft_ok', label: 'Draft produced as valid JSON', source: 'pipeline',
    status: draftOk ? 'pass' : 'review', detail: draftOk ? 'OK.' : 'Model call failed or returned malformed JSON.' });

  const lang = normalizeLang(draft.lang, heuristicLang);
  const reply = draft.reply;

  // 4. Outbound checks: safety model, verifier model and deterministic rules, in parallel
  if (draftOk) {
    const ground = grounding.map((s) => `${s.title} ${s.text}`).join('\n');
    const contactsAllowed = [ground, ws.contactEmail, ws.contactPhone, ws.bookingUrl].filter(Boolean).join('\n');

    const [guardOut, verOut] = await Promise.all([
      timed(trace, 'safety', models.safety, () =>
        llm.guard(models.safety, [{ role: 'user', content: message }, { role: 'assistant', content: reply }])).catch((x) => `error: ${x}`),
      // The verifier occasionally queues for 30 s+. Past the deadline the draft
      // is held (the client already gets the safe acknowledgement), so a slow
      // model never delays the first reply.
      timed(trace, 'verify', models.verifier, () => withTimeout(
        llm.chat(models.verifier, verifierMessages(ws, e, reply, grounding), { maxTokens: 1500, json: true, reasoningEffort: 'low' }),
        VERIFIER_TIMEOUT_MS)).catch((x) => `error: ${x}`),
    ]);

    // Llama Guard
    const g = String(guardOut).trim().toLowerCase();
    if (g.startsWith('error')) {
      checks.push({ id: 'safety_model', label: 'Llama Guard 3 safety classification', source: 'llama-guard', status: 'review', detail: 'Safety model unavailable; held for a human.' });
    } else if (g.includes('unsafe')) {
      const cats = (String(guardOut).match(/S\d{1,2}/g) || []);
      const blocking = cats.filter((c) => !REVIEW_CATEGORIES.has(c));
      checks.push({ id: 'safety_model', label: 'Llama Guard 3 safety classification', source: 'llama-guard',
        status: blocking.length ? 'block' : 'review',
        detail: `Unsafe: ${cats.map((c) => `${c} ${GUARD_CATEGORIES[c] || ''}`.trim()).join(', ') || 'unspecified'}.` });
    } else {
      checks.push({ id: 'safety_model', label: 'Llama Guard 3 safety classification', source: 'llama-guard', status: 'pass', detail: 'Safe.' });
    }

    // Verifier
    const v = parseJson<any>(String(verOut));
    if (!v) {
      checks.push({ id: 'verifier', label: 'Grounding verifier', source: 'verifier', status: 'review', detail: 'Verifier unavailable or malformed; held for a human.' });
    } else {
      const claims: string[] = Array.isArray(v.unsupported_claims) ? v.unsupported_claims.map(String).filter(Boolean) : [];
      checks.push({ id: 'unsupported_claims', label: 'Every fact backed by the knowledge base', source: 'verifier',
        status: claims.length ? 'review' : 'pass', detail: claims.length ? `Not in KB: ${claims.slice(0, 4).join('; ')}` : 'All statements supported.' });
      checks.push({ id: 'specific_advice', label: 'No advice on the person’s own case', source: 'verifier',
        status: v.gives_specific_advice ? 'review' : 'pass', detail: v.gives_specific_advice ? String(v.note || 'Draft advises on the case.') : 'None.' });
      const promise = !!v.promises_outcome || promisesOutcome(reply);
      checks.push({ id: 'outcome_promise', label: 'No promised outcome', source: v.promises_outcome ? 'verifier' : 'rule',
        status: promise ? 'block' : 'pass', detail: promise ? 'Draft promises or implies a result.' : 'None.' });
      checks.push({ id: 'repeats_sensitive', label: 'Does not echo sensitive details', source: 'verifier',
        status: v.repeats_sensitive ? 'review' : 'pass', detail: v.repeats_sensitive ? 'Draft repeats sensitive details from the enquiry.' : 'None.' });
    }

    // Deterministic
    const nums = ungroundedNumbers(reply, ground);
    checks.push({ id: 'grounded_numbers', label: 'Prices and figures match the knowledge base', source: 'rule',
      status: nums.length ? 'review' : 'pass', detail: nums.length ? `Figures not in retrieved KB: ${nums.join(', ')}` : 'All figures grounded (or none quoted).' });
    const contacts = foreignContacts(reply, contactsAllowed);
    checks.push({ id: 'foreign_contacts', label: 'No invented phone numbers, e-mails or links', source: 'rule',
      status: contacts.length ? 'block' : 'pass', detail: contacts.length ? `Not published by the firm: ${contacts.join(', ')}` : 'None.' });
    const validIds = new Set(grounding.map((s) => s.id).concat(ws.kb.map((s) => s.id)));
    const badCites = draft.citations.filter((c) => !validIds.has(c));
    checks.push({ id: 'citations', label: 'Citations point to real KB entries', source: 'rule',
      status: badCites.length ? 'review' : 'pass', detail: badCites.length ? `Unknown ids: ${badCites.join(', ')}` : (draft.citations.length ? `Cites ${draft.citations.join(', ')}` : 'No KB facts used.') });
    const replyLang = detectLang(reply);
    const sameLang = replyLang === lang || reply.length < 60;
    checks.push({ id: 'language_match', label: 'Reply in the enquirer’s language', source: 'rule',
      status: sameLang ? 'pass' : 'review', detail: sameLang ? `Language: ${lang}.` : `Enquiry ${lang}, reply looks like ${replyLang}.` });
  }

  const isUrgent = urgent(message) || draft.urgency === 'high';
  checks.push({ id: 'priority', label: 'Urgency', source: 'rule', status: 'info',
    detail: isUrgent ? 'Urgent wording (hearing, deadline, today): staff alerted first.' : `Urgency ${draft.urgency}.` });

  // 5. Decision
  const decision: Decision = checks.some((c) => c.status === 'block') ? 'block'
    : checks.some((c) => c.status === 'review') ? 'hold_for_review' : 'auto_send';

  const first = (e.name || '').trim().split(/\s+/)[0];
  const disclosure = fill(AI_DISCLOSURE[lang], { firm: ws.name });
  const outgoing = decision === 'auto_send'
    ? `${reply.trim()}${reply.includes(ws.name) ? '' : `\n\n— ${ws.name}`}\n\n${disclosure}`
    : `${fill(SAFE_ACK[lang], {
      greeting: first ? fill(GREETING_NAMED[lang], { first }) : GREETING_ANON[lang],
      firm: ws.name, sla: ws.slaMinutes,
    })}\n\n— ${ws.name}\n\n${disclosure}`;

  return {
    decision, lang, draft: { ...draft, urgency: isUrgent ? 'high' : draft.urgency }, outgoing, checks,
    retrieved: hits.map((h) => ({ id: h.snippet.id, title: h.snippet.title, score: Math.round(h.score * 1000) / 1000 })),
    trace, models: { ...models }, promptVersion: PROMPT_VERSION, createdAt: new Date().toISOString(),
  };
}

function systemFacts(ws: Workspace) {
  const facts = [{ id: 'sla', title: 'Response promise', text: `A member of the ${ws.name} team replies personally within ${ws.slaMinutes} minutes during business hours.` }];
  const contact = [ws.contactEmail && `e-mail ${ws.contactEmail}`, ws.contactPhone && `phone ${ws.contactPhone}`, ws.bookingUrl && `online booking ${ws.bookingUrl}`].filter(Boolean).join(', ');
  if (contact) facts.push({ id: 'contact', title: 'How to reach us', text: `Contact: ${contact}.` });
  return facts;
}
