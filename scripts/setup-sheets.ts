import { google } from "googleapis";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  acceptedHeaderVariants,
  compareHeader,
  compareSheetHeader,
  SHEET_SCHEMAS,
} from "../src/lib/sheetSchema";

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

async function setup() {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const existingSheetData = spreadsheet.data.sheets ?? [];
  const existingSheets = existingSheetData.map((s) => s.properties?.title);
  console.log("現有工作表:", existingSheets);

  // 在任何寫入前先驗完所有既有 header。舊 7 欄 schema 必須另做真正
  // migration，絕不能只換 header 讓資料看似升級、實際全部錯欄。
  const errors: string[] = [];
  const headerUpgrades: {
    sheetId: number;
    columnIndex: number;
    header: string;
    title: string;
  }[] = [];
  for (const schema of SHEET_SCHEMAS) {
    if (!existingSheets.includes(schema.title)) continue;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${schema.title}!A1:Z1`,
    });
    const actual = (response.data.values?.[0] as string[] | undefined) || [];
    const comparison = compareSheetHeader(actual, schema);
    if (!comparison.ok) {
      errors.push(
        `「${schema.title}」第 ${comparison.index + 1} 欄不符：` +
          `實際=${JSON.stringify(comparison.actual)}，` +
          `預期=${JSON.stringify(comparison.expected)}`
      );
      continue;
    }
    if (schema.title === "訂餐場次表") {
      const previousVariants = acceptedHeaderVariants(schema).filter(
        (headers) => headers.length === schema.headers.length - 1
      );
      if (
        previousVariants.some(
          (headers) => compareHeader(actual, headers).ok
        )
      ) {
        const sheetId = existingSheetData.find(
          (sheet) => sheet.properties?.title === schema.title
        )?.properties?.sheetId;
        if (sheetId === undefined || sheetId === null) {
          errors.push(`「${schema.title}」找不到 sheetId，無法安全補版本欄`);
        } else {
          headerUpgrades.push({
            sheetId,
            columnIndex: schema.headers.length - 1,
            header: schema.headers.at(-1)!,
            title: schema.title,
          });
        }
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `既有工作表 schema 不相容，為避免破壞資料，本次零寫入：\n${errors.join("\n")}`
    );
  }

  const usedSheetIds = new Set(
    existingSheetData
      .map((item) => item.properties?.sheetId)
      .filter((id): id is number => id !== null && id !== undefined)
  );
  let nextSheetId = 1;
  const missing = SHEET_SCHEMAS.filter(
    (schema) => !existingSheets.includes(schema.title)
  ).map((schema) => {
    while (usedSheetIds.has(nextSheetId)) nextSheetId++;
    const sheetId = nextSheetId++;
    usedSheetIds.add(sheetId);
    return { schema, sheetId };
  });

  if (missing.length > 0 || headerUpgrades.length > 0) {
    // addSheet 與 header update 放在同一個 batch，任何 request 驗證失敗
    // 都不會留下「sheet 已建立但沒有 header」的半成品。
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          ...missing.flatMap(({ schema, sheetId }) => [
            {
              addSheet: {
                properties: { title: schema.title, sheetId },
              },
            },
            {
              updateCells: {
                start: { sheetId, rowIndex: 0, columnIndex: 0 },
                rows: [
                  {
                    values: schema.headers.map((header) => ({
                      userEnteredValue: { stringValue: header },
                    })),
                  },
                ],
                fields: "userEnteredValue",
              },
            },
          ]),
          ...headerUpgrades.map((upgrade) => ({
            updateCells: {
              start: {
                sheetId: upgrade.sheetId,
                rowIndex: 0,
                columnIndex: upgrade.columnIndex,
              },
              rows: [
                {
                  values: [
                    { userEnteredValue: { stringValue: upgrade.header } },
                  ],
                },
              ],
              fields: "userEnteredValue",
            },
          })),
        ],
      },
    });
    for (const { schema } of missing) {
      console.log(`已建立工作表「${schema.title}」並寫入 header`);
    }
    for (const upgrade of headerUpgrades) {
      console.log(`已為工作表「${upgrade.title}」補上「${upgrade.header}」欄`);
    }
  }
  for (const schema of SHEET_SCHEMAS) {
    if (existingSheets.includes(schema.title)) {
      if (!headerUpgrades.some((upgrade) => upgrade.title === schema.title)) {
        console.log(`工作表「${schema.title}」schema 正確，未改動`);
      }
    }
  }

  console.log("\n✅ 所有工作表已就緒！");
}

setup().catch((err) => {
  console.error("設定失敗:", err.message);
  process.exit(1);
});
