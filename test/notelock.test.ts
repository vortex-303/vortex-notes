import test from "node:test";
import assert from "node:assert/strict";
import { lockContent, unlockContent, isLockedContent, findEnvelope } from "../src/notelock.js";
import { splitFrontmatter } from "../src/textutil.js";

const NOTE = `---
id: 01ABC
title: My Diary
tags:
  - private
---

Line one of the secret.
Line two.`;

test("lock → unlock round-trips the body exactly", () => {
  const locked = lockContent(NOTE, "hunter2");
  assert.ok(isLockedContent(locked), "locked note is detected as locked");
  assert.ok(!locked.includes("secret"), "plaintext body is gone from the locked form");
  assert.match(locked, /title: My Diary/); // frontmatter kept
  assert.match(splitFrontmatter(locked).body, /vortex-locked:v1:/);

  const out = unlockContent(locked, "hunter2");
  assert.ok(out);
  assert.equal(out!.body, "Line one of the secret.\nLine two.");
});

test("wrong password fails to unlock", () => {
  const locked = lockContent(NOTE, "correct");
  assert.equal(unlockContent(locked, "wrong"), null);
});

test("unlocking a non-locked note returns null", () => {
  assert.equal(unlockContent(NOTE, "anything"), null);
  assert.equal(isLockedContent(NOTE), false);
});

test("each lock uses a fresh salt (ciphertexts differ)", () => {
  const a = findEnvelope(splitFrontmatter(lockContent(NOTE, "pw")).body);
  const b = findEnvelope(splitFrontmatter(lockContent(NOTE, "pw")).body);
  assert.ok(a && b);
  assert.notDeepEqual(Array.from(a!.salt), Array.from(b!.salt));
});

test("frontmatter (title/tags) stays readable while body is encrypted", () => {
  const locked = lockContent(NOTE, "pw");
  const { frontmatter } = splitFrontmatter(locked);
  assert.match(frontmatter ?? "", /title: My Diary/);
  assert.match(frontmatter ?? "", /private/);
});

// ---------- v2: account-phrase unlock ----------
import { unlockContentWithAccount, wrapLockedBody, keyFromPassword, keyFromAccount, openLockedBody } from "../src/notelock.js";
import { randomBoxKeypair } from "../src/crypto.js";

test("v2 lock: password AND account keypair both unlock", () => {
  const acct = randomBoxKeypair();
  const locked = lockContent(NOTE, "hunter2", acct.pub);
  assert.match(splitFrontmatter(locked).body, /vortex-locked:v2:/);
  assert.ok(isLockedContent(locked));
  assert.ok(!locked.includes("secret"));

  const viaPw = unlockContent(locked, "hunter2");
  assert.equal(viaPw!.body, "Line one of the secret.\nLine two.");
  const viaAcct = unlockContentWithAccount(locked, acct);
  assert.equal(viaAcct!.body, "Line one of the secret.\nLine two.");
});

test("v2 lock: wrong password and wrong account both fail", () => {
  const acct = randomBoxKeypair();
  const locked = lockContent(NOTE, "correct", acct.pub);
  assert.equal(unlockContent(locked, "wrong"), null);
  assert.equal(unlockContentWithAccount(locked, randomBoxKeypair()), null);
});

test("v1 lock: account unlock is impossible (password-only, by design)", () => {
  const locked = lockContent(NOTE, "pw"); // no account pub → v1
  assert.match(splitFrontmatter(locked).body, /vortex-locked:v1:/);
  assert.equal(unlockContentWithAccount(locked, randomBoxKeypair()), null);
});

test("v2 re-lock (edit while unlocked) preserves the account recovery wrap", () => {
  const acct = randomBoxKeypair();
  const locked = lockContent(NOTE, "pw", acct.pub);
  const env = findEnvelope(splitFrontmatter(locked).body)!;
  const key = keyFromPassword(env, "pw")!;
  // simulate the editor saving a new body with the session key
  const rewrapped = wrapLockedBody(env, key, "edited body");
  const env2 = findEnvelope(rewrapped)!;
  // both the password and the account still open the EDITED body
  const kAcct = keyFromAccount(env2, acct);
  assert.ok(kAcct, "account wrap survived the re-lock");
  assert.equal(openLockedBody(env2, kAcct!), "edited body");
  const kPw = keyFromPassword(env2, "pw");
  assert.ok(kPw, "password wrap survived the re-lock");
  assert.equal(openLockedBody(env2, kPw!), "edited body");
});
