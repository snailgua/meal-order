import assert from "node:assert/strict";
import test from "node:test";
import { decideSessionMutation } from "./sessionVersion";

test("session CAS accepts a fresh mutation and recognizes its retry", () => {
  const closeId = "close-request";
  assert.equal(decideSessionMutation("", "", closeId), "apply");
  assert.equal(decideSessionMutation(closeId, "", closeId), "replay");
});

test("an old close retry cannot close a session after a later reopen", () => {
  const closeId = "close-request";
  const reopenId = "reopen-request";
  assert.equal(decideSessionMutation(reopenId, "", closeId), "conflict");
});
