// 安全的訂單 ID backfill。預設只做 dry-run：
//   npx tsx scripts/backfill-order-ids.ts
//
// 寫入前必須先把部署設為 SHEETS_MAINTENANCE_MODE=1（或停止服務並確認
// 沒有寫入），完成 Sheet 備份，再明確執行：
//   BACKFILL_MAINTENANCE=1 \
//   BACKFILL_EXPECTED_SHEET_ID=<sheet-id> \
//   npx tsx scripts/backfill-order-ids.ts --apply
import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import * as dotenv from "dotenv";
import * as path from "path";
import { compareHeader, SHEET_SCHEMAS } from "../src/lib/sheetSchema";

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
const DELETED_ROW_MARKER = "__DELETED__";
const ARCHIVED_PAYMENT_MARKER = "__ARCHIVED_PAYMENT__";

type CellUpdate = { range: string; values: string[][] };

async function getRows(sheetName: string): Promise<string[][]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return (response.data.values as string[][]) || [];
}

function schema(title: string): readonly string[] {
  const found = SHEET_SCHEMAS.find((item) => item.title === title);
  if (!found) throw new Error(`找不到 schema：${title}`);
  return found.headers;
}

function assertHeader(
  title: string,
  actual: string[],
  allowed: readonly (readonly string[])[]
): number {
  const index = allowed.findIndex((expected) => compareHeader(actual, expected).ok);
  if (index !== -1) return index;
  throw new Error(
    `「${title}」header 不相容。此工具只接受目前 schema，` +
      `不會猜測或搬移舊 7 欄資料。實際=${JSON.stringify(actual)}`
  );
}

