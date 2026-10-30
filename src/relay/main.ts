import { startRelay, relayOptionsFromEnv } from "./server.js";

const port = Number(process.env.PORT ?? 7300);
const dbPath = process.env.RELAY_DB ?? "/data/relay.db";
const env = relayOptionsFromEnv();
const { port: actual } = await startRelay({ port, dbPath, ...env });
console.log(`[vortex-relay] listening on :${actual}, db ${dbPath} — ciphertext store only${env.quotaBytes ? `, ${env.quotaBytes / 1e6}MB/account quota` : ""}`);
