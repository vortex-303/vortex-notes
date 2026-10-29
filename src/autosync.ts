import { Vault } from "./vault.js";
import { loadSyncState, syncVault } from "./sync.js";

export interface AutoSync {
  stop: () => void;
  /** A local write happened: push it soon (debounced) instead of waiting for the next tick. */
  nudge: () => void;
  /** Finish any pending or in-flight sync (call before exiting). */
  flush: () => Promise<void>;
}

/**
 * Background sync for long-running daemons (serve, mcp): if the vault is
 * linked to a relay, pull+push every `intervalMs`, and shortly after each
 * nudge(). Errors are logged and retried on the next tick — a flaky relay must
 * never take the daemon down.
 */
export function startAutoSync(vault: Vault, intervalMs = 30_000, nudgeMs = 800): AutoSync {
  if (!loadSyncState(vault)) return { stop: () => undefined, nudge: () => undefined, flush: async () => undefined };
  let running: Promise<void> | null = null;
  let again = false; // a nudge arrived mid-sync: run once more after it
  let pending: ReturnType<typeof setTimeout> | null = null;

  const tick = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          const r = await syncVault(vault);
          if (r.pulled || r.pushed) {
            console.error(`[vortex-notes] auto-sync: pulled ${r.pulled}, pushed ${r.pushed}${r.conflicts.length ? `, conflicts: ${r.conflicts.join(", ")}` : ""}`);
          }
        } while (again);
      } catch (err) {
        console.error(`[vortex-notes] auto-sync failed (will retry): ${(err as Error).message}`);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return {
    stop: () => clearInterval(timer),
    nudge: () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void tick();
      }, nudgeMs);
    },
    flush: async () => {
      if (pending) {
        clearTimeout(pending);
        pending = null;
        await tick();
      } else if (running) await running;
    },
  };
}
