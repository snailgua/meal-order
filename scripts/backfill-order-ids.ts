// 一次性 backfill：幫既有的訂單明細補上 [10]訂單ID，
// 並把付款追蹤列以內容比對對應到訂單、寫入 [12]訂單ID。
// 執行：npx tsx scripts/backfill-order-ids.ts
import { google } from "googleapis";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;

async function getRows(sheetName: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return (res.data.values as string[][]) || [];
}

async function run() {
  const orderRows = await getRows("訂單明細表");
  const paymentRows = await getRows("付款追蹤表");

  // 1. 訂單補 ID（K 欄 = index 10）
  const orderIdUpdates: { range: string; values: string[][] }[] = [];
  let seq = 0;
  for (let i = 1; i < orderRows.length; i++) {
    const r = orderRows[i];
    if (!r[0] || r[10]) continue; // 空列或已有 ID
    const id = `o_${Date.now()}_bf${(seq++).toString(36)}`;
    r[10] = id;
    orderIdUpdates.push({ range: `訂單明細表!K${i + 1}`, values: [[id]] });
  }

  // 2. 付款列以內容對應訂單，補訂單ID（M 欄 = index 12）
  const contentKey = (payer: string, item: string, amount: string, note: string) =>
    `${payer}|${item}|${Number(amount)}|${note || ""}`;
  const consumed = new Set<number>();
  const paymentIdUpdates: { range: string; values: string[][] }[] = [];
  for (let i = 1; i < paymentRows.length; i++) {
    const p = paymentRows[i];
    if (!p[0] || p[12]) continue;
    const key = contentKey(p[3], p[6], p[5], p[7]);
    for (let j = 1; j < orderRows.length; j++) {
      const o = orderRows[j];
      if (consumed.has(j) || o[0] !== p[0]) continue;
      if (contentKey(o[4], o[5], o[6], o[7]) === key) {
        consumed.add(j);
        paymentIdUpdates.push({
          range: `付款追蹤表!M${i + 1}`,
          values: [[o[10]]],
        });
        break;
      }
    }
  }

  const allUpdates = [
    { range: "訂單明細表!K1", values: [["訂單ID"]] },
    { range: "付款追蹤表!M1", values: [["訂單ID"]] },
    ...orderIdUpdates,
    ...paymentIdUpdates,
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "RAW", data: allUpdates },
  });

  console.log(
    `完成：訂單補 ID ${orderIdUpdates.length} 筆、付款列對應 ${paymentIdUpdates.length} 筆` +
      `（付款列共 ${paymentRows.length - 1} 筆，未對應到的維持內容比對）`
  );
}

run().catch((err) => {
  console.error("backfill 失敗:", err.message);
  process.exit(1);
});
