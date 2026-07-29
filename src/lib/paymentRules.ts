export interface PaymentCellUpdate {
  col: number;
  value: string;
}

export interface PaymentOrderSnapshot {
  name: string;
  item: string;
  price: number;
  note: string;
  orderId?: string;
}

export function isSettledPayment(row: string[]): boolean {
  return Boolean(row[10]) || row[9] === "TRUE";
}

export function hasPaymentConfirmation(row: string[]): boolean {
  return (
    row[8] === "TRUE" ||
    row[9] === "TRUE" ||
    Boolean(row[10]) ||
    Boolean(row[11])
  );
}

export function hasMaterialPaymentChange(
  row: string[],
  order: PaymentOrderSnapshot,
  organizer: string
): boolean {
  return (
    row[3] !== order.name ||
    row[4] !== organizer ||
    Number(row[5]) !== order.price
  );
}

// 呼叫端必須先攔截「已有付款確認 + 金流欄位變動」；真實付款證據
// 不可由 reconcile 自動清除。這裡只負責產生欄位同步內容。
export function buildPaymentSyncUpdates(
  row: string[],
  order: PaymentOrderSnapshot,
  organizer: string
): PaymentCellUpdate[] {
  const payerChanged = row[3] !== order.name;
  const receiverChanged = row[4] !== organizer;
  const amountChanged = Number(row[5]) !== order.price;

  const updates: PaymentCellUpdate[] = [];
  if (payerChanged) updates.push({ col: 3, value: order.name });
  if (receiverChanged) updates.push({ col: 4, value: organizer });
  if (amountChanged) updates.push({ col: 5, value: String(order.price) });
  if ((row[6] || "") !== order.item)
    updates.push({ col: 6, value: order.item });
  if ((row[7] || "") !== order.note)
    updates.push({ col: 7, value: order.note });
  if (!row[12] && order.orderId)
    updates.push({ col: 12, value: order.orderId });

  return updates;
}
