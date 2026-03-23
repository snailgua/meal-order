import { NextResponse } from "next/server";
import { appendRow } from "@/lib/sheets";

// 問題回報表 column layout:
// [0]回報時間 [1]姓名 [2]類型 [3]描述

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = (body.name || "").trim();
    const type = (body.type || "").trim();
    const description = (body.description || "").trim();

    if (!name || !type || !description) {
      return NextResponse.json(
        { error: "請填寫所有必填欄位" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    await appendRow("問題回報表", [now, name, type, description]);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to submit feedback:", error);
    return NextResponse.json({ error: "送出回報失敗" }, { status: 500 });
  }
}
