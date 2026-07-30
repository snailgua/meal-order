// 壓縮 tombstone 列（把 A 欄為 __DELETED__ 的空列實體刪除）。
//
// 為什麼會有這些列：刪除訂單/場次/付款時不做實體刪列，而是把 A 欄標成
// __DELETED__、其餘清空。實體刪列會讓所有後續列號往上位移，導致另一個
// 同時進行的請求寫到別人的資料。代價是這些空列會慢慢累積。
//
// 安全前提：只刪「位於最後一筆真實資料之後」的 tombstone。這樣即使有人
// 正在使用，任何真實列的列號都不會改變，也就不會有請求寫錯列。
// 夾在真實資料中間的 tombstone 一律跳過，需要處理時請先讓部署進入
// SHEETS_MAINTENANCE_MODE=1 再離線處理。
//
// 用法：
//   npx tsx scripts/compact-tombstones.ts           # dry-run，只報告
//   npx tsx scripts/compact-tombstones.ts --apply   # 實際刪除
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
const MARKER = "__DELETED__";
const SHEET_NAMES = ["訂餐場次表", "訂單明細表", "付款追蹤表"];
const apply = process.argv.includes("--apply");

async function getRows(sheetName: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return (res.data.values as string[][]) || [];
}

function plan(rows: string[][]) {
  let lastRealRow = 1; // header
  const tombstones: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i]?.[0] || "";
    if (a.startsWith(MARKER)) tombstones.push(i + 1);
    else if (a) lastRealRow = i + 1;
  }
  return {
    lastRealRow,
    removable: tombstones.filter((rowNumber) => rowNumber > lastRealRow),
    skipped: tombstones.filter((rowNumber) => rowNumber < lastRealRow),
  };
}

async function run() {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEET_ID 未設定");

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  const sheetIds = new Map<string, number>();
  for (const sheet of meta.data.sheets || []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId != null) sheetIds.set(title, sheetId);
  }

  let totalRemoved = 0;
  for (const name of SHEET_NAMES) {
    const sheetId = sheetIds.get(name);
    if (sheetId == null) throw new Error(`找不到工作表「${name}」`);

    const rows = await getRows(name);
    const { lastRealRow, removable, skipped } = plan(rows);
    console.log(
      `${name}：總 ${rows.length} 列，最後一筆真實資料在第 ${lastRealRow} 列，` +
        `可清除 ${removable.length} 列` +
        (skipped.length > 0 ? `，夾在資料中間而跳過 ${skipped.length} 列` : "")
    );
    if (skipped.length > 0) {
      console.log(`  跳過的列號：${skipped.join(", ")}`);
    }
    if (removable.length === 0) continue;

    if (!apply) {
      console.log(`  （dry-run）會刪除第 ${removable[0]}–${removable.at(-1)} 列`);
      continue;
    }

    // 刪除前重新確認每一列仍是 tombstone，避免 dry-run 到 apply 之間有人寫入
    const fresh = await getRows(name);
    for (const rowNumber of removable) {
      const a = fresh[rowNumber - 1]?.[0] || "";
      if (!a.startsWith(MARKER)) {
        throw new Error(
          `第 ${rowNumber} 列已不是 tombstone（內容「${a}」），本工作表零寫入`
        );
      }
    }

    // 由下往上刪，列號才不會在過程中位移
    const requests = [...removable]
      .sort((a, b) => b - a)
      .map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS" as const,
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
    console.log(`  已刪除 ${removable.length} 列`);
    totalRemoved += removable.length;
  }

  console.log(
    apply
      ? `\n完成，共清除 ${totalRemoved} 列。`
      : "\n這是 dry-run。確認上面的數字後，加上 --apply 才會真的刪除。"
  );
}

run().catch((error) => {
  console.error(
    "壓縮失敗:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
