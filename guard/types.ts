// Shared types for the IXIA Guardrails pipeline.
// Pure TypeScript: no Node or Workers globals, so the same code runs inside the
// IXIA Next.js server, a Cloudflare Pages Function and the Node eval runner.

export type Lang = 'en' | 'nl' | 'de' | 'fr' | 'es' | 'uk';

export interface Enquiry {
  name?: string;
  email?: string;
  phone?: string;
  message: string;
  channel?: string; // form | email | chat | missed_call | api
}

export interface KbSnippet {
  id: string;      // stable id the model cites, e.g. "fees"
  title: string;
  text: string;
}

export interface Workspace {
  name: string;
  businessDesc: string;
  slaMinutes: number;
  bookingUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  kb: KbSnippet[];
}

export type CheckStatus = 'pass' | 'review' | 'block' | 'info';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  source: 'rule' | 'llama-guard' | 'verifier' | 'pipeline';
}

export type Decision = 'auto_send' | 'hold_for_review' | 'block';

export interface Draft {
  lang: string;
  matterType: string;
  urgency: 'low' | 'medium' | 'high';
  summary: string;
  reply: string;
  citations: string[];
  raw?: string;
}

export interface TraceStep {
  step: string;
  model?: string;
  ms: number;
  note?: string;
}

export interface TriageResult {
  decision: Decision;
  lang: Lang;
  draft: Draft;
  // What the enquirer receives right now. For auto_send it is the grounded
  // draft; otherwise a safe acknowledgement in the enquirer's language while
  // the draft waits for a human.
  outgoing: string;
  checks: Check[];
  retrieved: { id: string; title: string; score: number }[];
  trace: TraceStep[];
  models: Record<string, string>;
  promptVersion: string;
  createdAt: string;
}

// Minimal model interface. Adapters exist for the Workers AI binding (edge) and
// the Workers AI REST API (Node: IXIA server, eval runner).
export interface ModelClient {
  chat(model: string, messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
       opts?: { maxTokens?: number; json?: boolean; reasoningEffort?: 'low' | 'medium' | 'high' }): Promise<string>;
  embed(model: string, texts: string[]): Promise<number[][]>;
  guard(model: string, messages: { role: 'user' | 'assistant'; content: string }[]): Promise<string>;
}

export interface GuardModels {
  draft: string;
  verifier: string;
  safety: string;
  embed: string;
}

export const DEFAULT_MODELS: GuardModels = {
  draft: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  verifier: '@cf/openai/gpt-oss-120b',
  safety: '@cf/meta/llama-guard-3-8b',
  embed: '@cf/baai/bge-m3',
};
