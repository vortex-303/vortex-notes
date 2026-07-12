import { Vault } from "./vault.js";
import { loadSyncState, syncVault } from "./sync.js";

/**
 * Background sync for long-running daemons (serve, mcp): if the vault is
 * linked to a relay, pull+push every `intervalMs`. Errors are logged and
 * retried on the next tick — a flaky relay must never take the daemon down.
 */
export function startAutoSync(vault: Vault, intervalMs = 30_000): { stop: () => void } {
  if (!loadSyncState(vault)) return { stop: () => undefined };
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await syncVault(vault);
      if (r.pulled || r.pushed) {
        console.error(`[vortex-notes] auto-sync: pulled ${r.pulled}, pushed ${r.pushed}${r.conflicts.length ? `, conflicts: ${r.conflicts.join(", ")}` : ""}`);
      }
    } catch (err) {
      console.error(`[vortex-notes] auto-sync failed (will retry): ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}
