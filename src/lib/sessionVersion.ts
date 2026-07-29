export type SessionMutationDecision = "apply" | "replay" | "conflict";

// 版本本身就是最後一次成功 mutation 的 requestId。這同時提供 CAS 與
// durable replay detection，也能辨識「關閉→重開→舊關閉重送」的 ABA。
export function decideSessionMutation(
  currentVersion: string,
  expectedVersion: string,
  requestId: string
): SessionMutationDecision {
  if (currentVersion === requestId) return "replay";
  return currentVersion === expectedVersion ? "apply" : "conflict";
}
