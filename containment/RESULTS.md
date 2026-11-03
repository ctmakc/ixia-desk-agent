# Containment check results

## Vultr Cloud Compute, Toronto (vc2-4c-8gb, Ubuntu 24.04, Docker 29.9.2) — 3 Nov 2026 16:28 UTC

7 of 7 checks gave the expected result. Raw output of `bash containment/run.sh` (image pull lines removed):

```
== 1. allowed host through proxy
HTTP/1.1 200 OK | <title>Example Domain</title>
exit=0
== 2. host outside allowlist through proxy (injection target)
proxy answered 403 for httpbin.org
exit=2
== 3. direct connection without proxy (bypass attempt)
wget: can't connect to remote host (1.1.1.1): Network unreachable

== 4. secrets visible inside sandbox env (expect none)
no secret-like variables
== 5. runaway job: 10 s wall-clock limit
runaway container killed and removed after 10 s; still present: 0
== 6. memory bomb: 128 MB limit
exit=137 (137 = OOM-killed)
== 7. fork bomb: pids limit 32
sh: can't fork: Resource temporarily unavailable
procs=4
== proxy log
{"t":"2026-11-03T16:27:57.052Z","listening":3128,"allow":["example.com"]}
{"t":"2026-11-03T16:27:59.301Z","allow":"example.com","via":"connect"}
{"t":"2026-11-03T16:27:59.668Z","deny":"httpbin.org","via":"connect"}
== leftovers: 0 containers, 0 networks
```

| # | Check | Result |
|---|---|---|
| 1 | allowed host through proxy | 200 OK |
| 2 | other host through proxy | 403 from proxy, logged |
| 3 | direct connection without proxy | Network unreachable |
| 4 | secret-like env vars in sandbox | none |
| 5 | runaway loop, 10 s limit | killed and removed after 10 s, 0 left |
| 6 | memory bomb, 128 MB | exit 137 (OOM-killed) |
| 7 | fork bomb, pids 32 | can't fork |
