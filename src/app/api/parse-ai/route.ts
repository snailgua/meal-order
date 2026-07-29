import { NextResponse } from "next/server";
import { GoogleGenerativeAI, Part } from "@google/generative-ai";

// Gemini 解析大截圖可能超過 Vercel 預設的 function timeout
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MAX_IMAGES = 6;
const MAX_IMAGE_PAYLOAD_CHARS = 3_500_000;
const MAX_TEXT_LENGTH = 50_000;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

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
    const rawImageList = Array.isArray(images)
      ? images
      : image
        ? [
            {
              data: image,
              mimeType: typeof mimeType === "string" ? mimeType : "image/png",
            },
          ]
        : [];
    if (
      (text !== undefined && typeof text !== "string") ||
      (typeof text === "string" && text.length > MAX_TEXT_LENGTH) ||
      rawImageList.length > MAX_IMAGES
    ) {
      return NextResponse.json(
        { error: "文字或圖片數量超過限制" },
        { status: 400 }
      );
    }

    const imageList: { data: string; mimeType: string }[] = [];
    let imagePayloadSize = 0;
    for (const raw of rawImageList) {
      if (
        !raw ||
        typeof raw !== "object" ||
        typeof raw.data !== "string" ||
        !raw.data ||
        typeof raw.mimeType !== "string" ||
        !SUPPORTED_IMAGE_TYPES.has(raw.mimeType)
      ) {
        return NextResponse.json(
          { error: "圖片格式不正確" },
          { status: 400 }
        );
      }
      imagePayloadSize += raw.data.length;
      if (imagePayloadSize > MAX_IMAGE_PAYLOAD_CHARS) {
        return NextResponse.json(
          { error: "圖片總大小超過限制" },
          { status: 413 }
        );
      }
      imageList.push({ data: raw.data, mimeType: raw.mimeType });
    }

    if (!(typeof text === "string" && text.trim()) && imageList.length === 0) {
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
      .filter((o: unknown): o is Record<string, unknown> => {
        if (!o || typeof o !== "object" || Array.isArray(o)) return false;
        const record = o as Record<string, unknown>;
        return (
          typeof record.name === "string" &&
          typeof record.item === "string" &&
          typeof record.price === "number" &&
          Number.isFinite(record.price) &&
          record.price > 0
        );
      })
      .map((o: Record<string, unknown>) => ({
        name: String(o.name).trim(),
        item: String(o.item).trim(),
        price: Number(o.price),
        note: o.note ? String(o.note).trim() : "",
      }))
      .filter((order) => order.name && order.item)
      .slice(0, 200);

    return NextResponse.json({ orders: validated });
  } catch (error) {
    console.error("AI parse error:", error);
    return NextResponse.json(
      { error: "AI 解析失敗，請改用手動輸入" },
      { status: 500 }
    );
  }
}
