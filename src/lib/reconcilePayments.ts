import {
  applyAtomicSheetMutations,
  getRows,
  type AtomicSheetMutation,
} from "@/lib/sheets";
import {
  buildPaymentSyncUpdates,
  hasMaterialPaymentChange,
  hasPaymentConfirmation,
  isSettledPayment,
} from "@/lib/paymentRules";

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間 [10]訂單ID
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間 [11]付款人標記時間 [12]訂單ID

export function newOrderId(requestId?: string): string {
  return `o_${requestId || crypto.randomUUID()}`;
}

const PAYMENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function isBeyondPaymentRetention(
  sessionRow: string[],
  now = Date.now()
): boolean {
  const sessionDate = sessionRow[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate || "")) return false;
  const startedAt = Date.parse(`${sessionDate}T00:00:00+08:00`);
  return Number.isFinite(startedAt) && now - startedAt > PAYMENT_RETENTION_MS;
}

export interface ReconcilePaymentOptions {
  createMissing?: boolean;
  allowArchivedCreate?: boolean;
  now?: number;
}

// 以訂單為準，冪等地補齊/修正某場次的付款列。用於關閉場次、更改團主、
// 關閉瞬間才寫入的訂單等所有需要「讓付款列跟訂單一致」的時機：
// - 每筆非團主的訂單應恰有一列付款（優先以訂單ID對應，無 ID 的舊資料用內容比對）
// - 未核銷列：對應訂單已刪除、付款人已變成團主、或是重複列 → 刪除；內容不一致 → 同步
// - 已核銷列一律不動（保留稽核紀錄），但會佔用對應訂單，避免重複建帳
export async function reconcilePayments(
  sessionId: string,
  sessionRow: string[],
  options: ReconcilePaymentOptions = {}
) {
  const [orderRows, paymentRows] = await Promise.all([
    getRows("訂單明細表"),
    getRows("付款追蹤表"),
  ]);
  const mutations = planReconcilePayments(
    sessionId,
    sessionRow,
    orderRows,
    paymentRows,
    options
  );
  await applyAtomicSheetMutations(mutations);
}

