import { google, type sheets_v4 } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

export const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;
export const DELETED_ROW_MARKER = "__DELETED__";

export interface AtomicCellUpdate {
  col: number;
  value: string;
}

export type AtomicSheetMutation =
  | {
      type: "updateCells";
      sheetName: string;
      rowNumber: number;
      updates: AtomicCellUpdate[];
    }
  | {
      type: "tombstoneRow";
      sheetName: string;
      rowNumber: number;
      key?: string;
    }
  | {
      type: "appendRows";
      sheetName: string;
      rows: string[][];
    };

export function isDeletedRow(row: string[] | undefined): boolean {
  return !row || !row[0] || row[0].startsWith(DELETED_ROW_MARKER);
}

export function tombstoneMarker(key?: string): string {
  return key ? `${DELETED_ROW_MARKER}:${key}` : DELETED_ROW_MARKER;
}

export function isTombstoneFor(
  row: string[] | undefined,
  key: string
): boolean {
  return row?.[0] === tombstoneMarker(key);
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

// Sheets API 的免費額度是每分鐘 300 次讀取；50-60 人同時開著輪詢頁面很容易
// 撞到 429，而每個 429 在畫面上就是一次「更新失敗」或操作失敗的警示。
// 這類錯誤幾乎都在幾百毫秒後就會恢復，值得在這層退避重試。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_SHEETS_RETRIES = 4;

function sheetsStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const candidate = error as {
    code?: number | string;
    status?: number | string;
    response?: { status?: number };
  };
  const value = candidate.response?.status ?? candidate.code ?? candidate.status;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= MAX_SHEETS_RETRIES ||
        !RETRYABLE_STATUS.has(sheetsStatus(error))
      ) {
        throw error;
      }
      const backoff = 250 * 2 ** attempt + Math.floor(Math.random() * 200);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

export async function getRows(sheetName: string): Promise<string[][]> {
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
    })
  );
  return (res.data.values as string[][]) || [];
}

export async function appendRow(sheetName: string, values: string[]) {
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    })
  );
}

export async function appendRows(sheetName: string, rows: string[][]) {
  if (rows.length === 0) return;
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    })
  );
}

export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: string[]
) {
  const endCol = columnName(values.length - 1);
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A${rowNumber}:${endCol}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    })
  );
}

// 只寫入指定的儲存格（col 為 0-based 欄位索引）。
// 兩人同時操作同一列時，整列覆寫會互相蓋掉對方的欄位，單格寫入不會。
export async function updateCells(
  sheetName: string,
  rowNumber: number,
  updates: { col: number; value: string }[]
) {
  if (updates.length === 0) return;
  await withRetry(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.map((u) => ({
          range: `${sheetName}!${columnName(u.col)}${rowNumber}`,
          values: [[u.value]],
        })),
      },
    })
  );
}

// 不做 deleteDimension：實體刪列會讓所有後續 row number 位移，導致另一個
// 同時進行的請求寫到別人的資料。改以 tombstone 清空內容並保留 A 欄標記；
// key 版本還能攔截已刪資源的延遲重送。需要壓縮 Sheet 時只能在停止所有
// 寫入後離線處理。
export async function deleteRow(
  sheetName: string,
  rowNumber: number,
  key?: string
) {
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A${rowNumber}:Z${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[tombstoneMarker(key), ...Array(25).fill("")]],
      },
    })
  );
}

function asCellData(value: string): sheets_v4.Schema$CellData {
  return {
    userEnteredValue: {
      stringValue: value,
    },
  };
}

function contiguousUpdateRuns(
  updates: AtomicCellUpdate[]
): AtomicCellUpdate[][] {
  const byColumn = new Map<number, string>();
  for (const update of updates) {
    if (!Number.isInteger(update.col) || update.col < 0) {
      throw new Error(`無效的欄位索引：${update.col}`);
    }
    byColumn.set(update.col, update.value);
  }

  const sorted = [...byColumn].map(([col, value]) => ({ col, value }));
  sorted.sort((a, b) => a.col - b.col);
  const runs: AtomicCellUpdate[][] = [];
  for (const update of sorted) {
    const current = runs.at(-1);
    if (!current || current.at(-1)!.col + 1 !== update.col) {
      runs.push([update]);
    } else {
      current.push(update);
    }
  }
  return runs;
}

// All mutations in one spreadsheets.batchUpdate request are applied atomically.
// Callers still need their resource lock while planning from a read snapshot.
export async function applyAtomicSheetMutations(
  mutations: AtomicSheetMutation[]
) {
  const effective = mutations.filter((mutation) => {
    if (mutation.type === "updateCells") return mutation.updates.length > 0;
    if (mutation.type === "appendRows") return mutation.rows.length > 0;
    return true;
  });
  if (effective.length === 0) return;

  const metadata = await withRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties(sheetId,title)",
    })
  );
  const sheetIds = new Map<string, number>();
  for (const sheet of metadata.data.sheets || []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId !== undefined && sheetId !== null) {
      sheetIds.set(title, sheetId);
    }
  }

  const requests: sheets_v4.Schema$Request[] = [];
  for (const mutation of effective) {
    const sheetId = sheetIds.get(mutation.sheetName);
    if (sheetId === undefined) {
      throw new Error(`Sheet "${mutation.sheetName}" not found`);
    }

    if (mutation.type === "updateCells") {
      if (!Number.isInteger(mutation.rowNumber) || mutation.rowNumber < 1) {
        throw new Error(`無效的列號：${mutation.rowNumber}`);
      }
      for (const run of contiguousUpdateRuns(mutation.updates)) {
        const startColumnIndex = run[0].col;
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: mutation.rowNumber - 1,
              endRowIndex: mutation.rowNumber,
              startColumnIndex,
              endColumnIndex: run.at(-1)!.col + 1,
            },
            rows: [
              {
                values: run.map((update) => asCellData(update.value)),
              },
            ],
            fields: "userEnteredValue",
          },
        });
      }
    } else if (mutation.type === "tombstoneRow") {
      if (!Number.isInteger(mutation.rowNumber) || mutation.rowNumber < 2) {
        throw new Error(`無效的 tombstone 列號：${mutation.rowNumber}`);
      }
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: mutation.rowNumber - 1,
            endRowIndex: mutation.rowNumber,
            startColumnIndex: 0,
            endColumnIndex: 26,
          },
          rows: [
            {
              values: [
                asCellData(tombstoneMarker(mutation.key)),
                ...Array.from({ length: 25 }, () => asCellData("")),
              ],
            },
          ],
          fields: "userEnteredValue",
        },
      });
    } else {
      requests.push({
        appendCells: {
          sheetId,
          rows: mutation.rows.map((row) => ({
            values: row.map(asCellData),
          })),
          fields: "userEnteredValue",
        },
      });
    }
  }

  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    })
  );
}

export default sheets;
