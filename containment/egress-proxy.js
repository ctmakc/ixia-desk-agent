// Allowlist forward proxy for the sandbox network (feasibility check, 22.10.2026).
// HTTP CONNECT (https) and plain http; any host outside ALLOW gets 403 and a log line.
const http = require('http'); const https = require('https'); const net = require('net');
const ALLOW = (process.env.ALLOW || '').split(',').filter(Boolean);
const ok = (h) => ALLOW.some((a) => h === a || h.endsWith('.' + a));
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const srv = http.createServer((req, res) => {
  let u; try { u = new URL(req.url); } catch { res.writeHead(400).end(); return; }
  if (!ok(u.hostname)) { log({ deny: u.hostname, via: 'http' }); res.writeHead(403).end('egress denied\n'); return; }
  log({ allow: u.hostname, via: 'http' });
  const p = (u.protocol === 'https:' ? https : http).request(u, { method: req.method, headers: { ...req.headers, host: u.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => res.writeHead(502).end()); req.pipe(p);
});
srv.on('connect', (req, sock, head) => {
  const [host, port] = req.url.split(':');
  if (!ok(host)) { log({ deny: host, via: 'connect' }); sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  log({ allow: host, via: 'connect' });
  const up = net.connect(+port || 443, host, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(sock); sock.pipe(up); });
  up.on('error', () => sock.destroy());
});
srv.listen(3128, () => log({ listening: 3128, allow: ALLOW }));
