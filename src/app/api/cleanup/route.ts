import { NextResponse } from "next/server";
import { getRows, deleteRow } from "@/lib/sheets";

// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間

export async function POST() {
  try {
    const rows = await getRows("付款追蹤表");
    const now = Date.now();
    const THREE_MONTHS = 90 * 24 * 60 * 60 * 1000;

    const rowsToDelete: number[] = [];
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      if (r[8] === "TRUE" && r[9] === "TRUE" && r[10]) {
        const settledAt = new Date(r[10]).getTime();
        if (now - settledAt > THREE_MONTHS) {
          rowsToDelete.push(i + 1);
        }
      }
    }

    for (const rowNum of rowsToDelete) {
      await deleteRow("付款追蹤表", rowNum);
    }

    return NextResponse.json({ deleted: rowsToDelete.length });
  } catch (error) {
    console.error("Failed to cleanup:", error);
    return NextResponse.json({ error: "清理失敗" }, { status: 500 });
  }
}
