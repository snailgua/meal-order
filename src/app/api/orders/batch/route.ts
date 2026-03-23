import { NextResponse } from "next/server";
import { getRows, appendRow } from "@/lib/sheets";

// 批次新增訂單（轉錄匯入用）
// Body: { sessionId: string, orders: { name: string, item: string, price: number, note?: string }[] }

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body.sessionId;
    const orders = body.orders;

    if (!sessionId || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { error: "請提供場次 ID 與至少一筆訂單" },
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
    let created = 0;

    for (const order of orders) {
      const name = (order.name || "").trim();
      const item = (order.item || "").trim();
      const price = order.price;
      const note = (order.note || "").trim();

      if (!name || !item || price == null) continue;

      await appendRow("訂單明細表", [
        sessionId,
        session[1], // 日期
        session[2], // 標題
        session[3], // 負責人姓名
        name,
        item,
        String(price),
        note,
        now,
        now,
      ]);
      created++;
    }

    return NextResponse.json({ success: true, created }, { status: 201 });
  } catch (error) {
    console.error("Failed to batch create orders:", error);
    return NextResponse.json({ error: "批次新增訂單失敗" }, { status: 500 });
  }
}
