// Fetches an https URL through the proxy with CONNECT, the way Chromium does.
const http = require('http'); const tls = require('tls');
const [, , target] = process.argv; const u = new URL(target);
const [ph, pp] = (process.env.PROXY || '').split(':');
const req = http.request({ host: ph, port: +pp, method: 'CONNECT', path: `${u.hostname}:443`, timeout: 10000 });
req.on('connect', (res, sock) => {
  if (res.statusCode !== 200) { console.log(`proxy answered ${res.statusCode} for ${u.hostname}`); process.exit(2); }
  const t = tls.connect({ socket: sock, servername: u.hostname }, () => {
    t.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}\r\nConnection: close\r\n\r\n`);
  });
  let body = ''; t.on('data', (d) => (body += d)); t.on('end', () => {
    console.log(body.split('\r\n')[0], '|', (body.match(/<title>[^<]*<\/title>/) || [''])[0]); });
});
req.on('error', (e) => { console.log('error', e.code || e.message); process.exit(3); });
req.on('timeout', () => { console.log('timeout'); process.exit(4); });
req.end();
