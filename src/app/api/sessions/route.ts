import { NextResponse } from "next/server";
import { getRows, appendRow } from "@/lib/sheets";

export async function GET() {
  try {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Taipei",
    });

    const [sessionRows, orderRows] = await Promise.all([
      getRows("訂餐場次表"),
      getRows("訂單明細表"),
    ]);

    // Count unique people per session
    const orderCounts: Record<string, Set<string>> = {};
    for (const row of orderRows.slice(1)) {
      const sid = row[0];
      const name = row[4];
      if (!orderCounts[sid]) orderCounts[sid] = new Set();
      orderCounts[sid].add(name);
    }

    const sessions = sessionRows
      .slice(1)
      .filter((row) => row[1] === today)
      .map((row) => ({
        id: row[0],
        date: row[1],
        title: row[2],
        organizer: row[3],
        bankName: row[4],
        bankAccount: row[5],
        qrCodeUrl: row[6] || "",
        transferLink: row[7] || "",
        menuImages: row[10] ? row[10].split(",") : [],
        status: row[8],
        createdAt: row[9],
        orderCount: orderCounts[row[0]]?.size || 0,
      }));

    sessions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Failed to fetch sessions:", error);
    return NextResponse.json({ error: "無法載入訂餐場次" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = (body.title || "").trim();
    const organizer = (body.organizer || "").trim();
    const bankName = (body.bankName || "").trim();
    const bankAccount = (body.bankAccount || "").trim();
    const qrCodeUrl = body.qrCodeUrl;
    const transferLink = (body.transferLink || "").trim();
    const menuImages = body.menuImages;

    if (!title || !organizer || !bankName || !bankAccount) {
      return NextResponse.json(
        { error: "請填寫所有必填欄位" },
        { status: 400 }
      );
    }

    const id = `s_${Date.now()}`;
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Taipei",
    });
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

    await appendRow("訂餐場次表", [
      id,
      today,
      title,
      organizer,
      bankName,
      bankAccount,
      qrCodeUrl || "",
      transferLink || "",
      "開放中",
      now,
      (menuImages || []).join(","),
    ]);

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json({ error: "建立場次失敗" }, { status: 500 });
  }
}
