import { NextResponse } from "next/server";
import { getRows, deleteRow } from "@/lib/sheets";

// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間
// [11]付款人標記時間 [12]訂單ID

export async function POST() {
  try {
    const rows = await getRows("付款追蹤表");
    const now = Date.now();
    const THREE_MONTHS = 90 * 24 * 60 * 60 * 1000;

    // 同一訂單ID若有多列未核銷付款（極端併發下的殘留），保留最有進度的一列
    const byOrderId = new Map<string, { rowNum: number; row: string[] }[]>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[12] || r[10]) continue;
      const list = byOrderId.get(r[12]) || [];
      list.push({ rowNum: i + 1, row: r });
      byOrderId.set(r[12], list);
    }
    const duplicateRows: number[] = [];
    for (const list of byOrderId.values()) {
      if (list.length < 2) continue;
      const progress = (r: string[]) =>
        (r[8] === "TRUE" ? 1 : 0) + (r[9] === "TRUE" ? 1 : 0);
      list.sort(
        (a, b) => progress(b.row) - progress(a.row) || a.rowNum - b.rowNum
      );
      for (const extra of list.slice(1)) duplicateRows.push(extra.rowNum);
    }

    const rowsToDelete: number[] = [...duplicateRows];
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      if (r[8] === "TRUE" && r[9] === "TRUE" && r[10]) {
        const settledAt = new Date(r[10]).getTime();
        if (now - settledAt > THREE_MONTHS) {
          rowsToDelete.push(i + 1);
        }
      }
    }

    // 由下往上刪，避免列號位移
    rowsToDelete.sort((a, b) => b - a);
    for (const rowNum of rowsToDelete) {
      await deleteRow("付款追蹤表", rowNum);
    }

    return NextResponse.json({ deleted: rowsToDelete.length });
  } catch (error) {
    console.error("Failed to cleanup:", error);
    return NextResponse.json({ error: "清理失敗" }, { status: 500 });
  }
}
