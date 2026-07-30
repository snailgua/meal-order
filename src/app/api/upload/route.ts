import { NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage";

// 最多 10 張、合計 30 MB 上傳到 GCS，需要高於預設 timeout
export const maxDuration = 60;

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const values = formData.getAll("files");
    const files = values.filter((value): value is File => value instanceof File);

    if (files.length === 0 || files.length !== values.length) {
      return NextResponse.json({ error: "未選擇任何檔案" }, { status: 400 });
    }
    // 型別與大小分開回報，否則使用者看到「大小超過」卻其實是格式問題，無從修正
    const badType = files.find((file) => !ALLOWED_IMAGE_TYPES.has(file.type));
    if (badType) {
      return NextResponse.json(
        {
          error: `「${badType.name}」不是支援的圖片格式（JPEG／PNG／WebP／GIF／AVIF／HEIC）`,
        },
        { status: 415 }
      );
    }
    if (
      files.length > MAX_FILES ||
      files.some((file) => file.size <= 0 || file.size > MAX_FILE_BYTES) ||
      files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES
    ) {
      return NextResponse.json(
        { error: "僅接受最多 10 張圖片；單檔 10 MB、合計 30 MB 以內" },
        { status: 413 }
      );
    }

    const urls: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const url = await uploadFile(buffer, file.name, file.type);
      urls.push(url);
    }

    return NextResponse.json({ urls });
  } catch (error) {
    console.error("Failed to upload files:", error);
    return NextResponse.json({ error: "上傳檔案失敗" }, { status: 500 });
  }
}
