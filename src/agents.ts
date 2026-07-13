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
  fromHex,
  toHex,
  fingerprint,
} from "./crypto.js";
import { loadIdentity, vortexHome, hasIdentity, type LoadedIdentity, type IdentityFile } from "./identity.js";
import { getSpace, openSpaceKey, grantSpace } from "./spaces.js";
import { adoptSpace, type SyncState } from "./sync.js";
import { RelayClient } from "./relay/client.js";
import { Vault } from "./vault.js";

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
  const cert = certifyAgent(identity.deviceSign, agentSign, agentBox, name, spaces.map((s) => s.id), mode);

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
  if (!tokenStr.startsWith(TOKEN_PREFIX)) throw new Error("Not a vortex agent token (expected vnat1_…).");
  const token = JSON.parse(Buffer.from(tokenStr.slice(TOKEN_PREFIX.length), "base64url").toString("utf8")) as AgentToken;

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
