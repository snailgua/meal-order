import { NextResponse } from "next/server";
import { getRows, updateRow } from "@/lib/sheets";

// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間

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

        if (payerConfirmed && receiverConfirmed) return null;

        const sessionId = row[0];
        const session = sessionMap[sessionId];

        return {
          rowIndex: index + 2,
          sessionId,
          payer: row[3],
          receiver: row[4],
          amount: Number(row[5]),
          item: row[6] || "",
          note: row[7] || "",
          payerConfirmed,
          receiverConfirmed,
          settledAt,
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
    const { rowIndex, action } = body;

    if (!rowIndex || !action) {
      return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });
    }

    const rows = await getRows("付款追蹤表");
    const row = rows[rowIndex - 1];

    if (!row) {
      return NextResponse.json({ error: "找不到此筆帳款" }, { status: 404 });
    }

    if (action === "payerConfirm") {
      if (row[8] === "TRUE") {
        return NextResponse.json(
          { error: "已標記過付款" },
          { status: 400 }
        );
      }
      row[8] = "TRUE";
      if (row[9] === "TRUE") {
        row[10] = new Date().toISOString();
      }
    } else if (action === "receiverConfirm") {
      if (row[9] === "TRUE") {
        return NextResponse.json(
          { error: "已確認過收款" },
          { status: 400 }
        );
      }
      row[9] = "TRUE";
      if (row[8] === "TRUE") {
        row[10] = new Date().toISOString();
      }
    } else {
      return NextResponse.json({ error: "無效的操作" }, { status: 400 });
    }

    await updateRow("付款追蹤表", rowIndex, row);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update payment:", error);
    return NextResponse.json({ error: "更新付款狀態失敗" }, { status: 500 });
  }
}
