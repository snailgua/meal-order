export interface SheetSchema {
  title: string;
  headers: readonly string[];
}

export const SHEET_SCHEMAS: readonly SheetSchema[] = [
  {
    title: "訂餐場次表",
    headers: [
      "場次ID",
      "日期",
      "標題",
      "負責人姓名",
      "負責人銀行名稱",
      "負責人銀行帳號",
      "QR Code圖片連結",
      "轉帳連結",
      "狀態",
      "建立時間",
      "菜單圖片連結",
      "版本",
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
      "訂單ID",
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
      "訂單ID",
    ],
  },
  {
    title: "問題回報表",
    headers: ["回報時間", "姓名", "類型", "描述", "截圖連結", "回覆"],
  },
] as const;

export function normalizeHeader(values: readonly string[]): string[] {
  const normalized = [...values];
  while (normalized.at(-1) === "") normalized.pop();
  return normalized;
}

export function compareHeader(
  actualValues: readonly string[],
  expectedValues: readonly string[]
):
  | { ok: true }
  | {
      ok: false;
      index: number;
      actual: string | undefined;
      expected: string | undefined;
    } {
  const actual = normalizeHeader(actualValues);
  const expected = normalizeHeader(expectedValues);
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    if (actual[index] !== expected[index]) {
      return {
        ok: false,
        index,
        actual: actual[index],
        expected: expected[index],
      };
    }
  }
  return { ok: true };
}

export function acceptedHeaderVariants(
  schema: SheetSchema
): readonly (readonly string[])[] {
  if (schema.title === "訂餐場次表") {
    const legacyHeaders = schema.headers.map((header, index) => {
      if (index === 4) return "銀行名稱";
      if (index === 5) return "銀行帳號";
      if (index === 6) return "QR Code連結";
      return header;
    });
    return [
      schema.headers,
      legacyHeaders,
      schema.headers.slice(0, -1),
      legacyHeaders.slice(0, -1),
    ];
  }

  if (schema.title === "問題回報表") {
    return [schema.headers, schema.headers.slice(0, -1)];
  }

  return [schema.headers];
}

export function compareSheetHeader(
  actualValues: readonly string[],
  schema: SheetSchema
): ReturnType<typeof compareHeader> {
  for (const expected of acceptedHeaderVariants(schema)) {
    if (compareHeader(actualValues, expected).ok) return { ok: true };
  }
  return compareHeader(actualValues, schema.headers);
}
