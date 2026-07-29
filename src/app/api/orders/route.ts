import { NextResponse } from "next/server";
import {
  applyAtomicSheetMutations,
  appendRow,
  getRows,
  isTombstoneFor,
  type AtomicSheetMutation,
} from "@/lib/sheets";
import {
  newOrderId,
  planReconcilePayments,
} from "@/lib/reconcilePayments";
import {
  idempotencyKey,
  normalizeOrderInput,
  requiredText,
} from "@/lib/inputValidation";
import {
  hasPaymentConfirmation,
} from "@/lib/paymentRules";
import {
  ResourceBusyError,
  withResourceLock,
} from "@/lib/resourceLock";
import { sheetWritesPaused } from "@/lib/maintenance";

export const maxDuration = 60;

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間 [10]訂單ID
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間 [11]付款人標記時間 [12]訂單ID

// 以訂單ID定位（不可變，不受刪列位移影響）；
// 無 ID 的舊資料退回「rowIndex + 內容驗證」的定位方式
function locateOrderRow(
  rows: string[][],
  orderId: string | undefined,
  rowIndex: number,
  expected?: {
    sessionId: string;
    name: string;
    item: string;
    price: number;
    createdAt?: string;
    note?: string;
    updatedAt?: string;
  }
): number | null {
  if (!expected) {
    if (orderId) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][10] === orderId) return i + 1;
      }
      return null;
    }
    return rowIndex >= 2 && rows[rowIndex - 1] ? rowIndex : null;
  }

  const matches = (r: string[] | undefined) =>
    !!r &&
    r[0] === expected.sessionId &&
    r[4] === expected.name &&
    r[5] === expected.item &&
    Number(r[6]) === expected.price &&
    (!expected.createdAt || r[8] === expected.createdAt) &&
    (expected.note === undefined || (r[7] || "") === expected.note) &&
    (expected.updatedAt === undefined || (r[9] || "") === expected.updatedAt);

  if (orderId) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][10] === orderId) {
        return !expected || matches(rows[i]) ? i + 1 : null;
      }
    }
    return null;
  }

  if (rowIndex >= 2 && matches(rows[rowIndex - 1])) return rowIndex;
  for (let i = 1; i < rows.length; i++) {
    if (matches(rows[i])) return i + 1;
  }
  return null;
}

