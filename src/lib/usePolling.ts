import { useEffect } from "react";

// 每次輪詢都是 2 次 Google Sheets 讀取，而免費額度只有每分鐘 300 次。
// 50-60 人各開一個分頁就會把額度打爆（畫面上就是「更新失敗」）。
// 分頁切到背景時停止輪詢，回到前景立刻補抓一次，是最有效的減量方式。
export function usePolling(callback: () => void, intervalMs = 15000) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer === null) timer = setInterval(callback, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        callback();
        start();
      }
    };

    callback();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [callback, intervalMs]);
}