export function planReconcilePayments(
  sessionId: string,
  sessionRow: string[],
  orderRows: string[][],
  paymentRows: string[][],
  options: ReconcilePaymentOptions = {}
): AtomicSheetMutation[] {
  const beyondRetention = isBeyondPaymentRetention(
    sessionRow,
    options.now ?? Date.now()
  );
  const createMissing =
    (options.createMissing ?? true) &&
    (options.allowArchivedCreate === true || !beyondRetention);
  const organizer = sessionRow[3];
  const orders = orderRows.slice(1).filter((r) => r[0] === sessionId);
  const mutations: AtomicSheetMutation[] = [];

  const contentKey = (payer: string, item: string, amount: string, note: string) =>
    `${payer}|${item}|${Number(amount)}|${note || ""}`;
  const orderContentKey = (o: string[]) => contentKey(o[4], o[5], o[6], o[7]);
  const paymentContentKey = (r: string[]) => contentKey(r[3], r[6], r[5], r[7]);

  const orderById = new Map<string, string[]>();
  for (const o of orders) {
    if (o[10]) orderById.set(o[10], o);
  }

  const consumed = new Set<string[]>(); // 已被某付款列佔用的訂單（object identity）
  const takeByContent = (key: string): string[] | undefined => {
    for (const o of orders) {
      if (!consumed.has(o) && orderContentKey(o) === key) return o;
    }
    return undefined;
  };

  const sessionPayments: { rowNum: number; row: string[] }[] = [];
  for (let i = 1; i < paymentRows.length; i++) {
    if (paymentRows[i][0] === sessionId) {
      sessionPayments.push({ rowNum: i + 1, row: paymentRows[i] });
    }
  }
  // Pass 1：已核銷列先佔用對應訂單（重開再關不可為已付清的訂單重建欠款）
  for (const { row } of sessionPayments) {
    if (!isSettledPayment(row)) continue;
    const o = row[12]
      ? orderById.get(row[12])
      : takeByContent(paymentContentKey(row));
    if (o && !consumed.has(o)) consumed.add(o);
  }

  // Pass 2：未核銷列逐一檢查
  const toDelete: number[] = [];
  // 有付款證據卻對不到訂單而被保留的列。這些幾乎都是「同一筆帳，只是內容
  // 或 ID 對不上了」，若 Pass 3 又為對應訂單補一列，付款人會被要求付兩次。
  const keptOrphanClaims = new Map<string, number>();
  const orphanKey = (payer: string, amount: unknown) =>
    `${payer}|${Number(amount)}`;
  const unsettledPayments = sessionPayments
    .filter(({ row }) => !isSettledPayment(row))
    .sort(
      (a, b) =>
        (b.row[8] === "TRUE" ? 1 : 0) - (a.row[8] === "TRUE" ? 1 : 0) ||
        a.rowNum - b.rowNum
    );
  for (const { rowNum, row } of unsettledPayments) {
    let order: string[] | undefined;
    if (row[12]) {
      order = orderById.get(row[12]);
      if (order && consumed.has(order)) order = undefined; // 重複列
    } else {
      order = takeByContent(paymentContentKey(row));
    }
    if (!order || order[4] === organizer) {
      if (hasPaymentConfirmation(row)) {
        console.error(
          `reconcile 保留有付款進度但找不到有效訂單的列：session=${sessionId}, row=${rowNum}`
        );
        const key = orphanKey(row[3], row[5]);
        keptOrphanClaims.set(key, (keptOrphanClaims.get(key) || 0) + 1);
        continue;
      }
      toDelete.push(rowNum);
      continue;
    }
    consumed.add(order);
    const orderSnapshot = {
      name: order[4],
      item: order[5],
      price: Number(order[6]),
      note: order[7] || "",
      orderId: order[10] || undefined,
    };
    if (
      hasPaymentConfirmation(row) &&
      hasMaterialPaymentChange(row, orderSnapshot, organizer)
    ) {
      console.error(
        `reconcile 保留與訂單金流欄位衝突的付款證據：session=${sessionId}, row=${rowNum}`
      );
      continue;
    }
    // 內容同步（單格寫入，避免蓋掉付款確認欄位）
    const updates = buildPaymentSyncUpdates(
      row,
      orderSnapshot,
      organizer
    );
    if (updates.length > 0) {
      mutations.push({
        type: "updateCells",
        sheetName: "付款追蹤表",
        rowNumber: rowNum,
        updates,
      });
    }
  }

  // Pass 3：補建缺少的付款列
  const newRows: string[][] = [];
  if (createMissing) {
    for (const o of orders) {
      if (o[4] === organizer || consumed.has(o)) continue;
      // 同一人同金額已經有一列「付了款但對不到訂單」被保留下來，這筆訂單
      // 幾乎確定就是它。寧可少建一列讓團主自己核對，也不要重複跟人收錢。
      const claimKey = orphanKey(o[4], o[6]);
      const claims = keptOrphanClaims.get(claimKey) || 0;
      if (claims > 0) {
        keptOrphanClaims.set(claimKey, claims - 1);
        console.error(
          `reconcile 略過補建，已有對不到訂單的付款紀錄可能就是這筆：` +
            `session=${sessionId}, payer=${o[4]}, amount=${o[6]}`
        );
        continue;
      }
      newRows.push([
        sessionId,
        sessionRow[1], // 日期
        sessionRow[2], // 標題
        o[4], // 付款人姓名
        organizer, // 收款人姓名
        o[6], // 金額
        o[5], // 品項名稱
        o[7] || "", // 備註
        "FALSE",
        "FALSE",
        "",
        "",
        o[10] || "", // 訂單ID
      ]);
    }
  }
  if (newRows.length > 0) {
    mutations.push({
      type: "appendRows",
      sheetName: "付款追蹤表",
      rows: newRows,
    });
  }

  // Pass 4：tombstone 多餘列；不做 deleteDimension，因此不會造成列位移。
  toDelete.sort((a, b) => b - a);
  for (const rowNum of toDelete) {
    mutations.push({
      type: "tombstoneRow",
      sheetName: "付款追蹤表",
      rowNumber: rowNum,
    });
  }
  return mutations;
}
