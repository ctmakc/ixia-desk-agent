// Sandbox step runner. Talks to the controller over stdin/stdout only (JSON lines).
// The browser's only network exit is the egress proxy given in PROXY.
// Allowed ops: goto, fill, select, click, screenshot, read. Anything else is refused here too.
import { chromium } from 'playwright-core';
import readline from 'node:readline';

const PROXY = process.env.PROXY || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  proxy: PROXY ? { server: PROXY } : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, acceptDownloads: false });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);

async function state() {
  const shot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null);
  const view = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const lab = (e) => (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim()) || e.getAttribute('aria-label') || e.name || '';
    return {
      title: document.title,
      text: document.body ? document.body.innerText.slice(0, 1500) : '',
      fields: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).map((e) => ({ label: lab(e), id: e.id, tag: e.tagName.toLowerCase(), value: e.value?.slice(0, 80), options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text) : undefined })),
      buttons: [...document.querySelectorAll('button,input[type=submit]')].filter(vis).map((e) => ({ text: (e.textContent || e.value || '').trim().slice(0, 60), id: e.id })),
      links: [...document.querySelectorAll('a[href]')].filter(vis).map((e) => ({ text: e.textContent.trim().slice(0, 60), href: e.getAttribute('href') })),
    };
  }).catch(() => ({}));
  return { url: page.url(), ...view, screenshot: shot ? shot.toString('base64') : null };
}

function target(s) {
  if (s.id) return page.locator(`[id="${String(s.id).replace(/"/g, "")}"]`);
  if (s.label) return page.getByLabel(s.label, { exact: false }).first();
  if (s.text) return page.getByRole('button', { name: s.text }).or(page.getByRole('link', { name: s.text })).first();
  throw new Error('step needs id, label or text');
}

const rl = readline.createInterface({ input: process.stdin });
out({ ready: true });
for await (const line of rl) {
  let s; try { s = JSON.parse(line); } catch { out({ ok: false, error: 'bad json' }); continue; }
  const t0 = Date.now();
  try {
    if (s.op === 'goto') { await page.goto(s.url, { waitUntil: 'domcontentloaded' }); }
    else if (s.op === 'fill') { await target(s).fill(String(s.value ?? '')); }
    else if (s.op === 'select') { await target(s).selectOption({ label: String(s.value) }); }
    else if (s.op === 'click') { await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), target(s).click()]); await page.waitForTimeout(300); }
    else if (s.op === 'screenshot' || s.op === 'read') { /* state only */ }
    else if (s.op === 'quit') { out({ ok: true, bye: true }); break; }
    else throw new Error(`op not allowed: ${s.op}`);
    out({ ok: true, op: s.op, ms: Date.now() - t0, ...(await state()) });
  } catch (e) {
    out({ ok: false, op: s.op, ms: Date.now() - t0, error: String(e.message || e).split('\n')[0].slice(0, 300), ...(await state()) });
  }
}
await browser.close().catch(() => {});
process.exit(0);
