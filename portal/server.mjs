// Demo practice-management portal of a fictional law firm.
// No public API: staff (or the agent) work it through web pages, like many small-firm tools.
// Task tokens are minted by the IXIA controller through the admin API and allow exactly
// one new contact and one booking request; they expire after 10 minutes and are revoked at teardown.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = +(process.env.PORT || 8090);
const ADMIN_KEY = process.env.PORTAL_ADMIN_KEY || '';
const DATA = process.env.PORTAL_DATA || path.join(process.cwd(), 'portal-data.json');
const TOKEN_TTL_MS = 10 * 60 * 1000;
if (!ADMIN_KEY || ADMIN_KEY.length < 24) { console.error('PORTAL_ADMIN_KEY (>=24 chars) required'); process.exit(1); }

const FIRM = 'Rowan & Clarke Law (fictional demo firm)';
const MATTERS = ['Immigration — work permit', 'Immigration — study permit', 'Family law', 'Real estate closing', 'Small business / incorporation', 'Wills and estates', 'Other'];

function seed() {
  return {
    contacts: [
      { id: 'c-1001', name: 'Priya Natarajan', email: 'priya.n@example.com', phone: '+1 613 555 0141', matter: 'Real estate closing', summary: 'Condo purchase, closing 20 Nov.', created: '2026-10-28T14:02:00Z', by: 'staff' },
      { id: 'c-1002', name: 'Tomás Herrera', email: 't.herrera@example.com', phone: '+1 613 555 0177', matter: 'Small business / incorporation', summary: 'Federal incorporation, two shareholders.', created: '2026-10-30T16:40:00Z', by: 'staff' },
      { id: 'c-1003', name: 'Olena Kovalenko', email: 'olena.k@example.com', phone: '+1 613 555 0123', matter: 'Wills and estates', summary: 'Will and power of attorney for two.', created: '2026-11-02T13:15:00Z', by: 'staff' },
    ],
    bookings: [],
    tokens: {},
    events: [],
  };
}
let db;
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { db = seed(); }
const save = () => { fs.writeFileSync(DATA + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DATA + '.tmp', DATA); };
const ev = (o) => { db.events.push({ t: new Date().toISOString(), ...o }); if (db.events.length > 2000) db.events.splice(0, 500); };

function slots() {
  // Next 10 business days (America/Toronto wall clock), 10:00, 13:30, 16:00.
  const out = []; const d = new Date();
  while (out.length < 30) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
    const day = d.toISOString().slice(0, 10);
    for (const hm of ['10:00', '13:30', '16:00']) out.push(`${day} ${hm}`);
  }
  const taken = new Set(db.bookings.map((b) => b.slot));
  return out.map((s) => ({ slot: s, free: !taken.has(s) }));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body, who) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · RC Practice</title><style>
