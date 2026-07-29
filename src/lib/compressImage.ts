// 圖片轉 base64（送 /api/parse-ai 用）。
// 先在前端縮圖壓縮：Vercel request body 上限 4.5MB，手機截圖轉 base64 後很容易超過。
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法載入圖片"));
    };
    img.src = url;
  });
}

export async function imageFileToBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas not supported");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return {
      base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      mimeType: "image/jpeg",
    };
  } catch {
    // 瀏覽器解不開的格式（如部分 HEIC）就送原檔，Gemini 端仍支援
    return {
      base64: await fileToBase64(file),
      mimeType: file.type || "image/png",
    };
  }
}
