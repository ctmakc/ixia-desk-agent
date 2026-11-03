// Vultr Serverless Inference client (OpenAI-compatible, https://api.vultrinference.com/v1).
// Every model call of the agent and of Guardrails goes through here, on the controller,
// outside any sandbox. The sandbox never sees this key.
import type { ModelClient } from '../guard/types';

export const VULTR_BASE = process.env.VULTR_INFERENCE_BASE || 'https://api.vultrinference.com/v1';

export interface Usage { calls: number; inTok: number; outTok: number; byModel: Record<string, { calls: number; inTok: number; outTok: number; ms: number }> }
export const usage: Usage = { calls: 0, inTok: 0, outTok: 0, byModel: {} };

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

export function textOf(r: any): string {
  const c = r?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => p?.text || '').join('');
  return '';
}

export function vultrClient(key: string, base = VULTR_BASE) {
  const post = async (path: string, body: any, timeoutMs = 60_000) => {
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const j: any = await res.json();
        const m = body.model || 'unknown';
        const u = j.usage || {};
        usage.calls++; usage.inTok += u.prompt_tokens || 0; usage.outTok += u.completion_tokens || 0;
        const b = (usage.byModel[m] ||= { calls: 0, inTok: 0, outTok: 0, ms: 0 });
        b.calls++; b.inTok += u.prompt_tokens || 0; b.outTok += u.completion_tokens || 0; b.ms += Date.now() - t0;
        return j;
      }
      if (attempt < 2 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      throw new Error(`vultr ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  };

  // Several catalogue models reason before answering; the reasoning counts against max_tokens and can
  // leave the answer empty. Ask for no reasoning, keep headroom, and retry once with a larger budget.
  async function chat(model: string, messages: ChatMsg[], opts: { maxTokens?: number; json?: boolean; temperature?: number } = {}) {
    const want = opts.maxTokens ?? 800;
    for (const budget of [want + 512, want + 3072]) {
      const r = await post('/chat/completions', {
        model, messages, max_tokens: budget, temperature: opts.temperature ?? 0.2, reasoning_effort: 'none',
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      });
      const out = stripThinking(textOf(r));
      if (out || r?.choices?.[0]?.finish_reason !== 'length') return out;
    }
    return '';
  }

  const guardClient: ModelClient = {
    chat: (model, messages, opts) => chat(model, messages, { maxTokens: opts?.maxTokens, json: opts?.json }),
    async embed(model, texts) {
      const r: any = await post('/embeddings', { model, input: texts });
      return r.data.map((d: any) => d.embedding);
    },
    // Guardrails expects Llama Guard style output ("safe" | "unsafe\nS6,S7").
    // The safety model on Vultr is asked for that shape directly.
    async guard(model, messages) {
      const convo = messages.map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
      const sys = 'You are a content safety classifier for a law firm inbox. Classify the Agent reply in the conversation. '
        + 'Answer with exactly "safe", or "unsafe" followed by a newline and comma-separated Llama Guard 3 category codes '
        + '(S1 violent crimes, S2 non-violent crimes, S3 sex crimes, S4 child exploitation, S5 defamation, S6 specialized legal/medical/financial advice, '
        + 'S7 privacy, S8 IP, S9 weapons, S10 hate, S11 self-harm, S12 sexual content, S13 elections, S14 code interpreter abuse).';
      return chat(model, [{ role: 'system', content: sys }, { role: 'user', content: convo }], { maxTokens: 30, temperature: 0 });
    },
  };
  return { chat, post, guardClient };
}

// Some reasoning models put their chain of thought in <think> blocks.
export function stripThinking(s: string) { return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

export function parseJsonLoose<T = any>(s: string): T {
  const t = stripThinking(s).replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no JSON in model output: ' + t.slice(0, 120));
}
