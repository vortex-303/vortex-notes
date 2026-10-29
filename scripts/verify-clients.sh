#!/usr/bin/env bash
# Verify every documented client path against a relay, using throwaway
# identities and temp configs only — your real ~/.claude.json, OpenCode and
# Hermes configs are never written (checked at the end).
#
#   scripts/verify-clients.sh                 # published npm package vs production
#   RELAY=http://127.0.0.1:7300 scripts/verify-clients.sh
#   PKG=local scripts/verify-clients.sh       # test this checkout's dist/ instead of npm
#   MODELS=1 scripts/verify-clients.sh        # also real-model runs (claude -p, opencode run)
#
# Leaves a throwaway account on the relay (tag it "test" in Admin stats); its
# agents are revoked at the end.
set -uo pipefail
RELAY=${RELAY:-https://vortex-notes.pages.dev}
REPO=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d "${TMPDIR:-/tmp}/vn-verify.XXXX")
pass=0; fail=0
ok()   { echo "  ✓ $*"; pass=$((pass + 1)); }
bad()  { echo "  ✗ $*"; fail=$((fail + 1)); }
step() { echo; echo "== $*"; }
snap() { python3 - <<'EOF'
import json, hashlib, os
h = lambda b: hashlib.sha1(b).hexdigest()[:12]
p = os.path.expanduser
try: print("claude", h(json.dumps(json.load(open(p("~/.claude.json"))).get("mcpServers", {}), sort_keys=True).encode()))
except Exception: print("claude -")
for f in ("~/.config/opencode/opencode.json", "~/.hermes/config.yaml", "~/.cursor/mcp.json"):
    try: print(f, h(open(p(f), "rb").read()))
    except Exception: print(f, "-")
EOF
}
snap > "$W/before.txt"

step "1. install"
if [ "${PKG:-npm}" = local ]; then
  (cd "$REPO" && npm pack --pack-destination "$W" >/dev/null 2>&1)
  npm install -g --prefix "$W/prefix" "$W"/vortex-notes-*.tgz >/dev/null 2>&1
else
  npm install -g --prefix "$W/prefix" vortex-notes@latest >/dev/null 2>&1
fi
VN="$W/prefix/bin/vortex-notes"
CLI="$W/prefix/lib/node_modules/vortex-notes/dist"
[ -x "$VN" ] && ok "installed $(node -p "require('$W/prefix/lib/node_modules/vortex-notes/package.json').version")" || { bad "install failed"; exit 1; }
"$VN" --help | grep -q "Agent commands" && ok "agent commands present" || bad "agent commands missing"

step "owner (throwaway account) with a seeded note"
export VORTEX_NOTES_NO_SEMANTIC=1
own() { VORTEX_NOTES_HOME="$W/owner-home" "$VN" "$@"; }
own init --vault "$W/owner" >/dev/null && rm -f "$W/owner/Welcome.md"
own identity init --name verify-owner >/dev/null 2>&1
own write "Secret" "launch code is 4417" --vault "$W/owner" --offline >/dev/null
own sync link --relay "$RELAY" --space personal --vault "$W/owner" >/dev/null && own sync --vault "$W/owner" >/dev/null \
  && ok "owner linked to $RELAY" || { bad "owner link failed"; exit 1; }
owner_has() { own sync --vault "$W/owner" >/dev/null 2>&1; grep -rqs "$1" "$W/owner"; }