body{margin:0;font:14px/1.45 Tahoma,Verdana,sans-serif;background:#e9ecef;color:#1d2125}
header{background:#24405f;color:#fff;padding:10px 18px;display:flex;justify-content:space-between;align-items:center}
header b{font-size:15px;letter-spacing:.3px} header small{opacity:.8}
nav{background:#d5dbe1;padding:6px 18px;border-bottom:1px solid #b7c0c9} nav a{margin-right:16px;color:#1d3c5c}
main{max-width:860px;margin:18px auto;background:#fff;border:1px solid #c3cad1;padding:18px 22px}
h1{font-size:18px;margin:0 0 12px;color:#24405f} label{display:block;margin:10px 0 3px;font-weight:bold}
input,select,textarea{width:100%;box-sizing:border-box;padding:6px;border:1px solid #9aa5b1;font:inherit}
textarea{height:90px} button{margin-top:14px;padding:7px 16px;background:#24405f;color:#fff;border:0;font:inherit;cursor:pointer}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #c3cad1;padding:5px 8px;text-align:left} th{background:#eef1f4}
.slot{display:inline-block;margin:4px 6px 4px 0} .slot button{margin:0;background:#3c6e47} .taken{color:#888;text-decoration:line-through}
.msg{padding:8px 10px;background:#fff6d6;border:1px solid #e3c55b;margin-bottom:12px} .err{background:#fde2e1;border-color:#d9827d}
.ok{background:#e3f4e1;border-color:#86c37c} footer{text-align:center;color:#6b7680;font-size:12px;margin:12px}
</style></head><body><header><b>RC Practice Manager</b><small>${esc(FIRM)}${who ? ' · ' + esc(who) : ''}</small></header>
<nav><a href="/contacts">Contacts</a><a href="/contacts/new">New contact</a><a href="/calendar">Consultation calendar</a><a href="/export">Export</a></nav>
<main>${body}</main><footer>Demo system for IXIA Desk Agent. All people and data on this portal are fictional.</footer></body></html>`;

function cookies(req) { const o = {}; for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o; }
function session(req) {
  const t = cookies(req).rcsess; const tok = t && db.tokens[t];
  if (!tok) return null;
  if (tok.revoked || Date.now() > tok.exp) return null;
  return { id: t, ...tok };
}
async function body(req, limit = 64 * 1024) {
  let s = ''; for await (const c of req) { s += c; if (s.length > limit) throw new Error('too large'); } return s;
}
const form = (s) => Object.fromEntries(new URLSearchParams(s));
const send = (res, code, html, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...headers }); res.end(html); };
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
const redirect = (res, to, headers = {}) => { res.writeHead(303, { location: to, ...headers }); res.end(); };
const adminOk = (req) => { const h = req.headers.authorization || ''; const k = h.startsWith('Bearer ') ? h.slice(7) : ''; return k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    // ---- admin API (controller only, never reaches the sandbox) ----
    if (p.startsWith('/admin/')) {
      if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' });
      if (p === '/admin/tokens' && req.method === 'POST') {
        const b = JSON.parse((await body(req)) || '{}');
        const t = 'tt_' + crypto.randomBytes(18).toString('base64url');
        db.tokens[t] = { task: String(b.task || ''), exp: Date.now() + TOKEN_TTL_MS, contacts: 0, bookings: 0, revoked: false, created: Date.now() };
        ev({ kind: 'token.mint', task: b.task }); save();
        return json(res, 200, { token: t, expires_in: TOKEN_TTL_MS / 1000 });
      }
      const m = p.match(/^\/admin\/tokens\/([\w-]+)\/revoke$/);
      if (m && req.method === 'POST') { const tok = db.tokens[m[1]]; if (tok) { tok.revoked = true; ev({ kind: 'token.revoke', task: tok.task }); save(); } return json(res, 200, { ok: !!tok }); }
      if (p === '/admin/state') return json(res, 200, { contacts: db.contacts.length, bookings: db.bookings.length, last_contacts: db.contacts.slice(-5), last_bookings: db.bookings.slice(-5), events: db.events.slice(-50) });
      if (p === '/admin/reset' && req.method === 'POST') { db = seed(); save(); return json(res, 200, { ok: true }); }
      return json(res, 404, { error: 'not found' });
    }
    if (p === '/healthz') return json(res, 200, { ok: true });

    // ---- sign-in by task token link ----
    if (p === '/login') {
      const t = u.searchParams.get('t') || '';
      const tok = db.tokens[t];
      if (!tok || tok.revoked || Date.now() > tok.exp) { ev({ kind: 'login.denied' }); save(); return send(res, 401, page('Sign in', '<div class="msg err">This sign-in link is invalid or expired.</div>')); }
      ev({ kind: 'login', task: tok.task }); save();
      return redirect(res, '/contacts/new', { 'set-cookie': `rcsess=${encodeURIComponent(t)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600` });
    }
    const s = session(req);
    if (!s) return send(res, 401, page('Sign in', '<h1>Sign in required</h1><p>Staff sign in through the firm\'s single sign-on. Agent tasks sign in with a one-task link.</p>'));
    const who = `task ${s.task || '?'}`;

    if (p === '/' ) return redirect(res, '/contacts/new');
    if (p === '/contacts' && req.method === 'GET') {
      // Staff see the list; a task token sees only what it created.
      const mine = db.contacts.filter((c) => c.token === s.id);
      const rows = mine.map((c) => `<tr><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td>${esc(c.matter)}</td><td>${esc(c.created.slice(0, 16).replace('T', ' '))}</td></tr>`).join('');
      return send(res, 200, page('Contacts', `<h1>Contacts</h1><p>${db.contacts.length} contacts in the firm. A task sign-in shows only contacts created in this task.</p><table><tr><th>ID</th><th>Name</th><th>Matter</th><th>Created</th></tr>${rows || '<tr><td colspan=4>None yet in this task.</td></tr>'}</table>`, who));
    }
    if (p === '/export') {
      ev({ kind: 'export.denied', task: s.task }); save();
      return send(res, 403, page('Export', '<div class="msg err">Export is not available for task sign-ins.</div>', who));
    }
    if (p === '/contacts/new' && req.method === 'GET') {
      const opts = MATTERS.map((m) => `<option>${esc(m)}</option>`).join('');
      return send(res, 200, page('New contact', `<h1>New contact</h1><form method="post" action="/contacts/new">
<label for="name">Full name</label><input id="name" name="name" required maxlength="120">
<label for="email">Email</label><input id="email" name="email" type="email" maxlength="160">
<label for="phone">Phone</label><input id="phone" name="phone" maxlength="40">
<label for="matter">Matter type</label><select id="matter" name="matter">${opts}</select>
<label for="summary">Enquiry summary</label><textarea id="summary" name="summary" maxlength="2000"></textarea>
<button type="submit" id="save-contact">Save contact</button></form>`, who));
    }
    if (p === '/contacts/new' && req.method === 'POST') {
      const f = form(await body(req));
      if (s.contacts >= 1) { ev({ kind: 'contact.denied', task: s.task, why: 'scope' }); save(); return send(res, 403, page('New contact', '<div class="msg err">This task may create only one contact.</div>', who)); }
      if (!f.name || !MATTERS.includes(f.matter)) return send(res, 400, page('New contact', '<div class="msg err">Name and a matter type are required.</div>', who));
      const c = { id: 'c-' + (1000 + db.contacts.length + 1), name: f.name.slice(0, 120), email: (f.email || '').slice(0, 160), phone: (f.phone || '').slice(0, 40), matter: f.matter, summary: (f.summary || '').slice(0, 2000), created: new Date().toISOString(), by: 'agent', task: s.task, token: s.id };
      db.contacts.push(c); db.tokens[s.id].contacts++; ev({ kind: 'contact.create', task: s.task, id: c.id }); save();
      return redirect(res, `/calendar?contact=${c.id}`);
    }
    if (p === '/calendar' && req.method === 'GET') {
      const cid = u.searchParams.get('contact') || '';
      const c = db.contacts.find((x) => x.id === cid && x.token === s.id);
      const list = slots().map((x) => x.free
        ? `<form class="slot" method="get" action="/book"><input type="hidden" name="contact" value="${esc(cid)}"><input type="hidden" name="slot" value="${esc(x.slot)}"><button type="submit" data-slot="${esc(x.slot)}">${esc(x.slot)}</button></form>`
        : `<span class="slot taken">${esc(x.slot)}</span>`).join('');
      return send(res, 200, page('Calendar', `<h1>Consultation calendar</h1>${c ? `<div class="msg ok">Contact saved: <b>${esc(c.name)}</b> (${esc(c.id)}), ${esc(c.matter)}.</div>` : '<div class="msg">Create the contact first, then pick a slot.</div>'}<p>Free 45-minute consultation slots (Toronto time):</p>${list}`, who));
    }
    if (p === '/book' && req.method === 'GET') {
      const cid = u.searchParams.get('contact') || ''; const slot = u.searchParams.get('slot') || '';
      const c = db.contacts.find((x) => x.id === cid && x.token === s.id);
      if (!c) return send(res, 400, page('Book', '<div class="msg err">Unknown contact for this task.</div>', who));
      return send(res, 200, page('Confirm booking', `<h1>Confirm consultation</h1><table><tr><th>Client</th><td>${esc(c.name)}</td></tr><tr><th>Matter</th><td>${esc(c.matter)}</td></tr><tr><th>Slot</th><td id="slot">${esc(slot)}</td></tr></table>
<form method="post" action="/book"><input type="hidden" name="contact" value="${esc(cid)}"><input type="hidden" name="slot" value="${esc(slot)}"><button type="submit" id="book">Book consultation</button></form>`, who));
    }
    if (p === '/book' && req.method === 'POST') {
      const f = form(await body(req));
      const c = db.contacts.find((x) => x.id === f.contact && x.token === s.id);
      if (!c) return send(res, 400, page('Book', '<div class="msg err">Unknown contact for this task.</div>', who));
      if (s.bookings >= 1) { ev({ kind: 'booking.denied', task: s.task, why: 'scope' }); save(); return send(res, 403, page('Book', '<div class="msg err">This task may request only one booking.</div>', who)); }
      const free = slots().find((x) => x.slot === f.slot && x.free);
      if (!free) return send(res, 409, page('Book', '<div class="msg err">That slot is no longer free.</div>', who));
      const b = { id: 'b-' + (5000 + db.bookings.length + 1), contact: c.id, slot: f.slot, created: new Date().toISOString(), task: s.task, status: 'requested' };
      db.bookings.push(b); db.tokens[s.id].bookings++; ev({ kind: 'booking.create', task: s.task, id: b.id, slot: b.slot }); save();
      return send(res, 200, page('Booked', `<div class="msg ok" id="booked">Consultation requested: <b>${esc(c.name)}</b>, ${esc(b.slot)} (booking ${esc(b.id)}).</div><p>The firm confirms the slot by email within one business day.</p>`, who));
    }
    return send(res, 404, page('Not found', '<div class="msg err">Page not found.</div>', who));
  } catch (e) {
    console.error(e); return send(res, 500, page('Error', '<div class="msg err">Server error.</div>'));
  }
});
server.listen(PORT, () => console.log(JSON.stringify({ portal: PORT, data: DATA })));
