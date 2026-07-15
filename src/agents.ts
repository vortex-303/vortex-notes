/**
 * Agents as principals (Phase 2, slice 1).
 *
 * "Add an agent" is one command: it mints the agent's keypair, certifies it
 * with THIS DEVICE's key (chain: account → device → agent — no phrase
 * needed), seals the granted space keys to it, pushes the grants to the
 * relay, and packs everything the agent needs into a single token string.
 * The scope (space ids + read/write mode) is signed inside the certificate,
 * so the relay enforces it — the agent can't grant itself more.
 *
 * On the agent's machine, `agent connect <token>` materializes a normal
 * identity (kind: "agent"), so every existing command — sync, mcp, serve —
 * just works, scoped and signing as the agent.
 */
import fs from "node:fs";
import path from "node:path";
import { certifyAgent, type SignedCert } from "./account.js";
import {
  randomSignKeypair,
  randomBoxKeypair,
  openBox,
  sealBox,
  fromHex,
  toHex,
  toB64,
  fromB64,
  utf8,
  fingerprint,
  type SignKeypair,
  type BoxKeypair,
} from "./crypto.js";
import { loadIdentity, vortexHome, hasIdentity, type LoadedIdentity, type IdentityFile } from "./identity.js";
import { getSpace, openSpaceKey, grantSpace } from "./spaces.js";
import { adoptSpace, type SyncState } from "./sync.js";
import { RelayClient } from "./relay/client.js";
import { Vault } from "./vault.js";
import { slugify } from "./textutil.js";
import os from "node:os";

const TOKEN_PREFIX = "vnat1_";

export interface AgentRecord {
  name: string;
  signPub: string;
  spaces: string[];
  mode: "ro" | "rw";
  createdAt: string;
  revokedAt?: string;
}

interface AgentToken {
  v: 1;
  relay: string;
  accountSignPub: string;
  accountEncPub: string;
  signPriv: string;
  boxPriv: string;
  cert: SignedCert;
  chain: SignedCert;
}

const registryPath = () => path.join(vortexHome(), "agents.json");

function loadRegistry(): { v: 1; agents: AgentRecord[] } {
  if (!fs.existsSync(registryPath())) return { v: 1, agents: [] };
  return JSON.parse(fs.readFileSync(registryPath(), "utf8")) as { v: 1; agents: AgentRecord[] };
}

function saveRegistry(reg: { v: 1; agents: AgentRecord[] }): void {
  fs.mkdirSync(vortexHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2) + "\n");
}

export function listAgents(): AgentRecord[] {
  return loadRegistry().agents;
}

/** Owner side: mint, certify, grant, announce — returns the paste-anywhere token. */
export async function createAgent(
  name: string,
  spaceSelectors: string[],
  mode: "ro" | "rw",
  relayUrl: string
): Promise<{ token: string; record: AgentRecord }> {
  const identity = loadIdentity();
  if (identity.file.device.kind === "agent") throw new Error("Agents cannot create other agents.");
  if (!spaceSelectors.length) throw new Error("Grant at least one space (--space <name|id>).");

  const agentSign = randomSignKeypair();
  const agentBox = randomBoxKeypair();
  const spaces = spaceSelectors.map((sel) => getSpace(sel.trim()));
  const cert = certifyAgent(identity.deviceSign, agentSign.pub, agentBox.pub, name, spaces.map((s) => s.id), mode);

  const client = new RelayClient(relayUrl, identity);
  await client.register(); // idempotent
  for (const space of spaces) {
    const key = openSpaceKey(identity, space);
    grantSpace(space, key, cert.signPub, agentBox.pub);
    await client.createSpace(getSpace(space.id)); // push refreshed sealedKeys
  }

  const token: AgentToken = {
    v: 1,
    relay: relayUrl,
    accountSignPub: identity.file.accountSignPub,
    accountEncPub: identity.file.accountEncPub,
    signPriv: toHex(agentSign.priv),
    boxPriv: toHex(agentBox.priv),
    cert,
    chain: identity.file.device,
  };
  const record: AgentRecord = {
    name,
    signPub: cert.signPub,
    spaces: spaces.map((s) => s.id),
    mode,
    createdAt: cert.createdAt,
  };
  const reg = loadRegistry();
  reg.agents.push(record);
  saveRegistry(reg);
  return { token: TOKEN_PREFIX + Buffer.from(JSON.stringify(token)).toString("base64url"), record };
}

