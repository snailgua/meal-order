import { NextResponse } from "next/server";
import { getRows, updateRow, appendRows, deleteRow } from "@/lib/sheets";

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await getRows("訂餐場次表");
    const row = rows.slice(1).find((r) => r[0] === id);

    if (!row) {
      return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
    }

    return NextResponse.json({
      id: row[0],
      date: row[1],
      title: row[2],
      organizer: row[3],
      bankName: row[4],
      bankAccount: row[5],
      qrCodeUrl: row[6] || "",
      transferLink: row[7] || "",
      menuImages: row[10] ? row[10].split(",") : [],
      status: row[8],
      createdAt: row[9],
    });
  } catch (error) {
    console.error("Failed to fetch session:", error);
    return NextResponse.json({ error: "無法載入場次資訊" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const rows = await getRows("訂餐場次表");
    const dataIndex = rows.findIndex((r, i) => i > 0 && r[0] === id);

    if (dataIndex === -1) {
      return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
    }

    const row = rows[dataIndex];

    // Update info fields (title, organizer, bank)
    if (body.title || body.organizer || body.bankName !== undefined || body.bankAccount !== undefined) {
      if (body.title) row[2] = body.title;
      if (body.organizer) row[3] = body.organizer;
      if (body.bankName !== undefined) row[4] = body.bankName;
      if (body.bankAccount !== undefined) row[5] = body.bankAccount;
      await updateRow("訂餐場次表", dataIndex + 1, row);
      return NextResponse.json({ success: true });
    }

    if (body.status === "已關閉") {
      if (row[8] === "已關閉") {
        return NextResponse.json({ error: "此場次已關閉" }, { status: 400 });
      }

      row[8] = "已關閉";
      await updateRow("訂餐場次表", dataIndex + 1, row);

      // Create payment records for each order (skip self-payments)
      const orderRows = await getRows("訂單明細表");
      const orders = orderRows.slice(1).filter((r) => r[0] === id);
      const organizer = row[3];

      const paymentRows = orders
        .filter((o) => o[4] !== organizer) // [4]=姓名
        .map((o) => [
          id,
          row[1], // 日期
          row[2], // 標題
          o[4], // 付款人姓名
          organizer, // 收款人姓名
          o[6], // 金額
          o[5], // 品項名稱
          o[7] || "", // 備註
          "FALSE",
          "FALSE",
          "",
        ]);

      await appendRows("付款追蹤表", paymentRows);
    } else if (body.status === "開放中") {
      if (row[8] === "開放中") {
        return NextResponse.json(
          { error: "此場次已是開放中" },
          { status: 400 }
        );
      }

      row[8] = "開放中";
      await updateRow("訂餐場次表", dataIndex + 1, row);

      // Remove unsettled payment records for this session
      const paymentRows = await getRows("付款追蹤表");
      const rowsToDelete: number[] = [];
      for (let i = paymentRows.length - 1; i >= 1; i--) {
        const r = paymentRows[i];
        if (r[0] === id && r[8] !== "TRUE" && r[9] !== "TRUE") {
          rowsToDelete.push(i + 1);
        }
      }
      for (const rowNum of rowsToDelete) {
        await deleteRow("付款追蹤表", rowNum);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update session:", error);
    return NextResponse.json({ error: "更新場次失敗" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete payment records (bottom to top)
    const paymentRows = await getRows("付款追蹤表");
    for (let i = paymentRows.length - 1; i >= 1; i--) {
      if (paymentRows[i][0] === id) {
        await deleteRow("付款追蹤表", i + 1);
      }
    }

    // Delete order records (bottom to top)
    const orderRows = await getRows("訂單明細表");
    for (let i = orderRows.length - 1; i >= 1; i--) {
      if (orderRows[i][0] === id) {
        await deleteRow("訂單明細表", i + 1);
      }
    }

    // Delete the session itself
    const sessionRows = await getRows("訂餐場次表");
    for (let i = sessionRows.length - 1; i >= 1; i--) {
      if (sessionRows[i][0] === id) {
        await deleteRow("訂餐場次表", i + 1);
        break;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete session:", error);
    return NextResponse.json({ error: "刪除場次失敗" }, { status: 500 });
  }
}
