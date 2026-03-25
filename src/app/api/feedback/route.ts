import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { appendRow } from "@/lib/sheets";

// 問題回報表 column layout:
// [0]回報時間 [1]姓名 [2]類型 [3]描述 [4]截圖連結(逗號分隔)

async function sendNotificationEmail(
  name: string,
  type: string,
  description: string,
  imageUrls: string
) {
  const email = process.env.SMTP_EMAIL;
  const password = process.env.SMTP_PASSWORD;
  const notifyTo = process.env.NOTIFICATION_EMAIL;

  if (!email || !password || !notifyTo) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: email, pass: password },
  });

  const imageSection = imageUrls
    ? `\n\n截圖：\n${imageUrls.split(",").join("\n")}`
    : "";

  await transporter.sendMail({
    from: email,
    to: notifyTo,
    subject: `[訂餐系統回報] ${type} — ${name}`,
    text: `回報人：${name}\n類型：${type}\n\n${description}${imageSection}`,
  });
}

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

    const imageUrls = (body.imageUrls || "").trim();

    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    await appendRow("問題回報表", [now, name, type, description, imageUrls]);

    // Send email notification (await so it completes before serverless function exits)
    try {
      await sendNotificationEmail(name, type, description, imageUrls);
    } catch (err) {
      console.error("Failed to send notification email:", err);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to submit feedback:", error);
    return NextResponse.json({ error: "送出回報失敗" }, { status: 500 });
  }
}
