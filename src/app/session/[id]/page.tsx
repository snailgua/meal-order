"use client";

import { useState, useEffect, useCallback, useMemo, use, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Order } from "@/types";

interface SessionDetail {
  id: string;
  date: string;
  title: string;
  organizer: string;
  bankName: string;
  bankAccount: string;
  qrCodeUrl: string;
  transferLink: string;
  menuImages: string[];
  status: "開放中" | "已關閉";
  createdAt: string;
}

interface ItemStat {
  item: string;
  count: number;
  total: number;
  notes: { text: string; count: number }[];
}

// 外部訂餐平台格式解析（＋收款 分隔的區塊格式）
function parseExternalPlatform(
  text: string
): { name: string; item: string; price: number; note: string }[] {
  const orders: { name: string; item: string; price: number; note: string }[] =
    [];
  const blocks = text
    .split(/＋收款/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    let name = "";
    let price = 0;
    let item = "";
    let comment = "";
    let details = "";

    for (const line of lines) {
      if (line.includes("訂購人姓名")) {
        const m = line.match(/訂購人姓名[：:]\s*(.+)/);
        if (m) name = m[1].trim();
      } else if (/^\$\d+/.test(line) && line.includes("份")) {
        const m = line.match(/^\$(\d+)/);
        if (m) price = parseInt(m[1]);
      } else if (
        /\.\s*$/.test(line) &&
        line.length < 30 &&
        !line.includes("/")
      ) {
        item = line.replace(/\.\s*$/, "").trim();
      } else if (/^留言[：:]/.test(line)) {
        comment = line.replace(/^留言[：:]\s*/, "").trim();
      } else if (line.includes("/") && /\$\d+/.test(line)) {
        const m = line.match(/^(.+?)\/\s*\$\d+\s*\/\s*\d+份\s*$/);
        if (m) details = m[1].replace(/\/\s*$/, "").trim();
      }
    }

    if (!name) {
      for (const line of lines) {
        if (
          !line.startsWith("$") &&
          !/\.\s*$/.test(line) &&
          !line.includes("/") &&
          !/^留言[：:]/.test(line) &&
          !line.includes("訂購人") &&
          !line.includes("account_circle") &&
          !/^\d{8,}$/.test(line)
        ) {
          name = line.trim();
          break;
        }
      }
    }

    if (name && price > 0) {
      const noteParts: string[] = [];
      if (details) noteParts.push(details);
      if (comment) noteParts.push(comment);
      orders.push({
        name,
        item: item || "未指定",
        price,
        note: noteParts.join("; "),
      });
    }
  }

  return orders;
}

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({
    organizer: "",
    bankName: "",
    bankAccount: "",
    qrCodeUrl: "",
    transferLink: "",
    menuImages: [] as string[],
  });
  const [uploadingQr, setUploadingQr] = useState(false);
  const [uploadingMenu, setUploadingMenu] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const menuInputRef = useRef<HTMLInputElement>(null);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [fetchError, setFetchError] = useState(false);

  const [orderForm, setOrderForm] = useState({
    name: "",
    item: "",
    price: "",
    note: "",
  });

  const [editForm, setEditForm] = useState({
    name: "",
    item: "",
    price: "",
    note: "",
  });

  // 轉錄匯入
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [parsedOrders, setParsedOrders] = useState<
    { name: string; item: string; price: number; note: string }[]
  >([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [transcriptSubmitting, setTranscriptSubmitting] = useState(false);
  const [editingParsedIndex, setEditingParsedIndex] = useState<number | null>(null);

  useEffect(() => {
    const savedName = localStorage.getItem("userName");
    if (savedName) {
      setOrderForm((prev) => ({ ...prev, name: savedName }));
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [sessionRes, ordersRes] = await Promise.all([
        fetch(`/api/sessions/${id}`),
        fetch(`/api/orders?sessionId=${id}`),
      ]);
      if (sessionRes.ok) setSession(await sessionRes.json());
      if (ordersRes.ok) setOrders(await ordersRes.json());
      setLastUpdated(
        new Date().toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })
      );
      setFetchError(false);
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Statistics
  const stats: ItemStat[] = useMemo(() => {
    const grouped: Record<
      string,
      { count: number; total: number; noteMap: Record<string, number> }
    > = {};
    for (const order of orders) {
      const itemKey = order.item.trim();
      if (!grouped[itemKey]) {
        grouped[itemKey] = { count: 0, total: 0, noteMap: {} };
      }
      grouped[itemKey].count += 1;
      grouped[itemKey].total += order.price;
      if (order.note) {
        const noteKey = order.note.trim();
        grouped[itemKey].noteMap[noteKey] =
          (grouped[itemKey].noteMap[noteKey] || 0) + 1;
      }
    }
    return Object.entries(grouped).map(([item, data]) => ({
      item,
      count: data.count,
      total: data.total,
      notes: Object.entries(data.noteMap).map(([text, count]) => ({
        text,
        count,
      })),
    }));
  }, [orders]);

  const totalCount = orders.length;
  const totalPrice = orders.reduce((sum, o) => sum + o.price, 0);

  const generateSummary = () => {
    const lines = stats.map((s) => {
      let line = `${s.item} ×${s.count}`;
      if (s.notes.length > 0) {
        const noteStr = s.notes
          .map((n) => `${n.count}份${n.text}`)
          .join("、");
        line += `（${noteStr}）`;
      }
      return line;
    });
    lines.push(
      `總計：${totalCount} 份，共 $${totalPrice.toLocaleString("zh-TW")}`
    );
    return lines.join("\n");
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(generateSummary());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("複製失敗，請手動複製");
    }
  };

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      localStorage.setItem("userName", orderForm.name);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          name: orderForm.name,
          item: orderForm.item,
          price: Number(orderForm.price),
          note: orderForm.note,
        }),
      });
      if (res.ok) {
        setOrderForm((prev) => ({ ...prev, item: "", price: "", note: "" }));
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "新增失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRowIndex) return;
    setSubmitting(true);
    try {
      const editingOrder = orders.find((o) => o.rowIndex === editingRowIndex);
      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIndex: editingRowIndex,
          sessionId: id,
          name: editForm.name,
          item: editForm.item,
          price: Number(editForm.price),
          note: editForm.note,
          createdAt: editingOrder?.createdAt,
        }),
      });
      if (res.ok) {
        setEditingRowIndex(null);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "更新失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrder = async (rowIndex: number) => {
    if (!confirm("確定要刪除此訂單？")) return;
    try {
      const res = await fetch(`/api/orders?rowIndex=${rowIndex}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "刪除失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    }
  };

  const handleCloseSession = async () => {
    if (!confirm("你是團主嗎？團主才能按關閉訂單哦～請不要亂按關閉訂單。\n\n確定要關閉訂餐？關閉後將無法新增訂單。")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已關閉" }),
      });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "關閉失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    }
  };

  const handleReopenSession = async () => {
    if (!confirm("這個按鍵只有團主才能按喔！\n不然開了也沒人處理喲～\n\n確定要重新開放訂餐嗎？")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "開放中" }),
      });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "重新開放失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    }
  };

  const handleDeleteSession = async () => {
    if (
      !confirm(
        "確定要刪除此場次嗎？\n此操作將同時刪除所有訂單與付款紀錄，且無法復原！"
      )
    )
      return;
    if (!confirm("再次確認：真的要永久刪除這個場次嗎？")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/");
      } else {
        const data = await res.json();
        alert(data.error || "刪除失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    }
  };

  const startEdit = (order: Order) => {
    setEditingRowIndex(order.rowIndex);
    setEditForm({
      name: order.name,
      item: order.item,
      price: String(order.price),
      note: order.note,
    });
  };

  const parseTranscript = () => {
    // 自動偵測外部訂餐平台格式（含「＋收款」或「$XXX / N 份」）
    if (
      transcriptText.includes("＋收款") ||
      /\$\d+\s*\/\s*\d+\s*份/.test(transcriptText)
    ) {
      const platformOrders = parseExternalPlatform(transcriptText);
      if (platformOrders.length > 0) {
        setParsedOrders(platformOrders);
        setFailedLines([]);
        return;
      }
    }

    const lines = transcriptText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const results: { name: string; item: string; price: number; note: string }[] = [];
    const failed: string[] = [];

    for (const rawLine of lines) {
      let line = rawLine;

      // 1. 移除行首編號（例如 "1." "1、" "1:" "1)" "#1"）
      line = line.replace(/^[#＃]?\d+[.、:：)\]）】]\s*/, "");

      // 2. 全形空格轉半形、全形數字轉半形
      line = line.replace(/\u3000/g, " ");
      line = line.replace(/[０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)
      );

      // 3. 統一分隔符號：把常見分隔符（：、:、—、–、-、|、／、/、,、，）換成空格
      //    但保留品項名稱中可能出現的「-」（如 7-11），所以只替換前後有空格的或在姓名與品項間的
      line = line.replace(/[：:—–|／,，]\s*/g, " ");

      // 4. 移除價格的 $ ＄ NT NT$ 前綴
      line = line.replace(/(?:NT\$?|＄|\$)\s*(\d+)/gi, "$1");

      // 5. 移除「元」「塊」後綴
      line = line.replace(/(\d+)\s*[元塊]/, "$1");

      // 6. 用空白分割
      const tokens = line.split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length < 3) {
        failed.push(rawLine);
        continue;
      }

      const name = tokens[0];

      // 從最後面找價格（純數字的 token）
      let priceIndex = -1;
      for (let i = tokens.length - 1; i >= 2; i--) {
        if (/^\d+$/.test(tokens[i])) {
          priceIndex = i;
          break;
        }
      }
      if (priceIndex < 2) {
        failed.push(rawLine);
        continue;
      }

      const item = tokens.slice(1, priceIndex).join(" ");
      const price = Number(tokens[priceIndex]);

      // priceIndex 之後的 token 當作備註
      const note = tokens.slice(priceIndex + 1).join(" ");

      results.push({ name, item, price, note });
    }

    setParsedOrders(results);
    setFailedLines(failed);
  };

  const handleTranscriptImport = async () => {
    if (parsedOrders.length === 0) return;
    setTranscriptSubmitting(true);
    try {
      const res = await fetch("/api/orders/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, orders: parsedOrders }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`成功匯入 ${data.created} 筆訂單！`);
        setTranscriptText("");
        setParsedOrders([]);
        setShowTranscript(false);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "匯入失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setTranscriptSubmitting(false);
    }
  };

  const inputClass =
    "w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition";

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center text-stone-400">
        載入中...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center text-stone-400">
        找不到此場次
      </div>
    );
  }

  const isOpen = session.status === "開放中";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="text-emerald-600 text-sm font-medium"
        >
          &larr; 返回
        </button>
        {lastUpdated && (
          <span className="text-xs text-stone-400">
            {fetchError ? "更新失敗，重試中..." : `更新於 ${lastUpdated}`}
          </span>
        )}
      </div>

      {/* ① Session Info */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-start justify-between">
          {editingTitle ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const res = await fetch(`/api/sessions/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: titleDraft }),
                  });
                  if (res.ok) {
                    setEditingTitle(false);
                    fetchData();
                  } else {
                    const data = await res.json();
                    alert(data.error || "更新失敗");
                  }
                } catch {
                  alert("網路錯誤，請稍後再試");
                }
              }}
              className="flex-1 flex gap-2 mr-2"
            >
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="flex-1 border border-stone-200 rounded-xl px-2 py-1 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-200"
                autoFocus
                required
              />
              <button
                type="submit"
                className="text-emerald-600 text-xs px-2 py-1 border border-emerald-200 rounded-lg"
              >
                儲存
              </button>
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                className="text-stone-400 text-xs px-2 py-1 border border-stone-200 rounded-lg"
              >
                取消
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">
                {session.title}
              </h1>
              <button
                onClick={() => {
                  setTitleDraft(session.title);
                  setEditingTitle(true);
                }}
                className="text-stone-400 text-xs px-1.5 py-0.5 border border-stone-200 rounded-lg"
              >
                改標題
              </button>
            </div>
          )}
          <span
            className={`ml-3 px-3 py-1 rounded-full text-xs font-medium ${
              isOpen
                ? "bg-emerald-50 text-emerald-600"
                : "bg-stone-100 text-stone-400"
            }`}
          >
            {session.status}
          </span>
        </div>
        {editingInfo ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await fetch(`/api/sessions/${id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    organizer: infoDraft.organizer,
                    bankName: infoDraft.bankName,
                    bankAccount: infoDraft.bankAccount,
                    qrCodeUrl: infoDraft.qrCodeUrl,
                    transferLink: infoDraft.transferLink,
                    menuImages: infoDraft.menuImages.join(","),
                  }),
                });
                if (res.ok) {
                  setEditingInfo(false);
                  fetchData();
                } else {
                  const data = await res.json();
                  alert(data.error || "更新失敗");
                }
              } catch {
                alert("網路錯誤，請稍後再試");
              }
            }}
            className="mt-3 space-y-2"
          >
            <div>
              <label className="block text-xs text-stone-400 mb-0.5">負責人</label>
              <input
                type="text"
                value={infoDraft.organizer}
                onChange={(e) =>
                  setInfoDraft({ ...infoDraft, organizer: e.target.value })
                }
                className="w-full border border-stone-200 rounded-xl px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-0.5">銀行名稱</label>
              <input
                type="text"
                value={infoDraft.bankName}
                onChange={(e) =>
                  setInfoDraft({ ...infoDraft, bankName: e.target.value })
                }
                className="w-full border border-stone-200 rounded-xl px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-0.5">銀行帳號</label>
              <input
                type="text"
                value={infoDraft.bankAccount}
                onChange={(e) =>
                  setInfoDraft({ ...infoDraft, bankAccount: e.target.value })
                }
                className="w-full border border-stone-200 rounded-xl px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">收款 QR Code</label>
              {infoDraft.qrCodeUrl ? (
                <div className="flex items-center gap-2">
                  <img
                    src={infoDraft.qrCodeUrl}
                    alt="QR Code"
                    className="h-20 rounded-lg border border-stone-200"
                  />
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => qrInputRef.current?.click()}
                      disabled={uploadingQr}
                      className="text-emerald-600 text-xs px-3 py-1.5 border border-emerald-200 rounded-lg disabled:opacity-50"
                    >
                      {uploadingQr ? "上傳中..." : "更換"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInfoDraft({ ...infoDraft, qrCodeUrl: "" })}
                      className="text-rose-400 text-xs px-3 py-1.5 border border-rose-200 rounded-lg"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => qrInputRef.current?.click()}
                  disabled={uploadingQr}
                  className="w-full border border-dashed border-stone-300 rounded-xl py-3 text-sm text-stone-400 active:bg-stone-50 disabled:opacity-50"
                >
                  {uploadingQr ? "上傳中..." : "上傳 QR Code 圖片"}
                </button>
              )}
              <input
                ref={qrInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingQr(true);
                  try {
                    const formData = new FormData();
                    formData.append("files", file);
                    const res = await fetch("/api/upload", { method: "POST", body: formData });
                    if (res.ok) {
                      const data = await res.json();
                      setInfoDraft((prev) => ({ ...prev, qrCodeUrl: data.urls[0] }));
                    } else {
                      alert("上傳失敗");
                    }
                  } catch {
                    alert("上傳失敗");
                  } finally {
                    setUploadingQr(false);
                    e.target.value = "";
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-0.5">轉帳連結（選填）</label>
              <input
                type="text"
                value={infoDraft.transferLink}
                onChange={(e) =>
                  setInfoDraft({ ...infoDraft, transferLink: e.target.value })
                }
                placeholder="銀行 App 深層連結"
                className="w-full border border-stone-200 rounded-xl px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">菜單圖片</label>
              {infoDraft.menuImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
                  {infoDraft.menuImages.map((url, i) => (
                    <div key={i} className="relative shrink-0">
                      <img
                        src={url}
                        alt={`菜單 ${i + 1}`}
                        className="h-20 rounded-lg border border-stone-200"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setInfoDraft((prev) => ({
                            ...prev,
                            menuImages: prev.menuImages.filter((_, j) => j !== i),
                          }))
                        }
                        className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => menuInputRef.current?.click()}
                disabled={uploadingMenu}
                className="w-full border border-dashed border-stone-300 rounded-xl py-3 text-sm text-stone-400 active:bg-stone-50 disabled:opacity-50"
              >
                {uploadingMenu ? "上傳中..." : "上傳菜單圖片（可多選）"}
              </button>
              <input
                ref={menuInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  setUploadingMenu(true);
                  try {
                    const formData = new FormData();
                    for (const file of Array.from(files)) {
                      formData.append("files", file);
                    }
                    const res = await fetch("/api/upload", { method: "POST", body: formData });
                    if (res.ok) {
                      const data = await res.json();
                      setInfoDraft((prev) => ({
                        ...prev,
                        menuImages: [...prev.menuImages, ...data.urls],
                      }));
                    } else {
                      alert("上傳失敗");
                    }
                  } catch {
                    alert("上傳失敗");
                  } finally {
                    setUploadingMenu(false);
                    e.target.value = "";
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={uploadingQr || uploadingMenu}
                className="text-emerald-600 text-xs px-3 py-1.5 border border-emerald-200 rounded-lg disabled:opacity-50"
              >
                儲存
              </button>
              <button
                type="button"
                onClick={() => setEditingInfo(false)}
                className="text-stone-400 text-xs px-3 py-1.5 border border-stone-200 rounded-lg"
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-2 text-sm text-stone-500 space-y-0.5 flex items-start justify-between">
            <div>
              <p>負責人：{session.organizer}</p>
              <p>
                收款帳戶：{session.bankName} {session.bankAccount}
              </p>
            </div>
            <button
              onClick={() => {
                setInfoDraft({
                  organizer: session.organizer,
                  bankName: session.bankName,
                  bankAccount: session.bankAccount,
                  qrCodeUrl: session.qrCodeUrl || "",
                  transferLink: session.transferLink || "",
                  menuImages: session.menuImages || [],
                });
                setEditingInfo(true);
              }}
              className="text-stone-400 text-xs px-1.5 py-0.5 border border-stone-200 rounded-lg shrink-0"
            >
              編輯
            </button>
          </div>
        )}

        {/* QR Code */}
        {session.qrCodeUrl && (
          <div className="mt-4">
            <p className="text-sm text-stone-400 mb-1">收款 QR Code</p>
            <img
              src={session.qrCodeUrl}
              alt="收款 QR Code"
              className="h-40 rounded-xl border border-stone-200 cursor-pointer"
              onClick={() => setViewImage(session.qrCodeUrl)}
            />
          </div>
        )}

        {/* Transfer Link */}
        {session.transferLink && (
          <a
            href={session.transferLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium active:bg-emerald-700"
          >
            點此轉帳
          </a>
        )}

        {/* Menu Images */}
        {session.menuImages && session.menuImages.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-stone-400 mb-1">
              菜單（{session.menuImages.length} 張）
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {session.menuImages.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`菜單 ${i + 1}`}
                  className="h-32 rounded-xl border border-stone-200 cursor-pointer shrink-0"
                  onClick={() => setViewImage(url)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ② Order Form */}
      {isOpen ? (
        <form
          onSubmit={handleAddOrder}
          className="bg-white rounded-2xl shadow-sm p-5 space-y-4"
        >
          <h2 className="font-semibold text-lg">我要訂餐</h2>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              你的名字 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={orderForm.name}
              onChange={(e) =>
                setOrderForm({ ...orderForm, name: e.target.value })
              }
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              品項名稱 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={orderForm.item}
              onChange={(e) =>
                setOrderForm({ ...orderForm, item: e.target.value })
              }
              placeholder="例如：香嫩爌肉飯"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              價格 <span className="text-rose-400">*</span>
            </label>
            <input
              type="number"
              value={orderForm.price}
              onChange={(e) =>
                setOrderForm({ ...orderForm, price: e.target.value })
              }
              placeholder="例如：100"
              className={inputClass}
              min="0"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">備註</label>
            <input
              type="text"
              value={orderForm.note}
              onChange={(e) =>
                setOrderForm({ ...orderForm, note: e.target.value })
              }
              placeholder="例如：配菜不要芹菜"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium active:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {submitting ? "送出中..." : "送出訂單"}
          </button>
        </form>
      ) : (
        <div className="bg-amber-50 rounded-2xl p-4 text-center text-amber-600 text-sm">
          訂餐已截止，無法新增訂單
        </div>
      )}

      {/* 轉錄匯入區 */}
      {isOpen && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="w-full px-5 py-4 flex items-center justify-between text-left"
          >
            <span className="font-semibold text-base">轉錄匯入</span>
            <span className="text-stone-400 text-sm">
              {showTranscript ? "收起" : "展開"}
            </span>
          </button>
          {showTranscript && (
            <div className="px-5 pb-5 space-y-4">
              <p className="text-xs text-stone-400">
                貼上接龍或其他系統的訂單文字，每行格式：姓名 品項 價格
              </p>
              <textarea
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder={"煜翔 香嫩爌肉飯 100\n子云 烤蒲燒鯛魚飯 110\n欣宜 蜜汁烤雞腿飯 120"}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition min-h-[120px] resize-y"
                rows={6}
              />
              <button
                onClick={parseTranscript}
                disabled={!transcriptText.trim()}
                className="w-full bg-stone-100 text-stone-600 py-2.5 rounded-xl text-sm font-medium active:bg-stone-200 disabled:opacity-40"
              >
                解析文字
              </button>

              {parsedOrders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-stone-600">
                      解析結果（{parsedOrders.length} 筆）
                    </p>
                    <p className="text-xs text-stone-400">點擊可編輯</p>
                  </div>
                  <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
                    {parsedOrders.map((o, i) =>
                      editingParsedIndex === i ? (
                        <div key={i} className="bg-emerald-50/50 px-3 py-2.5 space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={o.name}
                              onChange={(e) => {
                                const updated = [...parsedOrders];
                                updated[i] = { ...updated[i], name: e.target.value };
                                setParsedOrders(updated);
                              }}
                              className="flex-1 min-w-0 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              placeholder="姓名"
                            />
                            <input
                              type="text"
                              value={o.item}
                              onChange={(e) => {
                                const updated = [...parsedOrders];
                                updated[i] = { ...updated[i], item: e.target.value };
                                setParsedOrders(updated);
                              }}
                              className="flex-[2] min-w-0 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              placeholder="品項"
                            />
                            <input
                              type="number"
                              value={o.price}
                              onChange={(e) => {
                                const updated = [...parsedOrders];
                                updated[i] = { ...updated[i], price: Number(e.target.value) };
                                setParsedOrders(updated);
                              }}
                              className="w-20 border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              placeholder="價格"
                              min="0"
                            />
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={o.note}
                              onChange={(e) => {
                                const updated = [...parsedOrders];
                                updated[i] = { ...updated[i], note: e.target.value };
                                setParsedOrders(updated);
                              }}
                              className="flex-1 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              placeholder="備註（選填）"
                            />
                            <button
                              type="button"
                              onClick={() => setEditingParsedIndex(null)}
                              className="text-emerald-600 text-xs px-3 py-1.5 border border-emerald-200 rounded-lg font-medium"
                            >
                              完成
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setParsedOrders(parsedOrders.filter((_, j) => j !== i));
                                setEditingParsedIndex(null);
                              }}
                              className="text-rose-400 text-xs px-3 py-1.5 border border-rose-200 rounded-lg font-medium"
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          key={i}
                          className="flex items-center px-3 py-2.5 cursor-pointer active:bg-stone-50"
                          onClick={() => setEditingParsedIndex(i)}
                        >
                          <span className="w-16 shrink-0 text-sm">{o.name}</span>
                          <span className="flex-1 text-sm text-stone-600 min-w-0 truncate">
                            {o.item}
                            {o.note && (
                              <span className="text-stone-400 text-xs ml-1">（{o.note}）</span>
                            )}
                          </span>
                          <span className="text-emerald-600 text-sm font-medium ml-2 shrink-0">
                            ${o.price}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                  <button
                    onClick={handleTranscriptImport}
                    disabled={transcriptSubmitting}
                    className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium active:bg-emerald-700 disabled:opacity-50 shadow-sm"
                  >
                    {transcriptSubmitting
                      ? "匯入中..."
                      : `全部匯入（${parsedOrders.length} 筆）`}
                  </button>
                </div>
              )}

              {failedLines.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-3 space-y-1">
                  <p className="text-sm font-medium text-amber-600">
                    以下 {failedLines.length} 行無法解析：
                  </p>
                  {failedLines.map((line, i) => (
                    <p key={i} className="text-xs text-amber-500 font-mono">
                      {line}
                    </p>
                  ))}
                  <p className="text-xs text-amber-400 mt-1">
                    請確認格式為「姓名 品項 價格」，或手動新增這幾筆
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ③ Order List */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-3">
          訂單列表（{orders.length} 筆）
        </h2>
        {orders.length === 0 ? (
          <p className="text-stone-400 text-sm text-center py-6">尚無訂單</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {orders.map((order) =>
              editingRowIndex === order.rowIndex ? (
                <form
                  key={order.rowIndex}
                  onSubmit={handleEditOrder}
                  className="py-4 space-y-2"
                >
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    className={inputClass}
                    placeholder="姓名"
                    required
                  />
                  <input
                    type="text"
                    value={editForm.item}
                    onChange={(e) =>
                      setEditForm({ ...editForm, item: e.target.value })
                    }
                    className={inputClass}
                    placeholder="品項"
                    required
                  />
                  <input
                    type="number"
                    value={editForm.price}
                    onChange={(e) =>
                      setEditForm({ ...editForm, price: e.target.value })
                    }
                    className={inputClass}
                    placeholder="價格"
                    min="0"
                    required
                  />
                  <input
                    type="text"
                    value={editForm.note}
                    onChange={(e) =>
                      setEditForm({ ...editForm, note: e.target.value })
                    }
                    className={inputClass}
                    placeholder="備註"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingRowIndex(null)}
                      className="flex-1 border border-stone-200 py-2 rounded-xl text-sm font-medium text-stone-500"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <div key={order.rowIndex} className="py-3.5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {order.name}
                        </span>
                        <span className="text-stone-300">|</span>
                        <span className="text-sm text-stone-600">
                          {order.item}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-emerald-600 font-medium text-sm">
                          ${order.price}
                        </span>
                        {order.note && (
                          <span className="text-stone-400 text-xs">
                            {order.note}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <button
                        onClick={() => startEdit(order)}
                        className="text-emerald-600 text-xs px-2 py-1 border border-emerald-200 rounded-lg"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDeleteOrder(order.rowIndex)}
                        className="text-rose-400 text-xs px-2 py-1 border border-rose-200 rounded-lg"
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ④ Statistics Summary */}
      {orders.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">統計摘要</h2>
            <button
              onClick={handleCopySummary}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition ${
                copied
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-stone-100 text-stone-500 active:bg-stone-200"
              }`}
            >
              {copied ? "已複製!" : "複製摘要"}
            </button>
          </div>
          <div className="space-y-2 text-sm">
            {stats.map((s) => (
              <div key={s.item}>
                <div className="flex justify-between">
                  <span>
                    {s.item} &times;{s.count}
                  </span>
                  <span className="text-stone-500">
                    ${s.total.toLocaleString("zh-TW")}
                  </span>
                </div>
                {s.notes.length > 0 && (
                  <div className="text-xs text-stone-400 ml-4">
                    {s.notes.map((n, i) => (
                      <span key={i}>
                        其中 {n.count} 份：{n.text}
                        {i < s.notes.length - 1 && "；"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 font-semibold text-sm flex justify-between">
            <span>總計 {totalCount} 份</span>
            <span>共 ${totalPrice.toLocaleString("zh-TW")}</span>
          </div>
        </div>
      )}

      {/* ⑤ Close / Reopen Button */}
      {isOpen ? (
        <button
          onClick={handleCloseSession}
          className="w-full bg-rose-500 text-white py-3 rounded-2xl font-medium active:bg-rose-600 shadow-sm"
        >
          關閉訂餐
        </button>
      ) : (
        <button
          onClick={handleReopenSession}
          className="w-full bg-amber-500 text-white py-3 rounded-2xl font-medium active:bg-amber-600 shadow-sm"
        >
          重新開放訂餐
        </button>
      )}

      {/* ⑥ Delete Session */}
      <button
        onClick={handleDeleteSession}
        className="w-full border border-rose-200 text-rose-400 py-3 rounded-2xl text-sm font-medium active:bg-rose-50"
      >
        刪除此場次
      </button>

      {/* Image Viewer Modal */}
      {viewImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white text-3xl font-bold"
            onClick={() => setViewImage(null)}
          >
            &times;
          </button>
          <img
            src={viewImage}
            alt="放大檢視"
            className="max-w-full max-h-full object-contain rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
