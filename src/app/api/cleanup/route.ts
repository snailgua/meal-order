import { NextResponse } from "next/server";
import {
  applyAtomicSheetMutations,
  getRows,
  isDeletedRow,
  type AtomicSheetMutation,
} from "@/lib/sheets";
import { sheetWritesPaused } from "@/lib/maintenance";

export const maxDuration = 60;

const PAYMENT_ARCHIVE_MARKER = "__ARCHIVED_PAYMENT__";
const PAYMENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_ARCHIVE_ROWS_PER_RUN = 200;

export async function POST() {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const rows = await getRows("付款追蹤表");
    const now = Date.now();
    const mutations: AtomicSheetMutation[] = [];

    for (let index = 1; index < rows.length; index++) {
      const row = rows[index];
      if (
        isDeletedRow(row) ||
        row[1] === PAYMENT_ARCHIVE_MARKER ||
        row[8] !== "TRUE" ||
        row[9] !== "TRUE" ||
        !row[10] ||
        !row[12]
      ) {
        continue;
      }
      const settledAt = Date.parse(row[10]);
      if (
        !Number.isFinite(settledAt) ||
        now - settledAt <= PAYMENT_RETENTION_MS
      ) {
        continue;
      }

      // 不能直接刪除：order 仍在時，reconcile 會把已付訂單誤判成欠款。
      // 保留 sessionId/orderId/settled flags 作為極小的 durable marker，
      // 其餘付款個資與品項資料依 90 天保留政策清空。
      mutations.push({
        type: "updateCells",
        sheetName: "付款追蹤表",
        rowNumber: index + 1,
        updates: [
          { col: 1, value: PAYMENT_ARCHIVE_MARKER },
          { col: 2, value: "" },
          { col: 3, value: "" },
          { col: 4, value: "" },
          { col: 5, value: "" },
          { col: 6, value: "" },
          { col: 7, value: "" },
          { col: 11, value: "" },
        ],
      });
      if (mutations.length >= MAX_ARCHIVE_ROWS_PER_RUN) break;
    }

    await applyAtomicSheetMutations(mutations);
    return NextResponse.json({ deleted: 0, archived: mutations.length });
  } catch (error) {
    console.error("Failed to cleanup:", error);
    return NextResponse.json({ error: "清理失敗" }, { status: 500 });
  }
}
