import { NextResponse } from "next/server";
import { appendRow, getRows, isTombstoneFor } from "@/lib/sheets";
import {
  idempotencyKey,
  optionalText,
  requiredText,
} from "@/lib/inputValidation";
import { sheetWritesPaused } from "@/lib/maintenance";
import {
  ResourceBusyError,
  withResourceLock,
} from "@/lib/resourceLock";

export const maxDuration = 60;

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
        version: row[11] || "",
        orderCount: orderCounts[row[0]]?.size || 0,
      }));

    // createdAt 是「2026/7/29 下午5:09:42」中文格式，new Date() 解析不了；
    // 場次 ID 是 s_${Date.now()}，直接取時間戳排序
    const idTs = (s: { id: string }) => Number(s.id.split("_")[1]) || 0;
    sessions.sort((a, b) => idTs(b) - idTs(a));

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Failed to fetch sessions:", error);
    return NextResponse.json({ error: "無法載入訂餐場次" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const requestId = idempotencyKey(body.requestId);
    const title = requiredText(body.title);
    const organizer = requiredText(body.organizer);
    const bankName = requiredText(body.bankName);
    const bankAccount = requiredText(body.bankAccount);
    const qrCodeUrl = optionalText(body.qrCodeUrl);
    const transferLink = optionalText(body.transferLink);
    const menuImages = body.menuImages === undefined ? [] : body.menuImages;

    if (
      !requestId ||
      !title ||
      !organizer ||
      !bankName ||
      !bankAccount ||
      qrCodeUrl === null ||
      transferLink === null ||
      !Array.isArray(menuImages) ||
      menuImages.some((url) => typeof url !== "string") ||
      menuImages.some((url) => url.length > 2_000) ||
      menuImages.length > 20
    ) {
      return NextResponse.json(
        { error: "場次資料格式不正確" },
        { status: 400 }
      );
    }

    const id = `s_${requestId}`;
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Taipei",
    });
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    const normalizedMenuImages = menuImages
      .map((url) => url.trim())
      .filter(Boolean)
      .join(",");

    return await withResourceLock(`session:${id}`, async () => {
      const sessionRows = await getRows("訂餐場次表");
      if (sessionRows.slice(1).some((row) => isTombstoneFor(row, id))) {
        return NextResponse.json(
          { error: "這個建立請求對應的場次已刪除，不能由舊請求重新建立" },
          { status: 409 }
        );
      }
      const existing = sessionRows.slice(1).find((row) => row[0] === id);
      if (existing) {
        const sameRequest =
          existing[2] === title &&
          existing[3] === organizer &&
          existing[4] === bankName &&
          existing[5] === bankAccount &&
          (existing[6] || "") === qrCodeUrl &&
          (existing[7] || "") === transferLink &&
          (existing[10] || "") === normalizedMenuImages;
        if (!sameRequest) {
          return NextResponse.json(
            { error: "requestId 已用於不同的場次內容，請重新整理後再試" },
            { status: 409 }
          );
        }
        // Idempotency 的 first-write-wins：第一次 append 已成功但回應遺失時，
        // 重送同一 requestId 直接回傳原場次，不會再建一份。
        return NextResponse.json({
          id,
          version: existing[11] || "",
          replayed: true,
        });
      }

      await appendRow("訂餐場次表", [
        id,
        today,
        title,
        organizer,
        bankName,
        bankAccount,
        qrCodeUrl,
        transferLink,
        "開放中",
        now,
        normalizedMenuImages,
        requestId,
      ]);

      return NextResponse.json(
        { id, version: requestId, replayed: false },
        { status: 201 }
      );
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "相同的建立請求正在處理，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to create session:", error);
    return NextResponse.json({ error: "建立場次失敗" }, { status: 500 });
  }
}
