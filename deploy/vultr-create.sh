#!/usr/bin/env bash
# Create desk + portal VMs in Toronto from cloud-init. Needs VULTR_API_KEY (account API key).
# Usage: set -a; . ~/.config/ixia-desk/vultr.env; set +a; bash deploy/vultr-create.sh
set -euo pipefail
cd "$(dirname "$0")"
api(){ curl -sS -H "Authorization: Bearer $VULTR_API_KEY" -H 'Content-Type: application/json' "$@"; }
PUB=${SSH_PUB:-$HOME/.ssh/id_ed25519.pub}
KEYID=$(api https://api.vultr.com/v2/ssh-keys | python3 -c "import json,sys;k=[x['id'] for x in json.load(sys.stdin)['ssh_keys'] if x['name']=='ixia-desk-ops'];print(k[0] if k else '')")
if [ -z "$KEYID" ]; then
  KEYID=$(api -X POST https://api.vultr.com/v2/ssh-keys -d "$(python3 -c "import json;print(json.dumps({'name':'ixia-desk-ops','ssh_key':open('$PUB').read().strip()}))")" | python3 -c "import json,sys;print(json.load(sys.stdin)['ssh_key']['id'])")
fi
mk(){ # label plan cloud-init
  api -X POST https://api.vultr.com/v2/instances -d "$(python3 - "$1" "$2" "$3" "$KEYID" <<'PY'
import json,sys,base64
label,plan,ci,key=sys.argv[1:5]
print(json.dumps({'region':'yto','plan':plan,'os_id':2284,'label':label,'hostname':label,'sshkey_id':[key],
  'user_data':base64.b64encode(open(ci,'rb').read()).decode(),'backups':'disabled','enable_ipv6':True,'tags':['ixia-desk','agent-rush']}))
PY
)" | python3 -c "import json,sys;d=json.load(sys.stdin);i=d.get('instance',d);print(i.get('id'),i.get('label'),i.get('main_ip'),i.get('status'),d.get('error',''))"
}
mk ixia-desk vc2-4c-8gb cloud-init-desk.yaml
mk ixia-portal vc2-1c-1gb cloud-init-portal.yaml