export function parseToken(tokenStr: string): AgentToken {
  if (!tokenStr.startsWith(TOKEN_PREFIX)) throw new Error("Not a vortex agent token (expected vnat1_…).");
  return JSON.parse(Buffer.from(tokenStr.slice(TOKEN_PREFIX.length), "base64url").toString("utf8")) as AgentToken;
}

/** Stable per-agent locations derived from the token — no env juggling needed. */
export function defaultAgentPaths(tokenStr: string): { home: string; vault: string; name: string } {
  const t = parseToken(tokenStr);
  const base = process.env.VORTEX_NOTES_AGENTS_DIR ?? path.join(os.homedir(), ".vortex-agents");
  const dir = path.join(base, `${slugify(t.cert.name)}-${t.cert.signPub.slice(0, 8)}`);
  return { home: path.join(dir, "home"), vault: path.join(dir, "vault"), name: t.cert.name };
}

/**
 * Idempotent single-command bootstrap: sets the agent's own home, connects
 * on first run, reuses everything on later runs. Returns the vault path.
 */
export async function ensureAgentConnected(tokenStr: string, vaultOverride?: string): Promise<{
  name: string;
  vault: string;
  home: string;
  mode: "ro" | "rw";
  firstRun: boolean;
}> {
  const t = parseToken(tokenStr);
  const paths = defaultAgentPaths(tokenStr);
  const home = process.env.VORTEX_NOTES_HOME ?? paths.home;
  process.env.VORTEX_NOTES_HOME = home;
  const vaultDir = vaultOverride ?? paths.vault;

  const idFile = path.join(home, "identity.json");
  if (fs.existsSync(idFile)) {
    const existing = JSON.parse(fs.readFileSync(idFile, "utf8")) as IdentityFile;
    if (existing.device.signPub !== t.cert.signPub) {
      throw new Error(`${home} belongs to a different agent (${existing.device.name}).`);
    }
    return { name: t.cert.name, vault: vaultDir, home, mode: t.cert.mode ?? "rw", firstRun: false };
  }
  await connectAgent(tokenStr, vaultDir);
  return { name: t.cert.name, vault: vaultDir, home, mode: t.cert.mode ?? "rw", firstRun: true };
}

/**
 * Agent side: turn a token into a working identity + synced vault.
 * After this, `vortex-notes sync` / `mcp` / `serve` behave normally —
 * signing as the agent, restricted to the granted spaces.
 */
