import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "請提供文字內容" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "AI 解析功能未設定" },
        { status: 500 }
      );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `你是一個訂餐文字解析器。請把以下訂餐文字解析成 JSON 陣列。

每筆訂單必須包含：
- name: 訂餐人姓名（字串）
- item: 品項名稱（字串）
- price: 價格（數字，不含 $ 符號）
- note: 備註（字串，沒有就空字串）

規則：
- 一個人如果訂了多個品項，拆成多筆
- 價格一定是正整數
- 如果某行完全無法判斷姓名、品項、價格，就跳過
- 只回傳 JSON 陣列，不要任何其他文字或 markdown 標記

訂餐文字：
${text}`;

    const result = await model.generateContent(prompt);
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