// 找到訂單的所有付款列（含重複列與已確認列）；任何一列已有付款進度時，
// 都不能再修改/刪除來源訂單，避免讓付款證據對到不同的金額或收款人。
function findPaymentRows(
  rows: string[][],
  sessionId: string,
  orderId: string | undefined,
  order: { name: string; item: string; price: number; note: string }
): { rowNumber: number; row: string[] }[] {
  const exactMatches: { rowNumber: number; row: string[] }[] = [];
  const legacyMatches: { rowNumber: number; row: string[] }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] !== sessionId) continue;
    const contentMatched =
      r[3] === order.name &&
        Number(r[5]) === order.price &&
        (r[6] || "") === order.item &&
        (r[7] || "") === (order.note || "");
    if (orderId && r[12] === orderId) {
      exactMatches.push({ rowNumber: i + 1, row: r });
    } else if (!r[12] && contentMatched) {
      legacyMatches.push({ rowNumber: i + 1, row: r });
    }
  }
  // 有 immutable ID 的列永遠優先；不能因另一筆內容恰好相同，就把無 ID
  // 的舊帳一起認領成同一張訂單。若沒有 exact match，保留所有 legacy
  // 候選只用來做「已有付款證據不可改」檢查，實際一對一配對交給 planner。
  return exactMatches.length > 0 ? exactMatches : legacyMatches;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "缺少 sessionId 參數" },
        { status: 400 }
      );
    }

    const rows = await getRows("訂單明細表");
    const orders = rows
      .slice(1)
      .map((row, index) => ({
        rowIndex: index + 2,
        id: row[10] || "",
        sessionId: row[0],
        name: row[4],
        item: row[5],
        price: Number(row[6]),
        note: row[7] || "",
        createdAt: row[8],
        updatedAt: row[9] || "",
      }))
      .filter((o) => o.sessionId === sessionId);

    return NextResponse.json(orders);
  } catch (error) {
    console.error("Failed to fetch orders:", error);
    return NextResponse.json({ error: "無法載入訂單" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const sessionId = requiredText(body.sessionId);
    const requestId = idempotencyKey(body.requestId);
    const order = normalizeOrderInput(body);

    if (!sessionId || !requestId || !order) {
      return NextResponse.json(
        { error: "requestId、姓名、品項與價格格式不正確" },
        { status: 400 }
      );
    }
    return await withResourceLock(`session:${sessionId}`, async () => {
      const [sessionRows, orderRows] = await Promise.all([
        getRows("訂餐場次表"),
        getRows("訂單明細表"),
      ]);
      const session = sessionRows.slice(1).find((r) => r[0] === sessionId);
      if (!session) {
        return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
      }

      const orderId = newOrderId(requestId);
      const existing = orderRows
        .slice(1)
        .find((row) => row[10] === orderId);
      const deleted = orderRows
        .slice(1)
        .some((row) => isTombstoneFor(row, orderId));
      if (deleted) {
        return NextResponse.json(
          { error: "這個建立請求對應的訂單已刪除，不能由舊請求重新建立" },
          { status: 409 }
        );
      }
      if (existing) {
        const sameRequest =
          existing[0] === sessionId &&
          existing[4] === order.name &&
          existing[5] === order.item &&
          Number(existing[6]) === order.price &&
          (existing[7] || "") === order.note;
        if (!sameRequest) {
          return NextResponse.json(
            { error: "requestId 已用於不同的訂單內容，請重新整理後再試" },
            { status: 409 }
          );
        }
        return NextResponse.json({
          success: true,
          orderId,
          replayed: true,
        });
      }
      if (session[8] === "已關閉") {
        return NextResponse.json(
          { error: "此場次已關閉，無法新增訂單" },
          { status: 400 }
        );
      }

      const now = new Date().toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
      });
      await appendRow("訂單明細表", [
        sessionId,
        session[1], // 日期
        session[2], // 標題
        session[3], // 負責人姓名
        order.name,
        order.item,
        String(order.price),
        order.note,
        now,
        now,
        orderId,
      ]);

      return NextResponse.json(
        { success: true, orderId, replayed: false },
        { status: 201 }
      );
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to create order:", error);
    return NextResponse.json({ error: "新增訂單失敗" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const orderId = requiredText(body.orderId) || undefined;
    const rowIndex = Number(body.rowIndex);
    const sessionId = requiredText(body.sessionId);
    const updated = normalizeOrderInput(body);
    const originalInput =
      body.original &&
      typeof body.original === "object" &&
      !Array.isArray(body.original)
        ? (body.original as Record<string, unknown>)
        : null;
    const original = originalInput
      ? normalizeOrderInput({
          ...originalInput,
          note: originalInput.note ?? "",
        })
      : null;
    const originalCreatedAt = requiredText(originalInput?.createdAt);
    const originalUpdatedAt =
      typeof originalInput?.updatedAt === "string"
        ? originalInput.updatedAt
        : undefined;

    if (
      (!orderId && (!Number.isInteger(rowIndex) || rowIndex < 2)) ||
      !sessionId ||
      !updated ||
      !original
    ) {
      return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
    }
    return await withResourceLock(`session:${sessionId}`, async () => {
      const [orderRows, sessionRows, paymentRows] = await Promise.all([
        getRows("訂單明細表"),
        getRows("訂餐場次表"),
        getRows("付款追蹤表"),
      ]);
      const session = sessionRows.slice(1).find((r) => r[0] === sessionId);
      if (!session) {
        return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
      }

      const expected = {
        sessionId,
        name: original.name,
        item: original.item,
        price: original.price,
        note: original.note,
        createdAt: originalCreatedAt || undefined,
        updatedAt: originalUpdatedAt,
      };
      let targetRow = locateOrderRow(
        orderRows,
        orderId,
        rowIndex,
        expected
      );
      let replayed = false;
      if (targetRow === null) {
        const retryRow = orderId
          ? locateOrderRow(orderRows, orderId, rowIndex)
          : rowIndex >= 2
            ? rowIndex
            : null;
        const current = retryRow ? orderRows[retryRow - 1] : undefined;
        const alreadyApplied =
          current?.[0] === sessionId &&
          current[4] === updated.name &&
          current[5] === updated.item &&
          Number(current[6]) === updated.price &&
          (current[7] || "") === updated.note &&
          (!originalCreatedAt || current[8] === originalCreatedAt);
        if (!retryRow || !alreadyApplied) {
          return NextResponse.json(
            { error: "這筆訂單已被其他人修改或刪除，請重新整理後再試" },
            { status: 409 }
          );
        }
        targetRow = retryRow;
        replayed = true;
      }

      const oldRow = orderRows[targetRow - 1];
      if (!oldRow || oldRow[0] !== sessionId) {
        return NextResponse.json(
          { error: "訂單不屬於此場次，請重新整理後再試" },
          { status: 409 }
        );
      }
      const old = {
        name: oldRow[4],
        item: oldRow[5],
        price: Number(oldRow[6]),
        note: oldRow[7] || "",
      };
      const changed =
        old.name !== updated.name ||
        old.item !== updated.item ||
        old.price !== updated.price ||
        old.note !== updated.note;
      if (!changed) {
        if (replayed) {
          const replayMutations = planReconcilePayments(
            sessionId,
            session,
            orderRows,
            paymentRows,
            { createMissing: session[8] === "已關閉" }
          );
          await applyAtomicSheetMutations(replayMutations);
        }
        return NextResponse.json({ success: true, replayed });
      }

      const payments = findPaymentRows(
        paymentRows,
        sessionId,
        oldRow[10] || orderId,
        old
      );
      if (payments.some(({ row }) => hasPaymentConfirmation(row))) {
        return NextResponse.json(
          { error: "這筆帳款已有人標記付款，為保留對帳紀錄，訂單不能再修改" },
          { status: 409 }
        );
      }

      // 與 POST／batch 一致用台北時間中文格式；Sheet 是團主會直接打開看的
      const now = new Date().toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
      });
      const projectedOrderRows = orderRows.map((row) => [...row]);
      projectedOrderRows[targetRow - 1][4] = updated.name;
      projectedOrderRows[targetRow - 1][5] = updated.item;
      projectedOrderRows[targetRow - 1][6] = String(updated.price);
      projectedOrderRows[targetRow - 1][7] = updated.note;
      projectedOrderRows[targetRow - 1][9] = now;
      const mutations: AtomicSheetMutation[] = [
        {
          type: "updateCells",
          sheetName: "訂單明細表",
          rowNumber: targetRow,
          updates: [
            { col: 4, value: updated.name },
            { col: 5, value: updated.item },
            { col: 6, value: String(updated.price) },
            { col: 7, value: updated.note },
            { col: 9, value: now },
          ],
        },
        ...planReconcilePayments(
          sessionId,
          session,
          projectedOrderRows,
          paymentRows,
          { createMissing: session[8] === "已關閉" }
        ),
      ];
      await applyAtomicSheetMutations(mutations);

      return NextResponse.json({ success: true });
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to update order:", error);
    return NextResponse.json({ error: "更新訂單失敗" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const { searchParams } = new URL(request.url);
    const orderId = requiredText(searchParams.get("orderId")) || undefined;
    const rowIndex = Number(searchParams.get("rowIndex"));
    const sessionId = requiredText(searchParams.get("sessionId"));
    const name = searchParams.get("name");
    const item = searchParams.get("item");
    const price = searchParams.get("price");
    const createdAt = searchParams.get("createdAt");
    const note = searchParams.get("note");
    const updatedAt = searchParams.get("updatedAt");

    if (
      !sessionId ||
      (!orderId && (!Number.isInteger(rowIndex) || rowIndex < 2))
    ) {
      return NextResponse.json({ error: "無效的參數" }, { status: 400 });
    }

    return await withResourceLock(`session:${sessionId}`, async () => {
      const [orderRows, paymentRows] = await Promise.all([
        getRows("訂單明細表"),
        getRows("付款追蹤表"),
      ]);
      const expected =
        name && item && price
          ? {
              sessionId,
              name,
              item,
              price: Number(price),
              note: note ?? undefined,
              createdAt: createdAt || undefined,
              updatedAt: updatedAt ?? undefined,
            }
          : undefined;
      const targetRow = locateOrderRow(orderRows, orderId, rowIndex, expected);

      if (targetRow === null) {
        const existingIdRow = orderId
          ? orderRows.slice(1).find((row) => row[10] === orderId)
          : undefined;
        if (existingIdRow) {
          return NextResponse.json(
            { error: "這筆訂單已被其他人修改，請重新整理後再試" },
            { status: 409 }
          );
        }

        // 上一次刪除若只完成訂單 tombstone，重試仍可用 orderId
        // 清掉未確認的 orphan payment；已確認紀錄一律保留。
        if (orderId) {
          const orphanMutations: AtomicSheetMutation[] = [];
          for (let i = 1; i < paymentRows.length; i++) {
            const payment = paymentRows[i];
            if (
              payment[0] === sessionId &&
              payment[12] === orderId &&
              !hasPaymentConfirmation(payment)
            ) {
              orphanMutations.push({
                type: "tombstoneRow",
                sheetName: "付款追蹤表",
                rowNumber: i + 1,
              });
            }
          }
          await applyAtomicSheetMutations(orphanMutations);
          return NextResponse.json({ success: true });
        }

        return NextResponse.json(
          { error: "這筆訂單已被其他人修改或刪除，請重新整理後再試" },
          { status: 409 }
        );
      }

      const row = orderRows[targetRow - 1];
      if (!row || row[0] !== sessionId) {
        return NextResponse.json(
          { error: "訂單不屬於此場次，請重新整理後再試" },
          { status: 409 }
        );
      }
      const old = {
        name: row[4],
        item: row[5],
        price: Number(row[6]),
        note: row[7] || "",
      };
      const payments = findPaymentRows(
        paymentRows,
        sessionId,
        row[10] || orderId,
        old
      );
      if (payments.some(({ row: payment }) => hasPaymentConfirmation(payment))) {
        return NextResponse.json(
          { error: "這筆帳款已有人標記付款，為保留對帳紀錄，訂單不能刪除" },
          { status: 409 }
        );
      }
      // 有 immutable ID 時同一訂單最多一列，全部刪掉是對的；退回內容比對時
      // 多列代表「同一人點了多份一模一樣的餐」，一次刪一張訂單只能抵銷一列，
      // 否則另一份的欠款會憑空消失。
      const paymentsToRemove = payments.every(({ row: p }) => p[12])
        ? payments
        : payments.slice(0, 1);

      await applyAtomicSheetMutations([
        ...paymentsToRemove.map(
          (payment): AtomicSheetMutation => ({
            type: "tombstoneRow",
            sheetName: "付款追蹤表",
            rowNumber: payment.rowNumber,
          })
        ),
        {
          type: "tombstoneRow",
          sheetName: "訂單明細表",
          rowNumber: targetRow,
          key: row[10] || orderId,
        },
      ]);

      return NextResponse.json({ success: true });
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to delete order:", error);
    return NextResponse.json({ error: "刪除訂單失敗" }, { status: 500 });
  }
}
