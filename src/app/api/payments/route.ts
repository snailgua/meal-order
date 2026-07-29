import { NextResponse } from "next/server";
import { getRows, isDeletedRow, updateCells } from "@/lib/sheets";
import { isSettledPayment } from "@/lib/paymentRules";
import {
  ResourceBusyError,
  withResourceLock,
} from "@/lib/resourceLock";
import { sheetWritesPaused } from "@/lib/maintenance";

export const maxDuration = 60;

// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間
// [11]付款人標記時間 [12]訂單ID

export async function GET() {
  try {
    const [paymentRows, sessionRows] = await Promise.all([
      getRows("付款追蹤表"),
      getRows("訂餐場次表"),
    ]);

    // Build session lookup
    const sessionMap: Record<
      string,
      {
        title: string;
        date: string;
        bankName: string;
        bankAccount: string;
        qrCodeUrl: string;
        transferLink: string;
        status: string;
        version: string;
      }
    > = {};
    for (const row of sessionRows.slice(1)) {
      sessionMap[row[0]] = {
        title: row[2],
        date: row[1],
        bankName: row[4],
        bankAccount: row[5],
        qrCodeUrl: row[6] || "",
        transferLink: row[7] || "",
        status: row[8] || "",
        version: row[11] || "",
      };
    }

    const payments = paymentRows
      .slice(1)
      .map((row, index) => {
        if (isDeletedRow(row)) return null;
        const payerConfirmed = row[8] === "TRUE";
        const receiverConfirmed = row[9] === "TRUE";
        const settledAt = row[10] || null;
        const payerConfirmedAt = row[11] || null;

        // 與 isSettledPayment / reconcile 用同一條判定：收款人確認就是收到錢。
        // 若這裡只認「兩邊都 TRUE」，收款人已確認但付款人旗標沒寫上的列會
        // 一直顯示成未付款，而 PATCH 又拒絕它，變成誰也結不掉的殭屍列。
        if (isSettledPayment(row)) return null;

        const sessionId = row[0];
        const session = sessionMap[sessionId];
        // 欠款只有在核銷或被 tombstone 時才該從清單消失。場次重新開放中
        // 或場次列意外遺失都只是標記狀態，靜默隱藏會讓人以為帳已經清掉。
        return {
          rowIndex: index + 2,
          orderId: row[12] || "",
          sessionId,
          payer: row[3],
          receiver: row[4],
          amount: Number(row[5]),
          item: row[6] || "",
          note: row[7] || "",
          payerConfirmed,
          receiverConfirmed,
          settledAt,
          payerConfirmedAt,
          sessionTitle: session?.title || "",
          sessionDate: session?.date || row[1] || "",
          bankName: session?.bankName || "",
          bankAccount: session?.bankAccount || "",
          qrCodeUrl: session?.qrCodeUrl || "",
          transferLink: session?.transferLink || "",
          sessionVersion: session?.version || "",
          sessionOpen: session?.status === "開放中",
        };
      })
      .filter(Boolean);

    return NextResponse.json(payments);
  } catch (error) {
    console.error("Failed to fetch payments:", error);
    return NextResponse.json({ error: "無法載入付款資料" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const { rowIndex, action, expected } = body;

    if (
      !Number.isInteger(rowIndex) ||
      rowIndex < 2 ||
      !["payerConfirm", "receiverConfirm", "payerUndo"].includes(action) ||
      !expected ||
      typeof expected.sessionId !== "string" ||
      !expected.sessionId ||
      typeof expected.payer !== "string" ||
      typeof expected.receiver !== "string" ||
      typeof expected.amount !== "number" ||
      !Number.isFinite(expected.amount) ||
      expected.amount <= 0 ||
      typeof expected.item !== "string" ||
      typeof expected.note !== "string" ||
      (expected.orderId !== undefined &&
        typeof expected.orderId !== "string")
    ) {
      return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });
    }

    const sessionId = expected.sessionId;
    return await withResourceLock(`session:${sessionId}`, async () => {
      // 付款列本身就是欠款的紀錄來源；場次列即使遺失也要能完成核銷，
      // 否則孤兒欠款會變成永遠掛在清單上、誰也結不掉。
      const rows = await getRows("付款追蹤表");

      // 有不可變的訂單ID時，付款人/收款人/金額相符就足以認人；品項與備註
      // 只是描述（團主統一品項寫法會即時同步），拿它們當比對條件只會讓還沒
      // 輪詢到的人白白吃 409。
      const matches = (row: string[] | undefined) =>
        !!row &&
        !isDeletedRow(row) &&
        row[0] === sessionId &&
        (expected.orderId
          ? row[12] === expected.orderId
          : (row[6] || "") === (expected.item || "") &&
            (row[7] || "") === (expected.note || "")) &&
        row[3] === expected.payer &&
        row[4] === expected.receiver &&
        Number(row[5]) === Number(expected.amount) &&
        !isSettledPayment(row);

      // tombstone 讓 rowIndex 不再位移；先採用使用者畫面上的確切列，
      // 舊資料才退回內容搜尋。
      let targetRow = matches(rows[rowIndex - 1]) ? rowIndex : 0;
      if (!targetRow) {
        for (let i = 1; i < rows.length; i++) {
          if (matches(rows[i])) {
            targetRow = i + 1;
            break;
          }
        }
      }
      if (!targetRow) {
        return NextResponse.json(
          { error: "這筆帳款已變動或已核銷，請重新整理後再試" },
          { status: 409 }
        );
      }

      const row = rows[targetRow - 1];
      // 場次重新開放中仍允許確認：確認本身會鎖住來源訂單（訂單 PUT/DELETE
      // 遇到有付款證據的列會回 409），因此不會出現「付了款金額又被改」。
      const nowIso = new Date().toISOString();
      if (action === "payerConfirm") {
        if (row[8] === "TRUE") {
          return NextResponse.json(
            { error: "已標記過付款" },
            { status: 400 }
          );
        }
        await updateCells("付款追蹤表", targetRow, [
          { col: 8, value: "TRUE" },
          { col: 11, value: nowIso },
        ]);
      } else if (action === "payerUndo") {
        // 信任制下按錯很常見，而「已標記付款」會讓來源訂單再也不能修正。
        // 尚未核銷前必須留一條回頭路，否則只能人工改 Google Sheet。
        if (row[8] !== "TRUE") {
          return NextResponse.json(
            { error: "這筆帳款目前沒有轉帳標記" },
            { status: 400 }
          );
        }
        await updateCells("付款追蹤表", targetRow, [
          { col: 8, value: "FALSE" },
          { col: 11, value: "" },
        ]);
      } else {
        // 收款人確認即直接核銷（同時標記付款人已付）
        await updateCells("付款追蹤表", targetRow, [
          { col: 8, value: "TRUE" },
          { col: 9, value: "TRUE" },
          { col: 10, value: nowIso },
          ...(row[11] ? [] : [{ col: 11, value: nowIso }]),
        ]);
      }

      return NextResponse.json({ success: true });
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to update payment:", error);
    return NextResponse.json({ error: "更新付款狀態失敗" }, { status: 500 });
  }
}
