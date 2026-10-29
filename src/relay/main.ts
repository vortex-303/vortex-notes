import { startRelay } from "./server.js";
import { fromHex } from "../crypto.js";

const port = Number(process.env.PORT ?? 7300);
const dbPath = process.env.RELAY_DB ?? "/data/relay.db";
const quotaMb = Number(process.env.RELAY_QUOTA_MB ?? 0);
const adminAccount = process.env.RELAY_ADMIN_ACCOUNT || undefined;
const connectorKek = process.env.RELAY_CONNECTOR_KEK ? fromHex(process.env.RELAY_CONNECTOR_KEK) : undefined;
const { port: actual } = await startRelay({ port, dbPath, quotaBytes: quotaMb > 0 ? quotaMb * 1e6 : undefined, adminAccount, connectorKek, openaiAppsChallenge: process.env.OPENAI_APPS_CHALLENGE || undefined });
console.log(`[vortex-relay] listening on :${actual}, db ${dbPath} — ciphertext store only${quotaMb > 0 ? `, ${quotaMb}MB/account quota` : ""}`);
