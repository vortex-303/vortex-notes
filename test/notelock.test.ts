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
