import assert from "node:assert/strict";
import test from "node:test";
import {
  newOrderId,
  planReconcilePayments,
} from "./reconcilePayments";

const NOW = Date.parse("2026-07-29T12:00:00+08:00");

function sessionRow(date: string): string[] {
  return [
    "s_1",
    date,
    "午餐",
    "小華",
    "",
    "",
    "",
    "",
    "已關閉",
  ];
}

function orderRows(): string[][] {
  return [
    ["場次ID"],
    [
      "s_1",
      "2026-01-01",
      "午餐",
      "小華",
      "小明",
      "排骨飯",
      "100",
      "",
      "created",
      "updated",
      "o_1",
    ],
  ];
}

test("old closed sessions do not recreate missing payment rows", () => {
  const mutations = planReconcilePayments(
    "s_1",
    sessionRow("2026-01-01"),
    orderRows(),
    [["場次ID"]],
    { now: NOW }
  );

  assert.equal(
    mutations.some((mutation) => mutation.type === "appendRows"),
    false
  );
});

test("a real open-to-closed transition can create an old session payment", () => {
  const mutations = planReconcilePayments(
    "s_1",
    sessionRow("2026-01-01"),
    orderRows(),
    [["場次ID"]],
    { allowArchivedCreate: true, now: NOW }
  );

  assert.deepEqual(mutations, [
    {
      type: "appendRows",
      sheetName: "付款追蹤表",
      rows: [
        [
          "s_1",
          "2026-01-01",
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
        ],
      ],
    },
  ]);
});

test("a compact settled archive marker still consumes its order", () => {
  const archivedPayment = [
    "s_1",
    "__ARCHIVED_PAYMENT__",
    "",
    "",
    "",
    "",
    "",
    "",
    "TRUE",
    "TRUE",
    "2026-04-01T00:00:00.000Z",
    "",
    "o_1",
  ];
  const mutations = planReconcilePayments(
    "s_1",
    sessionRow("2026-01-01"),
    orderRows(),
    [["場次ID"], archivedPayment],
    { allowArchivedCreate: true, now: NOW }
  );

  assert.deepEqual(mutations, []);
});

test("request ids produce deterministic order ids", () => {
  assert.equal(
    newOrderId("1774761600000_123e4567-e89b-12d3-a456-426614174000"),
    "o_1774761600000_123e4567-e89b-12d3-a456-426614174000"
  );
});

test("identical legacy payment rows are paired one-to-one and deduplicated", () => {
  const orders = [
    ["場次ID"],
    [
      "s_1",
      "2026-07-29",
      "午餐",
      "小華",
      "小明",
      "雞腿飯",
      "120",
      "",
      "created",
      "updated",
      "o_1",
    ],
    [
      "s_1",
      "2026-07-29",
      "午餐",
      "小華",
      "小明",
      "排骨飯",
      "100",
      "",
      "created",
      "updated",
      "o_2",
    ],
  ];
  const legacyPayment = [
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
    "",
  ];

  const mutations = planReconcilePayments(
    "s_1",
    sessionRow("2026-07-29"),
    orders,
    [["場次ID"], legacyPayment, [...legacyPayment]],
    { now: NOW }
  );

  assert.equal(
    mutations.filter((mutation) => mutation.type === "appendRows").length,
    1
  );
  assert.deepEqual(
    mutations.filter((mutation) => mutation.type === "tombstoneRow"),
    [
      {
        type: "tombstoneRow",
        sheetName: "付款追蹤表",
        rowNumber: 3,
      },
    ]
  );
  assert.ok(
    mutations.some(
      (mutation) =>
        mutation.type === "updateCells" &&
        mutation.rowNumber === 2 &&
        mutation.updates.some(
          (update) => update.col === 12 && update.value === "o_2"
        )
    )
  );
});

