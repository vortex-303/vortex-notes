import test from "node:test";
import assert from "node:assert/strict";
import { openGeo, countryFromReader, clientIp } from "../src/relay/geo.js";

test("geo: 2-letter country from the CC0 db; unknown/private → null", async () => {
  const r = await openGeo();
  assert.ok(r, "country database is bundled");
  assert.equal(countryFromReader(r, "8.8.8.8"), "US");
  assert.equal(countryFromReader(r, "190.210.0.1"), "AR");
  assert.equal(countryFromReader(r, "127.0.0.1"), null); // localhost → unknown
  assert.equal(countryFromReader(r, ""), null);
  assert.equal(countryFromReader(null, "8.8.8.8"), null); // no db → no-op
});

test("geo: clientIp prefers Fly header, then XFF, then socket", () => {
  assert.equal(clientIp({ "fly-client-ip": "8.8.8.8" }), "8.8.8.8");
  assert.equal(clientIp({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), "1.2.3.4");
  assert.equal(clientIp({}, "9.9.9.9"), "9.9.9.9");
  assert.equal(clientIp({}), "");
});
