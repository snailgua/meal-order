import assert from "node:assert/strict";
import test from "node:test";
import {
  isDeletedRow,
  isTombstoneFor,
  tombstoneMarker,
} from "./sheets";

test("keyed tombstones remain deleted and remember the immutable resource key", () => {
  const orderId = "o_1785321234567_123e4567-e89b-42d3-a456-426614174000";
  const row = [tombstoneMarker(orderId)];

  assert.equal(isDeletedRow(row), true);
  assert.equal(isTombstoneFor(row, orderId), true);
  assert.equal(isTombstoneFor(row, "o_other"), false);
  assert.equal(isDeletedRow(["s_1"]), false);
});
