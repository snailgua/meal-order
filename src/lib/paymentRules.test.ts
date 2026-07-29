import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaymentSyncUpdates,
  hasMaterialPaymentChange,
  hasPaymentConfirmation,
  isSettledPayment,
} from "./paymentRules";

function paymentRow(overrides: Partial<Record<number, string>> = {}): string[] {
  const row = [
    "s_1",
    "2026-07-29",
    "午餐",
    "小明",
    "小華",
    "100",
    "排骨飯",
    "",
    "FALSE",
    "FALSE",
    "",
    "",
    "o_1",
  ];
  for (const [index, value] of Object.entries(overrides)) {
    if (value !== undefined) row[Number(index)] = value;
  }
  return row;
}

test("material payment changes are detectable without erasing evidence", () => {
  const row = paymentRow({ 8: "TRUE", 11: "2026-07-29T01:00:00Z" });
  const order = {
    name: "小明",
    item: "排骨飯",
    price: 120,
    note: "",
    orderId: "o_1",
  };
  assert.equal(hasMaterialPaymentChange(row, order, "小華"), true);
  const updates = buildPaymentSyncUpdates(
    row,
    order,
    "小華"
  );

  assert.deepEqual(updates, [{ col: 5, value: "120" }]);
});

test("non-financial description changes preserve payer confirmation", () => {
  const row = paymentRow({ 8: "TRUE", 11: "2026-07-29T01:00:00Z" });
  const updates = buildPaymentSyncUpdates(
    row,
    {
      name: "小明",
      item: "雞腿飯",
      price: 100,
      note: "不要辣",
      orderId: "o_1",
    },
    "小華"
  );

  assert.deepEqual(updates, [
    { col: 6, value: "雞腿飯" },
    { col: 7, value: "不要辣" },
  ]);
});

test("payment state helpers treat receiver confirmation as settled", () => {
  assert.equal(isSettledPayment(paymentRow({ 9: "TRUE" })), true);
  assert.equal(hasPaymentConfirmation(paymentRow({ 8: "TRUE" })), true);
  assert.equal(hasPaymentConfirmation(paymentRow()), false);
});
