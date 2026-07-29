export interface NormalizedOrderInput {
  name: string;
  item: string;
  price: number;
  note: string;
}

export function requiredText(
  value: unknown,
  maxLength = 200
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function optionalText(
  value: unknown,
  maxLength = 2_000
): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : null;
}

export function positivePrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// 由瀏覽器在第一次送出時產生，失敗重送時沿用。時間戳保留場次 ID
// 原本可排序的特性，UUID 則避免不同裝置在同一毫秒碰撞。
export function idempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
    ? value
    : null;
}

export function normalizeOrderInput(value: unknown): NormalizedOrderInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const order = value as Record<string, unknown>;
  const name = requiredText(order.name);
  const item = requiredText(order.item);
  const price = positivePrice(order.price);
  const note = optionalText(order.note, 1_000);

  if (!name || !item || price === null || note === null) return null;
  return { name, item, price, note };
}
