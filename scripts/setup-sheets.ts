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

// 欄位順序必須與 CLAUDE.md「Google Sheets 欄位對照」及各 API route 的 row[N] 索引一致
const WORKSHEETS = [
  {
    title: "訂餐場次表",
    headers: [
      "場次ID",
      "日期",
      "標題",
      "負責人姓名",
      "銀行名稱",
      "銀行帳號",
      "QR Code連結",
      "轉帳連結",
      "狀態",
      "建立時間",
      "菜單圖片連結",
    ],
  },
  {
    title: "訂單明細表",
    headers: [
      "場次ID",
      "日期",
      "標題",
      "負責人姓名",
      "姓名",
      "品項名稱",
      "價格",
      "備註",
      "建立時間",
      "最後修改時間",
    ],
  },
  {
    title: "付款追蹤表",
    headers: [
      "場次ID",
      "日期",
      "標題",
      "付款人姓名",
      "收款人姓名",
      "金額",
      "品項名稱",
      "備註",
      "付款人是否標記已付",
      "收款人是否確認收到",
      "核銷時間",
      "付款人標記時間",
    ],
  },
  {
    title: "問題回報表",
    headers: ["回報時間", "姓名", "類型", "描述", "截圖連結"],
  },
];

async function setup() {
  // Get existing sheets
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const existingSheets =
    spreadsheet.data.sheets?.map((s) => s.properties?.title) ?? [];

  console.log("現有工作表:", existingSheets);

  for (const ws of WORKSHEETS) {
    if (existingSheets.includes(ws.title)) {
      console.log(`工作表「${ws.title}」已存在，跳過建立`);
    } else {
      // Add new sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: ws.title },
              },
            },
          ],
        },
      });
      console.log(`已建立工作表「${ws.title}」`);
    }

    // Write header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ws.title}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [ws.headers],
      },
    });
    console.log(`已寫入「${ws.title}」的 header row`);
  }

  console.log("\n✅ 所有工作表已就緒！");
}

setup().catch((err) => {
  console.error("設定失敗:", err.message);
  process.exit(1);
});
