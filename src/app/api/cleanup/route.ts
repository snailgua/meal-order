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

    // 同一訂單ID若殘留多列未核銷付款（例如併發下的殘留、或人工複製列），
    // 付款頁會把同一餐算兩次。reconcile 只在該場次再被動到時才會去重，
    // 沒人再碰的舊場次就會一直重複計費，所以這裡也要收斂。
    const unsettledByOrderId = new Map<
      string,
      { rowNumber: number; row: string[] }[]
    >();
    for (let index = 1; index < rows.length; index++) {
      const row = rows[index];
      if (isDeletedRow(row) || !row[12] || row[10] || row[9] === "TRUE") {
        continue;
      }
      const list = unsettledByOrderId.get(row[12]) || [];
      list.push({ rowNumber: index + 1, row });
      unsettledByOrderId.set(row[12], list);
    }
    for (const list of unsettledByOrderId.values()) {
      if (list.length < 2) continue;
      // 留下最有付款進度的那一列（其餘是重複），同進度時留列號最小的
      const progress = (row: string[]) => (row[8] === "TRUE" ? 1 : 0);
      const sorted = [...list].sort(
        (a, b) =>
          progress(b.row) - progress(a.row) || a.rowNumber - b.rowNumber
      );
      for (const extra of sorted.slice(1)) {
        mutations.push({
          type: "tombstoneRow",
          sheetName: "付款追蹤表",
          rowNumber: extra.rowNumber,
        });
      }
    }

    let archived = 0;
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
      archived++;
      if (archived >= MAX_ARCHIVE_ROWS_PER_RUN) break;
    }

    await applyAtomicSheetMutations(mutations);
    return NextResponse.json({
      deleted: mutations.length - archived,
      archived,
    });
  } catch (error) {
    console.error("Failed to cleanup:", error);
    return NextResponse.json({ error: "清理失敗" }, { status: 500 });
  }
}
