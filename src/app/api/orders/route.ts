import { NextResponse } from "next/server";
import { getRows, appendRow, updateRow, deleteRow } from "@/lib/sheets";

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間 [11]付款人標記時間

function parsePrice(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// rowIndex 是讀取當下的試算表列號，別人刪列後會位移。
// 先驗證該列內容是否仍相符，不符就用內容重新定位；找不到回 null。
function locateOrderRow(
  rows: string[][],
  rowIndex: number,
  expected: {
    sessionId: string;
    name: string;
    item: string;
    price: number;
    createdAt?: string;
  }
): number | null {
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

// 場次關閉後訂單仍可修改（對帳模式下修錯字是常態），
// 這裡把變動同步到對應的未核銷付款列，避免訂單與欠款金額不一致
async function findPaymentRow(
  sessionId: string,
  order: { name: string; item: string; price: number; note: string }
): Promise<{ rowNumber: number; row: string[] } | null> {
  const rows = await getRows("付款追蹤表");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (
      r[0] === sessionId &&
      r[3] === order.name &&
      Number(r[5]) === order.price &&
      (r[6] || "") === order.item &&
      (r[7] || "") === (order.note || "") &&
      !r[10] // 未核銷
    ) {
      return { rowNumber: i + 1, row: r };
    }
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
    ]);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to create order:", error);
    return NextResponse.json({ error: "新增訂單失敗" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const rowIndex = body.rowIndex;
    const sessionId = body.sessionId;
    const name = (body.name || "").trim();
    const item = (body.item || "").trim();
    const price = parsePrice(body.price);
    const note = (body.note || "").trim();
    const createdAt = body.createdAt;
    // original: 客戶端讀到的原始內容，用來驗證 rowIndex 沒有位移
    const original = body.original;

    if (!rowIndex || !sessionId || !name || !item) {
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

    let targetRow = rowIndex;
    if (original) {
      const located = locateOrderRow(orderRows, rowIndex, {
        sessionId,
        name: original.name,
        item: original.item,
        price: Number(original.price),
        createdAt: original.createdAt || createdAt,
      });
      if (located === null) {
        return NextResponse.json(
          { error: "這筆訂單已被其他人修改或刪除，請重新整理後再試" },
          { status: 409 }
        );
      }
      targetRow = located;
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
      createdAt || now,
      now,
    ]);

    // 同步未核銷的付款列（場次已關閉時才會有）
    const payment = await findPaymentRow(sessionId, old);
    if (payment) {
      const r = payment.row;
      r[3] = name;
      r[5] = String(price);
      r[6] = item;
      r[7] = note || "";
      for (let i = 0; i < 12; i++) {
        if (r[i] === undefined || r[i] === null) r[i] = "";
      }
      await updateRow("付款追蹤表", payment.rowNumber, r);
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
    const rowIndex = Number(searchParams.get("rowIndex"));
    const sessionId = searchParams.get("sessionId");
    const name = searchParams.get("name");
    const item = searchParams.get("item");
    const price = searchParams.get("price");
    const createdAt = searchParams.get("createdAt");

    if (!rowIndex || rowIndex < 2) {
      return NextResponse.json({ error: "無效的 rowIndex" }, { status: 400 });
    }

    let targetRow = rowIndex;
    let old: { name: string; item: string; price: number; note: string } | null =
      null;

    if (sessionId && name && item && price) {
      const orderRows = await getRows("訂單明細表");
      const located = locateOrderRow(orderRows, rowIndex, {
        sessionId,
        name,
        item,
        price: Number(price),
        createdAt: createdAt || undefined,
      });
      if (located === null) {
        return NextResponse.json(
          { error: "這筆訂單已被其他人修改或刪除，請重新整理後再試" },
          { status: 409 }
        );
      }
      targetRow = located;
      const r = orderRows[targetRow - 1];
      old = {
        name: r[4],
        item: r[5],
        price: Number(r[6]),
        note: r[7] || "",
      };
    }

    await deleteRow("訂單明細表", targetRow);

    // 同步刪除未核銷的付款列，避免訂單刪了欠款還在
    if (sessionId && old) {
      const payment = await findPaymentRow(sessionId, old);
      if (payment) {
        await deleteRow("付款追蹤表", payment.rowNumber);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete order:", error);
    return NextResponse.json({ error: "刪除訂單失敗" }, { status: 500 });
  }
}