export async function connectAgent(
  tokenStr: string,
  vaultDir?: string
): Promise<{ name: string; fingerprint: string; spaces: string[]; vault?: string }> {
  if (hasIdentity()) {
    throw new Error(`This home (${vortexHome()}) already has an identity. Use a fresh VORTEX_NOTES_HOME for each agent.`);
  }
  const token = parseToken(tokenStr);

  const file: IdentityFile = {
    v: 1,
    accountSignPub: token.accountSignPub,
    accountEncPub: token.accountEncPub,
    fingerprint: fingerprint(fromHex(token.accountSignPub)),
    device: token.cert,
    chain: token.chain,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(vortexHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(vortexHome(), "identity.json"), JSON.stringify(file, null, 2) + "\n");
  fs.writeFileSync(path.join(vortexHome(), "device.key"), token.signPriv + "\n" + token.boxPriv + "\n", { mode: 0o600 });
  const identity: LoadedIdentity = loadIdentity(); // validates the chain

  const client = new RelayClient(token.relay, identity);
  await client.register();
  const remote = await client.listSpaces(); // relay already scopes this to the grant
  const adopted: string[] = [];
  for (const space of remote) {
    const sealed = space.sealedKeys[identity.file.device.signPub];
    if (!sealed) continue;
    const key = openBox(fromHex(sealed), identity.deviceBox);
    adoptSpace(identity, space.id, space.createdAt, key, space.sealedKeys);
    adopted.push(space.id);
  }
  if (!adopted.length) throw new Error("No granted spaces found on the relay for this agent.");

  let vaultPath: string | undefined;
  if (vaultDir) {
    const vault = new Vault(vaultDir);
    vault.init();
    if (vault.isPristineWelcome()) fs.rmSync(vault.abs("Welcome.md"), { force: true });
    const state: SyncState = { v: 1, relay: token.relay, spaceId: adopted[0], cursor: 0, files: {} };
    fs.writeFileSync(path.join(vault.metaDir, "sync.json"), JSON.stringify(state, null, 2) + "\n");
    vaultPath = vault.root;
  }
  return { name: token.cert.name, fingerprint: identity.file.fingerprint, spaces: adopted, vault: vaultPath };
}

/**
 * If exactly one paired agent lives on this machine, return its home+vault —
 * lets bare `vortex-notes mcp` serve it with zero flags.
 */
export function findSoleAgentVault(): { home: string; vault: string; name: string } | null {
  const base = process.env.VORTEX_NOTES_AGENTS_DIR ?? path.join(os.homedir(), ".vortex-agents");
  if (!fs.existsSync(base)) return null;
  const hits: { home: string; vault: string; name: string }[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const home = path.join(base, entry.name, "home");
    const vault = path.join(base, entry.name, "vault");
    if (fs.existsSync(path.join(home, "identity.json")) && fs.existsSync(path.join(vault, ".vortex"))) {
      hits.push({ home, vault, name: entry.name });
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

interface PairGrant {
  v: 1;
  relay: string;
  accountSignPub: string;
  accountEncPub: string;
  cert: SignedCert;
  chain: SignedCert;
}

/**
 * Agent side, step 1: generate keys locally (they never leave this machine),
 * ask the relay for a pairing code, and return a poll function.
 */
export async function requestPairing(relayUrl: string, name: string): Promise<{
  code: string;
  complete: (opts?: { timeoutMs?: number; intervalMs?: number }) => Promise<{ name: string; vault: string; home: string }>;
}> {
  const agentSign = randomSignKeypair();
  const agentBox = randomBoxKeypair();
  const code = await RelayClient.requestPairing(relayUrl, name, toHex(agentSign.pub), toHex(agentBox.pub));
  return {
    code,
    complete: async (opts = {}) => {
      const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60 * 1000);
      for (;;) {
        const grantB64 = await RelayClient.pollPairing(relayUrl, code, toHex(agentSign.pub));
        if (grantB64) return finishPairing(grantB64, agentSign, agentBox);
        if (Date.now() > deadline) throw new Error("Pairing timed out — no approval received.");
        await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2000));
      }
    },
  };
}

function finishPairing(
  grantB64: string,
  agentSign: SignKeypair,
  agentBox: BoxKeypair
): Promise<{ name: string; vault: string; home: string }> {
  const grant = JSON.parse(new TextDecoder().decode(openBox(fromB64(grantB64), agentBox))) as PairGrant;
  // Materialize the identity exactly like a token connect, but with OUR keys.
  const base = process.env.VORTEX_NOTES_AGENTS_DIR ?? path.join(os.homedir(), ".vortex-agents");
  const dir = path.join(base, `${slugify(grant.cert.name)}-${grant.cert.signPub.slice(0, 8)}`);
  const home = process.env.VORTEX_NOTES_HOME ?? path.join(dir, "home");
  process.env.VORTEX_NOTES_HOME = home;
  const vaultDir = path.join(dir, "vault");
  const file: IdentityFile = {
    v: 1,
    accountSignPub: grant.accountSignPub,
    accountEncPub: grant.accountEncPub,
    fingerprint: fingerprint(fromHex(grant.accountSignPub)),
    device: grant.cert,
    chain: grant.chain,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, "identity.json"), JSON.stringify(file, null, 2) + "\n");
  fs.writeFileSync(path.join(home, "device.key"), toHex(agentSign.priv) + "\n" + toHex(agentBox.priv) + "\n", { mode: 0o600 });
  const identity = loadIdentity();
  return (async () => {
    const client = new RelayClient(grant.relay, identity);
    await client.register(); // owner already registered us, but idempotent
    const remote = await client.listSpaces();
    const adopted: string[] = [];
    for (const space of remote) {
      const sealed = space.sealedKeys[identity.file.device.signPub];
      if (!sealed) continue;
      adoptSpace(identity, space.id, space.createdAt, openBox(fromHex(sealed), identity.deviceBox), space.sealedKeys);
      adopted.push(space.id);
    }
    if (!adopted.length) throw new Error("Approved, but no granted spaces were found on the relay.");
    const vault = new Vault(vaultDir);
    vault.init();
    if (vault.isPristineWelcome()) fs.rmSync(vault.abs("Welcome.md"), { force: true });
    const state = { v: 1 as const, relay: grant.relay, spaceId: adopted[0], cursor: 0, files: {}, home };
    fs.writeFileSync(path.join(vault.metaDir, "sync.json"), JSON.stringify(state, null, 2) + "\n");
    return { name: grant.cert.name, vault: vault.root, home };
  })();
}