step "2. pair + auto-wiring (temp HOME, real harness binaries on PATH)"
A="$W/agent-home"; mkdir -p "$A"
APATH="$W/prefix/bin:$(dirname "$(command -v node)"):$(dirname "$(command -v claude 2>/dev/null || echo /x)"):$(dirname "$(command -v opencode 2>/dev/null || echo /x)"):$(dirname "$(command -v hermes 2>/dev/null || echo /x)"):/usr/bin:/bin"
(cd "$A" && env -i HOME="$A" PATH="$APATH" VORTEX_NOTES_NO_SEMANTIC=1 "$VN" pair --name verify-agent >"$W/pair.out" 2>&1 &)
for _ in $(seq 1 30); do grep -q "Pairing code" "$W/pair.out" && break; sleep 1; done
CODE=$(grep "Pairing code" "$W/pair.out" | sed 's/.*code: *//' | tr -d ' ')
own agent approve "$CODE" --space personal --relay "$RELAY" >/dev/null 2>&1
for _ in $(seq 1 60); do grep -qE "Anything else|by hand" "$W/pair.out" && break; sleep 1; done
grep -q "Paired as" "$W/pair.out" && ok "paired ($CODE)" || bad "pair failed: $(tail -2 "$W/pair.out")"
grep "wired" "$W/pair.out" | sed 's/^/    /'
VAULT=$(ls -d "$A"/.vortex-agents/verify-agent-*/vault 2>/dev/null | head -1)
agent() { env -i HOME="$A" PATH="$APATH" VORTEX_NOTES_NO_SEMANTIC=1 "$VN" "$@"; }
MCPCMD=(node "$CLI/cli.js" mcp)

step "3. Claude Code"
if command -v claude >/dev/null; then
  python3 -c "import json;json.dump({'mcpServers':{'vn':{'command':'node','args':['$CLI/cli.js','mcp'],'env':{'VORTEX_NOTES_VAULT':'$VAULT','VORTEX_NOTES_NO_SEMANTIC':'1'}}}},open('$W/claude-mcp.json','w'))"
  env HOME="$A" PATH="$APATH" claude mcp get vortex-notes 2>&1 | grep -q "Connected" && ok "claude mcp get: Connected (temp config)" || bad "claude mcp get not connected"
  if [ "${MODELS:-0}" = 1 ]; then
    out=$(cd "$W" && echo "Using only the vn MCP tools: read secret.md and reply with the launch code, then remember the fact 'Verified from Claude Code script'." \
      | timeout 240 claude -p --mcp-config "$W/claude-mcp.json" --strict-mcp-config --allowedTools "mcp__vn__read_note,mcp__vn__remember" 2>&1)
    echo "$out" | grep -q 4417 && ok "claude -p read 4417" || bad "claude -p: $(echo "$out" | tail -1)"
    owner_has "Verified from Claude Code script" && ok "Claude Code write reached owner" || bad "Claude Code write not synced"
  fi
else echo "  - claude not installed"; fi

step "4. OpenCode"
if command -v opencode >/dev/null; then
  mkdir -p "$W/oc" && python3 -c "import json;json.dump({'mcp':{'vn-verify':{'type':'local','enabled':True,'command':['node','$CLI/cli.js','mcp'],'environment':{'VORTEX_NOTES_VAULT':'$VAULT','VORTEX_NOTES_NO_SEMANTIC':'1'}}}},open('$W/oc/opencode.json','w'))"
  (cd "$W/oc" && timeout 90 opencode mcp list 2>&1) | grep -q "vn-verify.*connected" && ok "opencode mcp list: connected" || bad "opencode not connected"
  if [ "${MODELS:-0}" = 1 ]; then
    (cd "$W/oc" && timeout 280 opencode run "Use ONLY the vn-verify MCP tools: call read_note with path secret.md, then append_daily with content 'Verified from OpenCode script'. Reply with the launch code." >"$W/oc.out" 2>&1)
    grep -q 4417 "$W/oc.out" && ok "opencode run read 4417" || bad "opencode run: $(tail -1 "$W/oc.out")"
    owner_has "Verified from OpenCode script" && ok "OpenCode write reached owner" || bad "OpenCode write not synced"
  fi
else echo "  - opencode not installed"; fi

step "5. Hermes"
if command -v hermes >/dev/null; then
  timeout 120 env HOME="$A" PATH="$APATH" hermes mcp test vortex-notes 2>&1 | grep -q "Tools discovered: 9" && ok "hermes mcp test: 9 tools (temp HOME)" || bad "hermes mcp test failed"
else echo "  - hermes not installed"; fi

