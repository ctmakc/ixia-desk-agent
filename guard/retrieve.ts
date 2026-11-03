import type { KbSnippet, ModelClient } from './types';

export interface Retrieved { snippet: KbSnippet; score: number }

// Embedding cache per process: KB snippets change rarely, enquiries never repeat.
const cache = new Map<string, number[]>();

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Multilingual dense retrieval (bge-m3): a Dutch question finds an English
// fee snippet. Falls back to token overlap when the embedding call fails, so a
// model outage degrades grounding instead of breaking intake.
export async function retrieve(llm: ModelClient, model: string, query: string, kb: KbSnippet[], k = 4)
  : Promise<{ hits: Retrieved[]; mode: 'dense' | 'lexical' }> {
  if (!kb.length) return { hits: [], mode: 'dense' };
  try {
    const missing = kb.filter((s) => !cache.has(key(model, s)));
    const texts = [query, ...missing.map((s) => `${s.title}. ${s.text}`)];
    const vecs = await llm.embed(model, texts);
    missing.forEach((s, i) => cache.set(key(model, s), vecs[i + 1]));
    const q = vecs[0];
    const hits = kb.map((s) => ({ snippet: s, score: cosine(q, cache.get(key(model, s))!) }))
      .sort((a, b) => b.score - a.score).slice(0, k);
    return { hits, mode: 'dense' };
  } catch {
    return { hits: lexical(query, kb, k), mode: 'lexical' };
  }
}

function key(model: string, s: KbSnippet) { return `${model}|${s.id}|${s.title}|${s.text}`; }

function lexical(query: string, kb: KbSnippet[], k: number): Retrieved[] {
  const toks = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const q = toks(query);
  return kb.map((s) => {
    const d = toks(`${s.title} ${s.text}`);
    let hit = 0; for (const w of q) if (d.has(w)) hit++;
    return { snippet: s, score: q.size ? hit / q.size : 0 };
  }).sort((a, b) => b.score - a.score).slice(0, k);
}