/**
 * Owner side: approve a pairing code — certify the requester's public keys,
 * grant the spaces, register it, and hand back a sealed grant via the relay.
 */
export async function approvePairing(
  code: string,
  spaceSelectors: string[],
  mode: "ro" | "rw",
  relayUrl: string
): Promise<AgentRecord> {
  const identity = loadIdentity();
  if (identity.file.device.kind === "agent") throw new Error("Agents cannot approve pairings.");
  const client = new RelayClient(relayUrl, identity);
  await client.register();
  const req = await client.getPairing(code);

  const spaces = spaceSelectors.map((sel) => getSpace(sel.trim()));
  const cert = certifyAgent(identity.deviceSign, fromHex(req.signPub), fromHex(req.encPub), req.name, spaces.map((s) => s.id), mode);
  for (const space of spaces) {
    const key = openSpaceKey(identity, space);
    grantSpace(space, key, cert.signPub, fromHex(req.encPub));
    await client.createSpace(getSpace(space.id));
  }
  // Register the agent ourselves so it can authenticate the moment it polls.
  await fetch(`${relayUrl}/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountSignPub: identity.file.accountSignPub,
      accountEncPub: identity.file.accountEncPub,
      device: cert,
      chain: identity.file.device,
    }),
  });
  const grant: PairGrant = {
    v: 1,
    relay: relayUrl,
    accountSignPub: identity.file.accountSignPub,
    accountEncPub: identity.file.accountEncPub,
    cert,
    chain: identity.file.device,
  };
  await client.approvePairing(code, toB64(sealBox(utf8(JSON.stringify(grant)), fromHex(req.encPub))));

  const record: AgentRecord = { name: req.name, signPub: cert.signPub, spaces: spaces.map((s) => s.id), mode, createdAt: cert.createdAt };
  const reg = loadRegistry();
  reg.agents.push(record);
  saveRegistry(reg);
  return record;
}

/**
 * Owner side: revoke an agent. The relay drops its registration (it can no
 * longer authenticate at all) and its sealed keys are removed from the
 * space records. NOTE (honest limit, slice 2 fixes it): a revoked agent may
 * still hold the old space key material — full key rotation on revoke is
 * the next step.
 */
export async function revokeAgent(name: string, relayUrl: string): Promise<AgentRecord> {
  const identity = loadIdentity();
  if (identity.file.device.kind === "agent") throw new Error("Agents cannot revoke principals.");
  const reg = loadRegistry();
  const record = reg.agents.find((a) => a.name === name && !a.revokedAt);
  if (!record) throw new Error(`No active agent named "${name}". See: vortex-notes agent list`);

  const client = new RelayClient(relayUrl, identity);
  try {
    await client.revokePrincipal(record.signPub);
  } catch (err) {
    if (!/No such principal/.test((err as Error).message)) throw err;
  }
  for (const spaceId of record.spaces) {
    try {
      const space = getSpace(spaceId);
      delete space.sealedKeys[record.signPub];
      // persist locally by re-granting nothing: rewrite via grant file helpers
      const regFile = path.join(vortexHome(), "spaces.json");
      const data = JSON.parse(fs.readFileSync(regFile, "utf8")) as { v: 1; spaces: { id: string; sealedKeys: Record<string, string> }[] };
      const s = data.spaces.find((x) => x.id === spaceId);
      if (s) delete s.sealedKeys[record.signPub];
      fs.writeFileSync(regFile, JSON.stringify(data, null, 2) + "\n");
      await client.createSpace(getSpace(spaceId));
    } catch {
      /* space may be gone; relay ban is the primary enforcement */
    }
  }
  record.revokedAt = new Date().toISOString();
  saveRegistry(reg);
  return record;
}
