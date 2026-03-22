import { NextResponse } from "next/server";
import { getRows, appendRow, updateRow, deleteRow } from "@/lib/sheets";

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間

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
    const { sessionId, name, item, price, note } = body;

    if (!sessionId || !name || !item || price == null) {
      return NextResponse.json(
        { error: "請填寫所有必填欄位" },
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

    const now = new Date().toISOString();
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
    const { rowIndex, sessionId, name, item, price, note, createdAt } = body;

    if (!rowIndex || !sessionId || !name || !item || price == null) {
      return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    const sessionRows = await getRows("訂餐場次表");
    const session = sessionRows.slice(1).find((r) => r[0] === sessionId);

    const now = new Date().toISOString();
    await updateRow("訂單明細表", rowIndex, [
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

    if (!rowIndex || rowIndex < 2) {
      return NextResponse.json({ error: "無效的 rowIndex" }, { status: 400 });
    }

    await deleteRow("訂單明細表", rowIndex);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete order:", error);
    return NextResponse.json({ error: "刪除訂單失敗" }, { status: 500 });
  }
}
