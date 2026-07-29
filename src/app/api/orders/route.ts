import { NextResponse } from "next/server";
import {
  getRows,
  appendRow,
  updateRow,
  deleteRow,
  updateCells,
} from "@/lib/sheets";
import { reconcilePayments, newOrderId } from "@/lib/reconcilePayments";

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間 [10]訂單ID
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間 [11]付款人標記時間 [12]訂單ID

function parsePrice(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
  }
): number | null {
  if (orderId) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][10] === orderId) return i + 1;
    }
    return null;
  }
  if (!expected) {
    return rowIndex >= 2 && rows[rowIndex - 1] ? rowIndex : null;
  }
  const matches = (r: string[] | undefined) =>
    !!r &&
    r[0] === expected.sessionId &&
    r[4] === expected.name &&
    r[5] === expected.item &&
    Number(r[6]) === expected.price &&
    (!expected.createdAt || r[8] === expected.createdAt);

  if (rowIndex >= 2 && matches(rows[rowIndex - 1])) return rowIndex;
  for (let i = 1; i < rows.length; i++) {
    if (matches(rows[i])) return i + 1;
  }
  return null;
}

// 找到訂單對應的未核銷付款列（優先以訂單ID，舊資料退回內容比對）
async function findPaymentRow(
  sessionId: string,
  orderId: string | undefined,
  order: { name: string; item: string; price: number; note: string }
): Promise<{ rowNumber: number; row: string[] } | null> {
  const rows = await getRows("付款追蹤表");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] !== sessionId || r[10]) continue; // 非本場次或已核銷
    const matched = orderId
      ? r[12] === orderId
      : r[3] === order.name &&
        Number(r[5]) === order.price &&
        (r[6] || "") === order.item &&
        (r[7] || "") === (order.note || "");
    if (matched) return { rowNumber: i + 1, row: r };
  }
  return null;
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
  try {
    const body = await request.json();
    const sessionId = body.sessionId;
    const name = (body.name || "").trim();
    const item = (body.item || "").trim();
    const price = parsePrice(body.price);
    const note = (body.note || "").trim();

    if (!sessionId || !name || !item) {
      return NextResponse.json(
        { error: "請填寫所有必填欄位" },
        { status: 400 }
      );
    }
    if (price === null) {
      return NextResponse.json(
        { error: "價格必須是大於 0 的數字" },
        { status: 400 }
      );
    }

    // Check session is open
    const sessionRows = await getRows("訂餐場次表");
    const session = sessionRows.slice(1).find((r) => r[0] === sessionId);
    if (!session) {
      return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
    }
    if (session[8] === "已關閉") {
      return NextResponse.json(
        { error: "此場次已關閉，無法新增訂單" },
        { status: 400 }
      );
    }

    const orderId = newOrderId();
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    await appendRow("訂單明細表", [
      sessionId,
      session[1], // 日期
      session[2], // 標題
      session[3], // 負責人姓名
      name,
      item,
      String(price),
      note || "",
      now,
      now,
      orderId,
    ]);

    // 上面檢查「開放中」到寫入之間場次可能剛好被關閉，
    // 補跑 reconcile 讓這筆訂單也有付款列，避免「已關閉、有訂單、沒帳」
    const afterRows = await getRows("訂餐場次表");
    const after = afterRows.slice(1).find((r) => r[0] === sessionId);
    if (after && after[8] === "已關閉") {
      await reconcilePayments(sessionId, after);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to create order:", error);
    return NextResponse.json({ error: "新增訂單失敗" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const orderId = body.orderId || undefined;
    const rowIndex = body.rowIndex;
    const sessionId = body.sessionId;
    const name = (body.name || "").trim();
    const item = (body.item || "").trim();
    const price = parsePrice(body.price);
    const note = (body.note || "").trim();
    const createdAt = body.createdAt;
    // original: 客戶端讀到的原始內容（無訂單ID的舊資料用來驗證 rowIndex）
    const original = body.original;

    if ((!orderId && !rowIndex) || !sessionId || !name || !item) {
      return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
    }
    if (price === null) {
      return NextResponse.json(
        { error: "價格必須是大於 0 的數字" },
        { status: 400 }
      );
    }

    const [orderRows, sessionRows] = await Promise.all([
      getRows("訂單明細表"),
      getRows("訂餐場次表"),
    ]);
    const session = sessionRows.slice(1).find((r) => r[0] === sessionId);

    const targetRow = locateOrderRow(
      orderRows,
      orderId,
      rowIndex,
      original && {
        sessionId,
        name: original.name,
        item: original.item,
        price: Number(original.price),
        createdAt: original.createdAt || createdAt,
      }
    );
    if (targetRow === null) {
      return NextResponse.json(
        { error: "這筆訂單已被其他人修改或刪除，請重新整理後再試" },
        { status: 409 }
      );
    }

    const oldRow = orderRows[targetRow - 1];
    if (!oldRow) {
      return NextResponse.json({ error: "找不到此筆訂單" }, { status: 404 });
    }
    const old = {
      name: oldRow[4],
      item: oldRow[5],
      price: Number(oldRow[6]),
      note: oldRow[7] || "",
    };

    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    await updateRow("訂單明細表", targetRow, [
      sessionId,
      session?.[1] || "", // 日期
      session?.[2] || "", // 標題
      session?.[3] || "", // 負責人姓名
      name,
      item,
      String(price),
      note || "",
      createdAt || oldRow[8] || now,
      now,
      oldRow[10] || "",
    ]);

    // 同步未核銷的付款列
    const organizer = session?.[3] || "";
    const payment = await findPaymentRow(sessionId, oldRow[10], old);
    if (name === organizer) {
      // 訂購人改成團主 → 不需付款，刪除既有欠款
      if (payment) await deleteRow("付款追蹤表", payment.rowNumber);
    } else if (payment) {
      await updateCells("付款追蹤表", payment.rowNumber, [
        { col: 3, value: name },
        { col: 5, value: String(price) },
        { col: 6, value: item },
        { col: 7, value: note || "" },
      ]);
    } else if (session && session[8] === "已關閉") {
      // 原本是團主（或漏建）現在改成別人 → 補建欠款
      await reconcilePayments(sessionId, session);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update order:", error);
    return NextResponse.json({ error: "更新訂單失敗" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId") || undefined;
    const rowIndex = Number(searchParams.get("rowIndex"));
    const sessionId = searchParams.get("sessionId");
    const name = searchParams.get("name");
    const item = searchParams.get("item");
    const price = searchParams.get("price");
    const createdAt = searchParams.get("createdAt");

    if (!orderId && (!rowIndex || rowIndex < 2)) {
      return NextResponse.json({ error: "無效的參數" }, { status: 400 });
    }

    const orderRows = await getRows("訂單明細表");
    const expected =
      sessionId && name && item && price
        ? {
            sessionId,
            name,
            item,
            price: Number(price),
            createdAt: createdAt || undefined,
          }
        : undefined;
    const targetRow = locateOrderRow(orderRows, orderId, rowIndex, expected);
    if (targetRow === null) {
      return NextResponse.json(
        { error: "這筆訂單已被其他人修改或刪除，請重新整理後再試" },
        { status: 409 }
      );
    }

    const r = orderRows[targetRow - 1];
    const rowSessionId = r[0];
    const old = {
      name: r[4],
      item: r[5],
      price: Number(r[6]),
      note: r[7] || "",
    };
    const rowOrderId = r[10];

    await deleteRow("訂單明細表", targetRow);

    // 同步刪除未核銷的付款列，避免訂單刪了欠款還在
    const payment = await findPaymentRow(rowSessionId, rowOrderId, old);
    if (payment) {
      await deleteRow("付款追蹤表", payment.rowNumber);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete order:", error);
    return NextResponse.json({ error: "刪除訂單失敗" }, { status: 500 });
  }
}