step "6. Cursor-style config (standard mcpServers entry) via the MCP SDK client"
(cd "$REPO" && node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const c = new Client({ name: 'cursor-config', version: '1' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['$CLI/cli.js', 'mcp'], env: { ...process.env, VORTEX_NOTES_VAULT: '$VAULT', VORTEX_NOTES_NO_SEMANTIC: '1' } }));
const r = await c.callTool({ name: 'read_note', arguments: { path: 'secret.md' } });
await c.close();
process.exit(/4417/.test(r.content[0].text) ? 0 : 1);" 2>/dev/null) && ok "stdio entry reads 4417" || bad "stdio entry failed"

step "7. shell CLI (paired vault found without flags)"
agent read secret.md | grep -q 4417 && ok "read" || bad "read"
agent search launch --keyword | grep -q secret.md && ok "search" || bad "search"
agent list --json | grep -q secret.md && ok "list --json" || bad "list"
agent daily "Verified from CLI script" >/dev/null && owner_has "Verified from CLI script" && ok "daily → owner" || bad "daily not synced"
agent read nope.md --json >/dev/null; [ $? -eq 1 ] && ok "missing note exits 1" || bad "missing note exit code"

step "8. hosted chat connector + official MCP Inspector"
URL=$(cd "$REPO" && VORTEX_NOTES_HOME="$W/owner-home" node --input-type=module -e "
import { loadIdentity } from '$CLI/identity.js';
import { getSpace, openSpaceKey, grantSpace, listSpaces } from '$CLI/spaces.js';
import { certifyAgent } from '$CLI/account.js';
import { RelayClient } from '$CLI/relay/client.js';
import { randomSignKeypair, randomBoxKeypair } from '$CLI/crypto.js';
const id = loadIdentity(), space = listSpaces()[0], s = randomSignKeypair(), b = randomBoxKeypair();
const cert = certifyAgent(id.deviceSign, s.pub, b.pub, 'verify-connector', [space.id], 'rw');
grantSpace(space, openSpaceKey(id, space), cert.signPub, b.pub);
const c = new RelayClient('$RELAY', id);
await c.createSpace(getSpace(space.id));
await fetch('$RELAY/v1/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountSignPub: id.file.accountSignPub, accountEncPub: id.file.accountEncPub, device: cert, chain: id.file.device }) });
const k = new Uint8Array(64); k.set(s.priv, 0); k.set(b.priv, 32);
console.log('$RELAY' + (await c.createConnector(cert.signPub, k)).path);" 2>/dev/null)
if [ -n "$URL" ]; then
  insp() { (cd "$W" && timeout 180 npx -y @modelcontextprotocol/inspector@latest --cli "$URL" --transport http "$@" 2>&1); }
  insp --method tools/list | grep -q '"remember"' && ok "inspector tools/list" || bad "inspector tools/list"
  insp --method tools/call --tool-name read_note --tool-arg path=secret.md | grep -q 4417 && ok "inspector read 4417" || bad "inspector read"
  insp --method tools/call --tool-name remember --tool-arg "fact=Verified via Inspector script" >/dev/null
  owner_has "Verified via Inspector script" && ok "connector write → owner (E2E)" || bad "connector write not synced"
else bad "could not create connector"; fi

step "cleanup + isolation check"
(cd "$REPO" && VORTEX_NOTES_HOME="$W/owner-home" node --input-type=module -e "
import { loadIdentity } from '$CLI/identity.js';
import { RelayClient } from '$CLI/relay/client.js';
const id = loadIdentity(), c = new RelayClient('$RELAY', id);
for (const p of await c.listPrincipals()) if (p.signPub !== id.file.device.signPub) await c.revokePrincipal(p.signPub);" 2>/dev/null) \
  && ok "revoked test agent + connector" || bad "revoke failed"
snap > "$W/after.txt"
diff -q "$W/before.txt" "$W/after.txt" >/dev/null && ok "real Claude/OpenCode/Hermes/Cursor configs unchanged" || { bad "a real config changed:"; diff "$W/before.txt" "$W/after.txt"; }

echo; echo "passed $pass, failed $fail   (work dir: $W)"
[ "$fail" -eq 0 ]
