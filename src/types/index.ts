export interface Session {
  id: string;
  date: string;
  title: string;
  organizer: string;
  bankName: string;
  bankAccount: string;
  qrCodeUrl: string;
  transferLink: string;
  menuImages: string[];
  status: "開放中" | "已關閉";
  createdAt: string;
  version: string;
  orderCount: number;
}

export interface Order {
  rowIndex: number;
  /** 不可變訂單ID（舊資料可能為空字串） */
  id: string;
  sessionId: string;
  name: string;
  item: string;
  price: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  rowIndex: number;
  /** 來源訂單ID（舊資料可能為空字串） */
  orderId: string;
  sessionId: string;
  payer: string;
  receiver: string;
  amount: number;
  item: string;
  note: string;
  payerConfirmed: boolean;
  receiverConfirmed: boolean;
  settledAt: string | null;
  payerConfirmedAt: string | null;
  sessionTitle: string;
  sessionDate: string;
  bankName: string;
  bankAccount: string;
  qrCodeUrl: string;
  transferLink: string;
  sessionVersion: string;
  /** 場次重新開放中：金額可能還會變動 */
  sessionOpen: boolean;
}
