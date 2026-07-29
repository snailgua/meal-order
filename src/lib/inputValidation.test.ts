import assert from "node:assert/strict";
import test from "node:test";
import {
  idempotencyKey,
  normalizeOrderInput,
  positivePrice,
  requiredText,
} from "./inputValidation";

test("positivePrice rejects JavaScript coercion edge cases", () => {
  for (const value of [true, [1], "16", "0x10", 0, -1, Infinity, NaN]) {
    assert.equal(positivePrice(value), null);
  }
  assert.equal(positivePrice(120), 120);
});

test("normalizeOrderInput trims valid text and rejects malformed rows", () => {
  assert.deepEqual(
    normalizeOrderInput({
      name: " 小明 ",
      item: " 排骨飯 ",
      price: 120,
      note: " 不要菜 ",
    }),
    { name: "小明", item: "排骨飯", price: 120, note: "不要菜" }
  );
  assert.equal(normalizeOrderInput(null), null);
  assert.equal(normalizeOrderInput({ name: "小明", item: "飯", price: "120" }), null);
  assert.equal(normalizeOrderInput({ name: 7, item: "飯", price: 120 }), null);
  assert.equal(requiredText("   "), null);
  assert.equal(requiredText("x".repeat(201)), null);
});

test("idempotencyKey only accepts timestamped UUID request IDs", () => {
  const valid = "1785321234567_123e4567-e89b-42d3-a456-426614174000";
  assert.equal(idempotencyKey(valid), valid);
  for (const value of [
    undefined,
    "123e4567-e89b-42d3-a456-426614174000",
    "1785321234567_not-a-uuid",
    "1785321234567_123e4567-e89b-02d3-a456-426614174000",
  ]) {
    assert.equal(idempotencyKey(value), null);
  }
});
