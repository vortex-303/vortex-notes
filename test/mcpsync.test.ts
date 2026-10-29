import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Vault } from "../src/vault.js";
import { startRelay } from "../src/relay/server.js";
import { initIdentity, loginIdentity } from "../src/identity.js";
import { linkVault, joinVault, syncVault } from "../src/sync.js";

const cliJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Regression: a short session (claude -p, a quick chat) used to end before the
// 30s auto-sync tick, so the agent's writes never left the machine.
test("MCP: a write in a short session is pushed before the server exits", async () => {
  const relay = await startRelay({ port: 0 });
  const base = `http://127.0.0.1:${relay.port}`;
  const prev = process.env.VORTEX_NOTES_HOME;
  const agentHome = tmp("vortex-mcpsync-home-");
  const ownerHome = tmp("vortex-mcpsync-home-");
  try {
    process.env.VORTEX_NOTES_HOME = agentHome;
    const { phrase } = initIdentity("agent-box");
    const agentVault = new Vault(tmp("vortex-mcpsync-vault-"));
    agentVault.init();
    await linkVault(agentVault, base, "personal");
    await syncVault(agentVault);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliJs, "mcp", "--vault", agentVault.root, "--no-watch"],
      env: { ...process.env, VORTEX_NOTES_HOME: agentHome, VORTEX_NOTES_NO_SEMANTIC: "1" },
    });
    const client = new Client({ name: "short-session", version: "0.0.0" });
    await client.connect(transport);
    await client.callTool({ name: "remember", arguments: { fact: "Written in a short session" } });
    await client.close(); // end the session immediately — no 30s wait
    await new Promise((r) => setTimeout(r, 1500)); // let the exiting server finish its flush

    process.env.VORTEX_NOTES_HOME = ownerHome;
    loginIdentity(phrase, "laptop");
    const ownerVault = new Vault(tmp("vortex-mcpsync-vault-"));
    ownerVault.init();
    await joinVault(ownerVault, base, phrase);
    await syncVault(ownerVault);
    assert.match(fs.readFileSync(ownerVault.abs("memory/facts.md"), "utf8"), /Written in a short session/);
  } finally {
    process.env.VORTEX_NOTES_HOME = prev;
    await relay.close();
  }
});
