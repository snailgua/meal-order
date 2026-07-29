import { createHash, randomUUID } from "node:crypto";
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
});

const storage = google.storage({ version: "v1", auth });
// 略高於各 route 的 maxDuration（60 秒），確保仍在執行的請求不會被誤判過期，
// 同時讓被中止的請求最多只凍結場次 2 分鐘，而不是 5 分鐘。
const LOCK_LEASE_MS = 2 * 60_000;
const LOCK_WAIT_MS = 15_000;
// GCS 偶發的 429/5xx 不代表鎖被別人拿走，直接放棄會讓使用者看到 500。
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 3;

export class ResourceBusyError extends Error {
  constructor() {
    super("另一個操作正在處理同一場次");
    this.name = "ResourceBusyError";
  }
}

function lockObjectName(resource: string): string {
  const hash = createHash("sha256").update(resource).digest("hex");
  return `_operation-locks/${hash}`;
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    code?: number | string;
    response?: { status?: number };
  };
  const value = candidate.response?.status ?? candidate.code;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// GCS 的 ifGenerationMatch=0 是跨 instance 的 atomic create-if-absent。
// 因此同一場次的訂單、關閉與付款確認不會同時進入 critical section。
export async function withResourceLock<T>(
  resource: string,
  operation: () => Promise<T>
): Promise<T> {
  const bucket = process.env.GCS_BUCKET_NAME;
  if (!bucket) throw new Error("GCS_BUCKET_NAME 未設定，無法取得資料寫入鎖");

  const object = lockObjectName(resource);
  const owner = randomUUID();
  const startedAt = Date.now();
  let generation: string | undefined;
  let transientRetries = 0;

  while (!generation) {
    try {
      const response = await storage.objects.insert({
        bucket,
        name: object,
        ifGenerationMatch: "0",
        media: {
          mimeType: "application/json",
          body: JSON.stringify({ owner, acquiredAt: new Date().toISOString() }),
        },
      });
      generation = response.data.generation || undefined;
      if (!generation) {
        // 鎖物件已經建立，只是回應缺 generation；不清掉就會留下孤兒鎖，
        // 讓整個場次卡到 lease 到期為止。
        await storage.objects
          .delete({ bucket, object })
          .catch(() => undefined);
        throw new Error("GCS lock 未回傳 generation");
      }
    } catch (error) {
      const status = statusCode(error) ?? 0;
      if (TRANSIENT_STATUS.has(status)) {
        if (transientRetries >= MAX_TRANSIENT_RETRIES) throw error;
        transientRetries++;
        await delay(200 * transientRetries);
        continue;
      }
      if (![409, 412].includes(status)) throw error;

      // 前一個 function 若非正常終止，鎖物件可能殘留；只依 generation
      // 條件刪除超過 lease 的舊鎖，絕不會刪到剛接手的新鎖。
      try {
        const existing = await storage.objects.get({ bucket, object });
        const createdAt = Date.parse(existing.data.timeCreated || "");
        const existingGeneration = existing.data.generation;
        if (
          existingGeneration &&
          Number.isFinite(createdAt) &&
          Date.now() - createdAt > LOCK_LEASE_MS
        ) {
          await storage.objects.delete({
            bucket,
            object,
            ifGenerationMatch: existingGeneration,
          });
          continue;
        }
      } catch (inspectError) {
        if (![404, 409, 412].includes(statusCode(inspectError) ?? 0)) {
          throw inspectError;
        }
      }

      if (Date.now() - startedAt >= LOCK_WAIT_MS) {
        throw new ResourceBusyError();
      }
      await delay(100 + Math.floor(Math.random() * 150));
    }
  }

  try {
    return await operation();
  } finally {
    // 放鎖失敗會讓整個場次卡到 lease 到期，暫時性錯誤值得重試幾次。
    for (let attempt = 0; ; attempt++) {
      try {
        await storage.objects.delete({
          bucket,
          object,
          ifGenerationMatch: generation,
        });
        break;
      } catch (error) {
        const status = statusCode(error) ?? 0;
        // Lease 到期後可能已由另一請求依 generation 接手；舊 owner 不可刪新鎖。
        if ([404, 409, 412].includes(status)) break;
        if (TRANSIENT_STATUS.has(status) && attempt < MAX_TRANSIENT_RETRIES) {
          await delay(200 * (attempt + 1));
          continue;
        }
        console.error("Failed to release resource lock:", error);
        break;
      }
    }
  }
}
