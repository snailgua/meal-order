import { NextResponse } from "next/server";
import { getRows, updateCells } from "@/lib/sheets";

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
      };
    }

    const payments = paymentRows
      .slice(1)
      .map((row, index) => {
        const payerConfirmed = row[8] === "TRUE";
        const receiverConfirmed = row[9] === "TRUE";
        const settledAt = row[10] || null;
        const payerConfirmedAt = row[11] || null;

        if (payerConfirmed && receiverConfirmed) return null;

        const sessionId = row[0];
        const session = sessionMap[sessionId];

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
          sessionDate: session?.date || "",
          bankName: session?.bankName || "",
          bankAccount: session?.bankAccount || "",
          qrCodeUrl: session?.qrCodeUrl || "",
          transferLink: session?.transferLink || "",
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
  try {
    const body = await request.json();
    const { rowIndex, action, expected } = body;

    if (!rowIndex || !action) {
      return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });
    }

    const rows = await getRows("付款追蹤表");

    // rowIndex 是客戶端讀取當下的列號，別人刪列（如 cleanup、刪訂單）後會位移。
    // 優先用不可變的訂單ID定位；沒有 ID 的舊資料用 expected 內容驗證/重新定位。
    let targetRow = 0;
    if (expected?.orderId) {
      for (let i = 1; i < rows.length; i++) {
        if (
          rows[i][0] === expected.sessionId &&
          rows[i][12] === expected.orderId &&
          !rows[i][10]
        ) {
          targetRow = i + 1;
          break;
        }
      }
      if (!targetRow) {
        return NextResponse.json(
          { error: "這筆帳款已變動或已核銷，請重新整理後再試" },
          { status: 409 }
        );
      }
    } else if (expected) {
      const matches = (r: string[] | undefined) =>
        !!r &&
        r[0] === expected.sessionId &&
        r[3] === expected.payer &&
        Number(r[5]) === Number(expected.amount) &&
        (r[6] || "") === (expected.item || "") &&
        !r[10]; // 未核銷

      if (matches(rows[rowIndex - 1])) {
        targetRow = rowIndex;
      } else {
        for (let i = 1; i < rows.length; i++) {
          if (matches(rows[i])) {
            targetRow = i + 1;
            break;
          }
        }
        if (!targetRow) {
          return NextResponse.json(
            { error: "這筆帳款已變動或已核銷，請重新整理後再試" },
            { status: 409 }
          );
        }
      }
    } else {
      targetRow = rowIndex;
    }

    const row = rows[targetRow - 1];

    if (!row) {
      return NextResponse.json({ error: "找不到此筆帳款" }, { status: 404 });
    }

    // 只寫入各動作自己的欄位：付款人與收款人同時按時，
    // 整列覆寫會用舊 snapshot 蓋掉對方剛寫入的確認狀態
    const nowIso = new Date().toISOString();
    if (action === "payerConfirm") {
      if (row[8] === "TRUE") {
        return NextResponse.json(
          { error: "已標記過付款" },
          { status: 400 }
        );
      }
      const updates = [
        { col: 8, value: "TRUE" },
        { col: 11, value: nowIso },
      ];
      if (row[9] === "TRUE") {
        updates.push({ col: 10, value: nowIso });
      }
      await updateCells("付款追蹤表", targetRow, updates);
    } else if (action === "receiverConfirm") {
      if (row[9] === "TRUE") {
        return NextResponse.json(
          { error: "已確認過收款" },
          { status: 400 }
        );
      }
      // 收款人確認即直接核銷（同時標記付款人已付）
      await updateCells("付款追蹤表", targetRow, [
        { col: 8, value: "TRUE" },
        { col: 9, value: "TRUE" },
        { col: 10, value: nowIso },
      ]);
    } else {
      return NextResponse.json({ error: "無效的操作" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update payment:", error);
    return NextResponse.json({ error: "更新付款狀態失敗" }, { status: 500 });
  }
}
