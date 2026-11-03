// Tamper-evident audit trail. Every triage decision becomes a record whose
// hash covers the previous record's hash, so editing or deleting any past
// decision breaks verification of every later one.

export interface AuditRecord {
  seq: number;
  at: string;
  leadRef: string;          // hash of the enquiry, never the raw text
  decision: string;
  checks: { id: string; status: string }[];
  models: Record<string, string>;
  promptVersion: string;
  actor: string;            // "ixia-guard" or the staff user who approved/edited
  action: string;           // triaged | approved | edited_and_sent | rejected
  prevHash: string;
  hash: string;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canonical(r: Omit<AuditRecord, 'hash'>): string {
  return JSON.stringify([r.seq, r.at, r.leadRef, r.decision, r.checks.map((c) => [c.id, c.status]),
    Object.entries(r.models).sort(), r.promptVersion, r.actor, r.action, r.prevHash]);
}

export const GENESIS = '0'.repeat(64);

export async function appendRecord(prev: AuditRecord | null, r: Omit<AuditRecord, 'seq' | 'prevHash' | 'hash'>)
  : Promise<AuditRecord> {
  const base = { ...r, seq: prev ? prev.seq + 1 : 1, prevHash: prev ? prev.hash : GENESIS };
  return { ...base, hash: await sha256(canonical(base)) };
}

export async function verifyChain(records: AuditRecord[]): Promise<{ ok: boolean; brokenAt?: number }> {
  let prev = GENESIS;
  for (const r of records) {
    const { hash, ...rest } = r;
    if (r.prevHash !== prev || (await sha256(canonical(rest))) !== hash) return { ok: false, brokenAt: r.seq };
    prev = hash;
  }
  return { ok: true };
}
