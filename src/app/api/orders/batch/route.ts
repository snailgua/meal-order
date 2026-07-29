import { NextResponse } from "next/server";
import { appendRows, getRows, isTombstoneFor } from "@/lib/sheets";
import {
  idempotencyKey,
  normalizeOrderInput,
  requiredText,
} from "@/lib/inputValidation";
import {
  ResourceBusyError,
  withResourceLock,
} from "@/lib/resourceLock";
import { sheetWritesPaused } from "@/lib/maintenance";

export const maxDuration = 60;

// 批次新增訂單（轉錄匯入用）
// Body: { sessionId: string, orders: { name: string, item: string, price: number, note?: string }[] }

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
    const orders = body.orders;

    if (
      !sessionId ||
      !requestId ||
      !Array.isArray(orders) ||
      orders.length === 0
    ) {
      return NextResponse.json(
        { error: "請提供有效的場次 ID、requestId 與至少一筆訂單" },
        { status: 400 }
      );
    }
    if (orders.length > 200) {
      return NextResponse.json(
        { error: "一次最多匯入 200 筆訂單" },
        { status: 400 }
      );
    }

    const normalized = orders.map(normalizeOrderInput);
    const invalidIndex = normalized.findIndex((order) => order === null);
    if (invalidIndex !== -1) {
      return NextResponse.json(
        { error: `第 ${invalidIndex + 1} 筆訂單格式不正確，未匯入任何資料` },
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

      const now = new Date().toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
      });
      const rows: string[][] = [];
      for (let index = 0; index < normalized.length; index++) {
        const order = normalized[index]!;
        const orderId = `o_${requestId}_${index}`;
        if (orderRows.slice(1).some((row) => isTombstoneFor(row, orderId))) {
          return NextResponse.json(
            { error: "這個匯入請求曾建立的訂單已刪除，不能由舊請求重新建立" },
            { status: 409 }
          );
        }
        const existing = orderRows
          .slice(1)
          .find((row) => row[10] === orderId);
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
          continue;
        }
        rows.push([
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
      }
      // append 已成功但回應遺失時，即使場次稍後被關閉，完整重送仍應
      // 回成功；只有真的還有資料要新增時才套用「已關閉」限制。
      if (rows.length > 0 && session[8] === "已關閉") {
        return NextResponse.json(
          { error: "此場次已關閉，無法新增訂單" },
          { status: 400 }
        );
      }
      await appendRows("訂單明細表", rows);

      return NextResponse.json(
        {
          success: true,
          created: normalized.length,
          inserted: rows.length,
          replayed: rows.length === 0,
        },
        { status: rows.length === 0 ? 200 : 201 }
      );
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to batch create orders:", error);
    return NextResponse.json({ error: "批次新增訂單失敗" }, { status: 500 });
  }
}
