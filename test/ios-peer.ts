/**
 * A scriptable CLI "machine" for the native client's live tests
 * (ios/VortexKit Tests/LiveRelayTests.swift). Each call is one process; the
 * machine's identity lives in <home>, its vault in <vault>.
 *
 *   relay <dbPath>                       start a relay, print {"port"}, run until killed
 *   init <home> <vault> <relayUrl>       new account + link + sync, print {"phrase"}
 *   write <vault> <path> <content>       write a raw note file
 *   rm <vault> <path>                    delete a note file
 *   bulk <vault> <count>                 write <count> small notes
 *   sync <home> <vault>                  sync, print the SyncResult
 *   read <vault> <path>                  print {"content"} (null if missing)
 *   ls <vault>                           print {"files"}
 */
import fs from "node:fs";
import path from "node:path";

process.env.VORTEX_NOTES_NO_SEMANTIC = "1";
const [cmd, ...args] = process.argv.slice(2);
const out = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");

async function main() {
  const { Vault } = await import("../src/vault.js");
  const vaultAt = (dir: string) => new Vault(dir);
  switch (cmd) {
    case "relay": {
      const { startRelay } = await import("../src/relay/server.js");
      const relay = await startRelay({ port: 0, dbPath: args[0] });
      out({ port: relay.port });
      process.on("SIGTERM", () => relay.close().then(() => process.exit(0)));
      return; // keep serving
    }
    case "init": {
      const [home, dir, relayUrl] = args;
      process.env.VORTEX_NOTES_HOME = home;
      const { initIdentity } = await import("../src/identity.js");
      const { linkVault, syncVault } = await import("../src/sync.js");
      const { phrase } = initIdentity("cli-peer");
      const vault = vaultAt(dir);
      vault.init();
      fs.rmSync(vault.abs("Welcome.md"), { force: true });
      await linkVault(vault, relayUrl, "personal");
      await syncVault(vault);
      return out({ phrase });
    }
    case "write": {
      const [dir, rel, content] = args;
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      return out({ ok: true });
    }
    case "rm":
      fs.rmSync(path.join(args[0], args[1]), { force: true });
      return out({ ok: true });
    case "bulk": {
      const [dir, count] = args;
      fs.mkdirSync(path.join(dir, "bulk"), { recursive: true });
      for (let i = 0; i < Number(count); i++) fs.writeFileSync(path.join(dir, "bulk", `n${i}.md`), `# Bulk ${i}\n`);
      return out({ ok: true });
    }
    case "sync": {
      process.env.VORTEX_NOTES_HOME = args[0];
      const { syncVault } = await import("../src/sync.js");
      return out(await syncVault(vaultAt(args[1])));
    }
    case "read": {
      const abs = path.join(args[0], args[1]);
      return out({ content: fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null });
    }
    case "ls":
      return out({ files: vaultAt(args[0]).listNoteFiles().sort() });
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
