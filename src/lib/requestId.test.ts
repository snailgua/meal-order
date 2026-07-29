import assert from "node:assert/strict";
import test from "node:test";
import { idempotencyKey } from "./inputValidation";

async function freshNewRequestId() {
  // 每個測試都要重新載入，才能讓 globalThis.crypto 的替換生效
  const loaded = await import(`./requestId?t=${process.hrtime.bigint()}`);
  return loaded.newRequestId as () => string;
}

test("newRequestId is accepted by the server-side idempotency validator", async () => {
  const newRequestId = await freshNewRequestId();
  const id = newRequestId();
  assert.equal(idempotencyKey(id), id);
});

test("the fallback path still produces a valid key without crypto.randomUUID", async () => {
  // 手機連區網 dev server（http 非 secure context）或舊 in-app 瀏覽器
  // 都沒有 crypto.randomUUID；少了 fallback，整個 app 會完全無法寫入。
  const original = globalThis.crypto;
  const { getRandomValues } = original;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: getRandomValues.bind(original),
    },
  });
  try {
    const newRequestId = await freshNewRequestId();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newRequestId();
      assert.equal(idempotencyKey(id), id, `拒絕了 fallback 產生的 ${id}`);
      ids.add(id);
    }
    assert.equal(ids.size, 200, "fallback 產生了重複的 requestId");
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});

test("the last-resort path works even without getRandomValues", async () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {},
  });
  try {
    const newRequestId = await freshNewRequestId();
    const id = newRequestId();
    assert.equal(idempotencyKey(id), id);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});
