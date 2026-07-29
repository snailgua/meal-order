import { getRows, appendRows, deleteRow, updateCells } from "@/lib/sheets";

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間 [10]訂單ID
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間 [11]付款人標記時間 [12]訂單ID

export function newOrderId(): string {
  return `o_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 以訂單為準，冪等地補齊/修正某場次的付款列。用於關閉場次、更改團主、
// 關閉瞬間才寫入的訂單等所有需要「讓付款列跟訂單一致」的時機：
// - 每筆非團主的訂單應恰有一列付款（優先以訂單ID對應，無 ID 的舊資料用內容比對）
// - 未核銷列：對應訂單已刪除、付款人已變成團主、或是重複列 → 刪除；內容不一致 → 同步
// - 已核銷列一律不動（保留稽核紀錄），但會佔用對應訂單，避免重複建帳
export async function reconcilePayments(sessionId: string, sessionRow: string[]) {
  const [orderRows, paymentRows] = await Promise.all([
    getRows("訂單明細表"),
    getRows("付款追蹤表"),
  ]);
  const organizer = sessionRow[3];
  const orders = orderRows.slice(1).filter((r) => r[0] === sessionId);

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
  const isSettled = (r: string[]) => !!r[10] || r[9] === "TRUE";

  // Pass 1：已核銷列先佔用對應訂單（重開再關不可為已付清的訂單重建欠款）
  for (const { row } of sessionPayments) {
    if (!isSettled(row)) continue;
    const o = row[12]
      ? orderById.get(row[12])
      : takeByContent(paymentContentKey(row));
    if (o && !consumed.has(o)) consumed.add(o);
  }

  // Pass 2：未核銷列逐一檢查
  const toDelete: number[] = [];
  for (const { rowNum, row } of sessionPayments) {
    if (isSettled(row)) continue;
    let order: string[] | undefined;
    if (row[12]) {
      order = orderById.get(row[12]);
      if (order && consumed.has(order)) order = undefined; // 重複列
    } else {
      order = takeByContent(paymentContentKey(row));
    }
    if (!order || order[4] === organizer) {
      toDelete.push(rowNum);
      continue;
    }
    consumed.add(order);
    // 內容同步（單格寫入，避免蓋掉付款確認欄位）
    const updates: { col: number; value: string }[] = [];
    if (row[3] !== order[4]) updates.push({ col: 3, value: order[4] });
    if (row[4] !== organizer) updates.push({ col: 4, value: organizer });
    if (Number(row[5]) !== Number(order[6]))
      updates.push({ col: 5, value: order[6] });
    if ((row[6] || "") !== order[5]) updates.push({ col: 6, value: order[5] });
    if ((row[7] || "") !== (order[7] || ""))
      updates.push({ col: 7, value: order[7] || "" });
    if (!row[12] && order[10]) updates.push({ col: 12, value: order[10] });
    if (updates.length > 0) {
      await updateCells("付款追蹤表", rowNum, updates);
    }
  }

  // Pass 3：補建缺少的付款列
  const newRows: string[][] = [];
  for (const o of orders) {
    if (o[4] === organizer || consumed.has(o)) continue;
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
  await appendRows("付款追蹤表", newRows);

  // Pass 4：刪除多餘列（由下往上，避免列號位移）
  toDelete.sort((a, b) => b - a);
  for (const rowNum of toDelete) {
    await deleteRow("付款追蹤表", rowNum);
  }
}