function canonicalAmount(value: string, label: string): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} 金額不是正數：${JSON.stringify(value)}`);
  }
  return String(number);
}

function contentKey(
  sessionId: string,
  payer: string,
  item: string,
  amount: string,
  note: string
): string {
  return JSON.stringify([
    sessionId,
    payer,
    item,
    canonicalAmount(amount, `${sessionId}/${payer}`),
    note || "",
  ]);
}

function nextUniqueOrderId(ids: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = `o_${randomUUID()}`;
    if (!ids.has(id)) {
      ids.add(id);
      return id;
    }
  }
  throw new Error("連續產生重複訂單 ID，已中止");
}

async function run() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEET_ID 未設定");

  const [sessionRows, orderRows, paymentRows] = await Promise.all([
    getRows("訂餐場次表"),
    getRows("訂單明細表"),
    getRows("付款追蹤表"),
  ]);
  const initialSnapshot = JSON.stringify({ sessionRows, orderRows, paymentRows });

  const currentSessionHeaders = schema("訂餐場次表");
  const shortSessionHeaderAlias = currentSessionHeaders.map(
    (header, index) =>
      ({
        4: "銀行名稱",
        5: "銀行帳號",
        6: "QR Code連結",
      })[index] || header
  );
  assertHeader("訂餐場次表", sessionRows[0] || [], [
    currentSessionHeaders,
    shortSessionHeaderAlias,
    currentSessionHeaders.slice(0, -1),
    shortSessionHeaderAlias.slice(0, -1),
  ]);
  const orderHeaders = schema("訂單明細表");
  const paymentHeaders = schema("付款追蹤表");
  const orderHeaderVariant = assertHeader(
    "訂單明細表",
    orderRows[0] || [],
    [orderHeaders, orderHeaders.slice(0, -1)]
  );
  const paymentHeaderVariant = assertHeader(
    "付款追蹤表",
    paymentRows[0] || [],
    [paymentHeaders, paymentHeaders.slice(0, -1)]
  );

  const sessions = new Map(
    sessionRows
      .slice(1)
      .filter(
        (row) => row[0] && !row[0].startsWith(DELETED_ROW_MARKER)
      )
      .map((row) => [row[0], row])
  );
  const orders: { rowIndex: number; row: string[] }[] = [];
  const orderById = new Map<string, { rowIndex: number; row: string[] }>();
  const allOrderIds = new Set<string>();
  const orderIdUpdates: CellUpdate[] = [];

  for (let index = 1; index < orderRows.length; index++) {
    const row = orderRows[index];
    if (!row[0] || row[0].startsWith(DELETED_ROW_MARKER)) continue;
    if (!sessions.has(row[0]) || !row[4] || !row[5]) {
      throw new Error(`訂單第 ${index + 1} 列缺少場次、姓名或品項`);
    }
    canonicalAmount(row[6], `訂單第 ${index + 1} 列`);

    if (row[10]) {
      if (allOrderIds.has(row[10])) {
        throw new Error(`重複訂單 ID ${row[10]}（第 ${index + 1} 列）`);
      }
      allOrderIds.add(row[10]);
    }
    orders.push({ rowIndex: index, row });
  }

  for (const order of orders) {
    if (!order.row[10]) {
      const id = nextUniqueOrderId(allOrderIds);
      order.row[10] = id;
      orderIdUpdates.push({
        range: `訂單明細表!K${order.rowIndex + 1}`,
        values: [[id]],
      });
    }
    orderById.set(order.row[10], order);
  }

  const consumed = new Set<number>();
  const existingPaymentIds = new Set<string>();
  const blankPayments: { rowIndex: number; row: string[]; key: string }[] = [];

  // 已有 payment ID 必須先 consume，這是 partial rerun 不配錯相同內容訂單的關鍵。
  for (let index = 1; index < paymentRows.length; index++) {
    const row = paymentRows[index];
    if (!row[0] || row[0].startsWith(DELETED_ROW_MARKER)) continue;
    if (!sessions.has(row[0])) {
      throw new Error(`付款第 ${index + 1} 列指向不存在的場次`);
    }
    if (row[12]) {
      const order = orderById.get(row[12]);
      if (!order) {
        throw new Error(
          `付款第 ${index + 1} 列指向不存在的訂單 ID ${row[12]}`
        );
      }
      if (order.row[0] !== row[0]) {
        throw new Error(
          `付款第 ${index + 1} 列的訂單 ID ${row[12]} 屬於其他場次`
        );
      }
      if (existingPaymentIds.has(row[12])) {
        throw new Error(
          `多筆付款指向同一訂單 ID ${row[12]}，狀態可能不同，請人工處理`
        );
      }
      if (
        row[1] === ARCHIVED_PAYMENT_MARKER &&
        (row[8] !== "TRUE" || row[9] !== "TRUE" || !row[10])
      ) {
        throw new Error(`付款第 ${index + 1} 列的封存標記不完整`);
      }
      existingPaymentIds.add(row[12]);
      consumed.add(order.rowIndex);
      continue;
    }
    if (!row[3]) {
      throw new Error(`付款第 ${index + 1} 列缺少付款人與訂單 ID`);
    }
    const key = contentKey(row[0], row[3], row[6], row[5], row[7]);
    blankPayments.push({ rowIndex: index, row, key });
  }

  const blankByKey = new Map<
    string,
    { rowIndex: number; row: string[]; key: string }[]
  >();
  for (const payment of blankPayments) {
    const list = blankByKey.get(payment.key) || [];
    list.push(payment);
    blankByKey.set(payment.key, list);
  }

  const paymentIdUpdates: CellUpdate[] = [];
  const unmatchedPayments: number[] = [];
  const ambiguous: string[] = [];
  for (const [key, payments] of blankByKey) {
    const candidates = orders.filter(
      (order) =>
        !consumed.has(order.rowIndex) &&
        contentKey(
          order.row[0],
          order.row[4],
          order.row[5],
          order.row[6],
          order.row[7]
        ) === key
    );

    if (payments.length === 1 && candidates.length === 1) {
      const payment = payments[0];
      const order = candidates[0];
      consumed.add(order.rowIndex);
      paymentIdUpdates.push({
        range: `付款追蹤表!M${payment.rowIndex + 1}`,
        values: [[order.row[10]]],
      });
    } else if (candidates.length === 0) {
      unmatchedPayments.push(...payments.map((payment) => payment.rowIndex + 1));
    } else {
      ambiguous.push(
        `key=${key}：付款列 ${payments
          .map((payment) => payment.rowIndex + 1)
          .join(",")}，候選訂單列 ${candidates
          .map((order) => order.rowIndex + 1)
          .join(",")}`
      );
    }
  }
  if (ambiguous.length > 0) {
    throw new Error(
      `有無法唯一判定的付款關係，本次零寫入：\n${ambiguous.join("\n")}`
    );
  }

  const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const missingRecentClosedOrders = orders
    .filter((order) => {
      const session = sessions.get(order.row[0]);
      return (
        session?.[8] === "已關閉" &&
        session[1] > retentionCutoff &&
        order.row[4] !== session[3] &&
        !consumed.has(order.rowIndex)
      );
    })
    .map((order) => order.rowIndex + 1);

  const headerUpdates: CellUpdate[] = [];
  if (orderHeaderVariant === 1) {
    headerUpdates.push({ range: "訂單明細表!K1", values: [["訂單ID"]] });
  }
  if (paymentHeaderVariant === 1) {
    headerUpdates.push({ range: "付款追蹤表!M1", values: [["訂單ID"]] });
  }
  const updates = [...headerUpdates, ...orderIdUpdates, ...paymentIdUpdates];
  if (updates.length > 5_000) {
    throw new Error(`預計更新 ${updates.length} 格，超過單次安全上限 5000`);
  }

  console.log(
    `預演完成：訂單補 ID ${orderIdUpdates.length} 筆、付款對應 ${paymentIdUpdates.length} 筆`
  );
  const unsettledUnmatched = unmatchedPayments.filter((rowNumber) => {
    const row = paymentRows[rowNumber - 1];
    return row[8] !== "TRUE" || row[9] !== "TRUE" || !row[10];
  });
  const settledUnmatchedCount =
    unmatchedPayments.length - unsettledUnmatched.length;
  if (unsettledUnmatched.length > 0) {
    console.warn(
      `未配對且尚未核銷的付款列（保留不動，需人工處理）：${unsettledUnmatched.join(", ")}`
    );
  }
  if (settledUnmatchedCount > 0) {
    console.warn(
      `另有 ${settledUnmatchedCount} 筆未配 ID 的已核銷歷史列，保留付款證據不動`
    );
  }
  if (missingRecentClosedOrders.length > 0) {
    console.warn(
      `保留期內已關閉但缺付款的訂單列（只報告、不自動收款）：${missingRecentClosedOrders.join(", ")}`
    );
  }

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("dry-run：未寫入。確認備份與停寫後才可加 --apply。");
    return;
  }
  if (
    process.env.BACKFILL_MAINTENANCE !== "1" ||
    process.env.BACKFILL_EXPECTED_SHEET_ID !== SPREADSHEET_ID
  ) {
    throw new Error(
      "--apply 需要 BACKFILL_MAINTENANCE=1，且 " +
        "BACKFILL_EXPECTED_SHEET_ID 必須精確等於 GOOGLE_SHEET_ID"
    );
  }

  const [latestSessions, latestOrders, latestPayments] = await Promise.all([
    getRows("訂餐場次表"),
    getRows("訂單明細表"),
    getRows("付款追蹤表"),
  ]);
  if (
    JSON.stringify({
      sessionRows: latestSessions,
      orderRows: latestOrders,
      paymentRows: latestPayments,
    }) !== initialSnapshot
  ) {
    throw new Error("preflight 後資料已變動，本次零寫入；請重新 dry-run");
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
    const verification = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: updates.map((update) => update.range),
    });
    const actual = verification.data.valueRanges || [];
    for (let index = 0; index < updates.length; index++) {
      if (
        JSON.stringify(actual[index]?.values || []) !==
        JSON.stringify(updates[index].values)
      ) {
        throw new Error(`寫入後驗證失敗：${updates[index].range}`);
      }
    }
  }

  console.log(`完成並驗證 ${updates.length} 個儲存格；未配對資料仍保留。`);
}

run().catch((error) => {
  console.error("backfill 失敗:", error instanceof Error ? error.message : error);
  process.exit(1);
});
