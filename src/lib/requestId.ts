// 冪等用的請求 ID：`<13 位毫秒時間戳>_<UUID v4>`，格式必須通過
// src/lib/inputValidation.ts 的 idempotencyKey 驗證。
//
// crypto.randomUUID() 只在 secure context（HTTPS / localhost）才存在，
// 用手機連區網 dev server（http://192.168.x.x:3000）或較舊的 in-app 瀏覽器
// 會是 undefined。少了它整個 app 的寫入操作都會失敗，所以保留 fallback。
function uuidV4(): string {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

export function newRequestId(): string {
  return `${Date.now()}_${uuidV4()}`;
}
