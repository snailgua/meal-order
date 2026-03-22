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
  orderCount: number;
}

export interface Order {
  rowIndex: number;
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
  sessionId: string;
  payer: string;
  receiver: string;
  amount: number;
  item: string;
  note: string;
  payerConfirmed: boolean;
  receiverConfirmed: boolean;
  settledAt: string | null;
  sessionTitle: string;
  sessionDate: string;
  bankName: string;
  bankAccount: string;
  qrCodeUrl: string;
  transferLink: string;
}