test("a confirmed payment that lost its order does not get billed twice", () => {
  // 團主直接在 Sheet 上改了品項（或舊資料 ID 對不上），付款人已按「我已轉帳」。
  // 保留這列是對的，但若同時又為對應訂單補一列，這個人就會被要求付兩次。
  const orders = [
    ["場次ID"],
    [
      "s_1",
      "2026-07-29",
      "午餐",
      "小華",
      "小明",
      "爌肉飯",
      "100",
      "",
      "created",
      "updated",
      "o_1",
    ],
  ];
  const orphanPayment = [
    "s_1",
    "2026-07-29",
    "午餐",
    "小明",
    "小華",
    "100",
    "控肉飯",
    "",
    "TRUE",
    "FALSE",
    "",
    "2026-07-29T04:00:00.000Z",
    "",
  ];

  const mutations = planReconcilePayments(
    "s_1",
    ["s_1", "2026-07-29", "午餐", "小華", "", "", "", "", "已關閉"],
    orders,
    [["場次ID"], orphanPayment],
    { now: NOW }
  );

  assert.equal(
    mutations.some((mutation) => mutation.type === "appendRows"),
    false,
    "不應為已有付款證據的同人同金額再補一列欠款"
  );
  assert.equal(
    mutations.some((mutation) => mutation.type === "tombstoneRow"),
    false,
    "有付款證據的列必須保留"
  );
});

test("an unconfirmed orphan is still replaced by a correct new payment row", () => {
  const orders = [
    ["場次ID"],
    [
      "s_1",
      "2026-07-29",
      "午餐",
      "小華",
      "小明",
      "爌肉飯",
      "100",
      "",
      "created",
      "updated",
      "o_1",
    ],
  ];
  const staleOrphan = [
    "s_1",
    "2026-07-29",
    "午餐",
    "小明",
    "小華",
    "100",
    "控肉飯",
    "",
    "FALSE",
    "FALSE",
    "",
    "",
    "",
  ];

  const mutations = planReconcilePayments(
    "s_1",
    ["s_1", "2026-07-29", "午餐", "小華", "", "", "", "", "已關閉"],
    orders,
    [["場次ID"], staleOrphan],
    { now: NOW }
  );

  assert.equal(
    mutations.some((mutation) => mutation.type === "tombstoneRow"),
    true,
    "沒有付款證據的過期列該被清掉"
  );
  assert.equal(
    mutations.some((mutation) => mutation.type === "appendRows"),
    true,
    "並補上與訂單一致的欠款"
  );
});

test("a reconcile that cannot create must not delete either", () => {
  // 超過 90 天保留期的舊場次：Pass 3 補建被關掉。若 Pass 2/4 照樣刪掉
  // 配不到訂單的列，reconcile 就會淨減少欠款 —— 錢就這樣不見了。
  const orders = [
    ["場次ID"],
    [
      "s_1",
      "2026-01-01",
      "午餐",
      "小華",
      "小明",
      "爌肉飯",
      "100",
      "",
      "created",
      "updated",
      "o_1",
    ],
  ];
  const staleRow = [
    "s_1",
    "2026-01-01",
    "午餐",
    "小美",
    "小華",
    "80",
    "已刪除的餐",
    "",
    "FALSE",
    "FALSE",
    "",
    "",
    "o_gone",
  ];

  const blocked = planReconcilePayments(
    "s_1",
    sessionRow("2026-01-01"),
    orders,
    [["場次ID"], staleRow],
    { now: NOW }
  );
  assert.equal(
    blocked.some((mutation) => mutation.type === "tombstoneRow"),
    false,
    "不能補建時也不該刪除，否則欠款淨減少"
  );

  // 允許補建時（真正的開放→關閉轉換）才可以連帶清掉對不上的列
  const allowed = planReconcilePayments(
    "s_1",
    sessionRow("2026-01-01"),
    orders,
    [["場次ID"], staleRow],
    { allowArchivedCreate: true, now: NOW }
  );
  assert.equal(
    allowed.some((mutation) => mutation.type === "tombstoneRow"),
    true,
    "可以補建時就該一起清掉孤兒列"
  );
  assert.equal(
    allowed.some((mutation) => mutation.type === "appendRows"),
    true,
    "並補上正確的欠款"
  );
});
