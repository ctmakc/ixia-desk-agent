// Sandbox lifecycle: one container per task, keyless, proxy-only network, hard limits.
// Teardown always runs: on finish, on error, on wall-clock timeout.
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import crypto from 'node:crypto';

export const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || 'ixia-desk-sandbox:dev';
export const SANDBOX_NET = process.env.SANDBOX_NET || 'desk-sbx';      // docker network --internal
export const PROXY_ADDR = process.env.SANDBOX_PROXY || 'http://desk-proxy:3128';
export const WALL_CLOCK_MS = +(process.env.SANDBOX_WALL_MS || 120_000);

export interface StepResult {
  ok: boolean; op?: string; ms?: number; error?: string; url?: string; title?: string; text?: string;
  fields?: { label: string; id: string; tag: string; value?: string; options?: string[] }[];
  buttons?: { text: string; id: string }[]; links?: { text: string; href: string }[];
  screenshot?: string | null;
}

const run = (args: string[]) => new Promise<string>((ok) => execFile('docker', args, { timeout: 20_000 }, (_e, out) => ok(String(out || ''))));

export const SANDBOX_FLAGS = [
  '--network', SANDBOX_NET, '--read-only', '--tmpfs', '/tmp:rw,size=256m', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--memory', '1g', '--memory-swap', '1g', '--pids-limit', '256', '--cpus', '1.5',
];

export class Sandbox {
  readonly name = 'desk-sbx-' + crypto.randomBytes(5).toString('hex');
  private proc!: ChildProcessWithoutNullStreams;
  private lines: string[] = [];
  private waiters: ((l: string) => void)[] = [];
  private timer?: NodeJS.Timeout;
  private closed = false;
  killedByTimer = false;
  startedAt = 0;
  onLog: (msg: string) => void = () => {};

  async start(): Promise<void> {
    this.startedAt = Date.now();
    const args = ['run', '-i', '--rm', '--name', this.name, ...SANDBOX_FLAGS,
      '-e', `PROXY=${PROXY_ADDR}`, '-e', 'HOME=/tmp', SANDBOX_IMAGE];
    this.proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: this.proc.stdout }).on('line', (l) => {
      const w = this.waiters.shift(); if (w) w(l); else this.lines.push(l);
    });
    this.proc.stderr.on('data', (d) => this.onLog(String(d).slice(0, 300)));
    this.proc.on('exit', () => { this.closed = true; for (const w of this.waiters.splice(0)) w(JSON.stringify({ ok: false, error: 'sandbox exited' })); });
    this.timer = setTimeout(() => { this.killedByTimer = true; this.onLog(`wall-clock limit ${WALL_CLOCK_MS / 1000}s reached`); void this.destroy(); }, WALL_CLOCK_MS);
    const first = await this.next(60_000);
    if (!JSON.parse(first).ready) throw new Error('sandbox did not start');
  }

  private next(timeoutMs: number): Promise<string> {
    const l = this.lines.shift(); if (l !== undefined) return Promise.resolve(l);
    if (this.closed) return Promise.resolve(JSON.stringify({ ok: false, error: 'sandbox exited' }));
    return new Promise((ok) => {
      const t = setTimeout(() => ok(JSON.stringify({ ok: false, error: `step timeout ${timeoutMs} ms` })), timeoutMs);
      this.waiters.push((x) => { clearTimeout(t); ok(x); });
    });
  }

  async step(s: Record<string, unknown>, timeoutMs = 30_000): Promise<StepResult> {
    if (this.closed) return { ok: false, error: 'sandbox exited' };
    this.proc.stdin.write(JSON.stringify(s) + '\n');
    return JSON.parse(await this.next(timeoutMs));
  }

  async destroy(): Promise<{ removed: boolean; lifetimeMs: number }> {
    if (this.timer) clearTimeout(this.timer);
    try { this.proc?.stdin.end(); } catch {}
    await run(['rm', '-f', this.name]);
    const left = (await run(['ps', '-a', '--filter', `name=${this.name}`, '-q'])).trim();
    this.closed = true;
    return { removed: left === '', lifetimeMs: Date.now() - this.startedAt };
  }
}
