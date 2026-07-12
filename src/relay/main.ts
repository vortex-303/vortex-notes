import { startRelay } from "./server.js";

const port = Number(process.env.PORT ?? 7300);
const dbPath = process.env.RELAY_DB ?? "/data/relay.db";
const { port: actual } = await startRelay({ port, dbPath });
console.log(`[vortex-relay] listening on :${actual}, db ${dbPath} — ciphertext store only`);
