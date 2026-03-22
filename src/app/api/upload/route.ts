import { NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "未選擇任何檔案" }, { status: 400 });
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
