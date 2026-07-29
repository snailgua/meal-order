import { NextResponse } from "next/server";
import { GoogleGenerativeAI, Part } from "@google/generative-ai";

// Gemini 解析大截圖可能超過 Vercel 預設的 function timeout
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const SYSTEM_PROMPT = `你是一個訂餐文字解析器。請把訂餐內容解析成 JSON 陣列。

每筆訂單必須包含：
- name: 訂餐人姓名（字串）
- item: 品項名稱（字串）
- price: 價格（數字，不含 $ 符號）
- note: 備註（字串，沒有就空字串）

規則：
- 一個人如果訂了多個品項，拆成多筆
- 價格一定是正整數
- 如果某行完全無法判斷姓名、品項、價格，就跳過
- 只回傳 JSON 陣列，不要任何其他文字或 markdown 標記`;

export async function POST(request: Request) {
  try {
    const { text, image, mimeType, images } = await request.json();

    // images: [{ data, mimeType }]；image/mimeType 為舊版單張格式
    const imageList: { data: string; mimeType?: string }[] = Array.isArray(
      images
    )
      ? images.filter((img) => img?.data)
      : image
        ? [{ data: image, mimeType }]
        : [];

    if (!text && imageList.length === 0) {
      return NextResponse.json(
        { error: "請提供文字或圖片" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "AI 解析功能未設定" },
        { status: 500 }
      );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const parts: Part[] = [{ text: SYSTEM_PROMPT }];

    if (imageList.length > 0) {
      for (const img of imageList) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType || "image/png",
            data: img.data,
          },
        });
      }
      parts.push({
        text:
          imageList.length > 1
            ? "請從這幾張圖片中辨識所有訂餐內容，解析成一個 JSON 陣列。圖片可能是同一段對話的連續截圖，跨圖重複出現的訂單只算一筆。"
            : "請從這張圖片中辨識所有訂餐內容，解析成 JSON 陣列。",
      });
    }

    if (text) {
      parts.push({ text: `訂餐文字：\n${text}` });
    }

    const result = await model.generateContent(parts);
    const response = result.response.text();

    // 從回應中提取 JSON（處理可能的 markdown 包裹）
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const orders = JSON.parse(jsonStr);

    // 驗證格式
    if (!Array.isArray(orders)) {
      return NextResponse.json(
        { error: "AI 回傳格式不正確" },
        { status: 500 }
      );
    }

    const validated = orders
      .filter(
        (o: Record<string, unknown>) =>
          o.name &&
          o.item &&
          typeof o.price === "number" &&
          o.price > 0
      )
      .map((o: Record<string, unknown>) => ({
        name: String(o.name).trim(),
        item: String(o.item).trim(),
        price: Number(o.price),
        note: o.note ? String(o.note).trim() : "",
      }));

    return NextResponse.json({ orders: validated });
  } catch (error) {
    console.error("AI parse error:", error);
    return NextResponse.json(
      { error: "AI 解析失敗，請改用手動輸入" },
      { status: 500 }
    );
  }
}
