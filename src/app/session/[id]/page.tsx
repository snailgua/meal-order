"use client";

import { useState, useEffect, useCallback, useMemo, use, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Order } from "@/types";
import { parseTranscriptText } from "@/lib/parseTranscript";
import { imageFileToBase64 } from "@/lib/compressImage";
import { newRequestId } from "@/lib/requestId";
import { usePolling } from "@/lib/usePolling";

const MAX_TRANSCRIPT_IMAGES = 6;
const MAX_TRANSCRIPT_RAW_BYTES = 30 * 1024 * 1024;
const MAX_AI_IMAGE_PAYLOAD_CHARS = 3_500_000;
const MAX_BATCH_ORDERS = 200;
const MAX_ORDER_TEXT_LENGTH = 200;
const MAX_ORDER_NOTE_LENGTH = 1_000;

interface StableRequestId {
  signature: string;
  requestId: string;
}

function getStableRequestId(
  requestRef: { current: StableRequestId | null },
  signature: string
) {
  if (requestRef.current?.signature === signature) {
    return requestRef.current.requestId;
  }
  const requestId = newRequestId();
  requestRef.current = { signature, requestId };
  return requestId;
}

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
  version: string;
}

interface ItemStat {
  item: string;
  count: number;
  total: number;
  notes: { text: string; count: number }[];
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
  // 編輯中的訂單存「開始編輯當下的快照」：輪詢會刷新 orders，
  // 若只存 rowIndex、送出時再回查，可能拿到位移後的另一筆訂單
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);
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
  const [notFound, setNotFound] = useState(false);

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
  const [showTranscript, setShowTranscript] = useState(true);
  const [transcriptText, setTranscriptText] = useState("");
  const [parsedOrders, setParsedOrders] = useState<
    { name: string; item: string; price: number; note: string }[]
  >([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [transcriptSubmitting, setTranscriptSubmitting] = useState(false);
  const [editingParsedIndex, setEditingParsedIndex] = useState<number | null>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [transcriptImages, setTranscriptImages] = useState<File[]>([]);
  const addOrderRequestRef = useRef<StableRequestId | null>(null);
  const transcriptBatchRequestRef = useRef<StableRequestId | null>(null);
  const sessionPatchRequestRef = useRef<StableRequestId | null>(null);
  const titleExpectedVersionRef = useRef("");
  const infoExpectedVersionRef = useRef("");

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
      if (sessionRes.status === 404) {
        setSession(null);
        setOrders([]);
        setNotFound(true);
        setFetchError(false);
      } else if (!sessionRes.ok || !ordersRes.ok) {
        setFetchError(true);
      } else {
        setSession(await sessionRes.json());
        setOrders(await ordersRes.json());
        setNotFound(false);
        setLastUpdated(
          new Date().toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })
        );
        setFetchError(false);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  usePolling(fetchData);

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
    const payload = {
      sessionId: id,
      name: orderForm.name,
      item: orderForm.item,
      price: Number(orderForm.price),
      note: orderForm.note,
    };
    const requestId = getStableRequestId(
      addOrderRequestRef,
      JSON.stringify(payload)
    );
    setSubmitting(true);
    try {
      localStorage.setItem("userName", orderForm.name);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          requestId,
        }),
      });
      if (res.ok) {
        addOrderRequestRef.current = null;
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
    if (!editingOrder) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: editingOrder.id || undefined,
          rowIndex: editingOrder.rowIndex,
          sessionId: id,
          name: editForm.name,
          item: editForm.item,
          price: Number(editForm.price),
          note: editForm.note,
          createdAt: editingOrder.createdAt,
          original: {
            name: editingOrder.name,
            item: editingOrder.item,
            price: editingOrder.price,
            note: editingOrder.note,
            createdAt: editingOrder.createdAt,
            updatedAt: editingOrder.updatedAt,
          },
        }),
      });
      if (res.ok) {
        setEditingOrder(null);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "更新失敗");
        if (res.status === 409) {
          setEditingOrder(null);
          fetchData();
        }
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrder = async (order: Order) => {
    if (!confirm("確定要刪除此訂單？")) return;
    try {
      const params = new URLSearchParams({
        orderId: order.id || "",
        rowIndex: String(order.rowIndex),
        sessionId: order.sessionId,
        name: order.name,
        item: order.item,
        price: String(order.price),
        note: order.note || "",
        createdAt: order.createdAt || "",
        updatedAt: order.updatedAt || "",
      });
      const res = await fetch(`/api/orders?${params}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "刪除失敗");
        if (res.status === 409) fetchData();
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    }
  };

  const handleCloseSession = async () => {
    if (statusChanging || !session) return;
    if (!confirm("你是團主嗎？團主才能按關閉訂單哦～請不要亂按關閉訂單。\n\n確定要關閉訂餐？關閉後將無法新增訂單。")) return;
    setStatusChanging(true);
    const payload = {
      status: "已關閉",
      expectedVersion: session.version,
    };
    const requestId = getStableRequestId(
      sessionPatchRequestRef,
      JSON.stringify(payload)
    );
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      if (res.ok) {
        sessionPatchRequestRef.current = null;
        await fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "關閉失敗");
        if (res.status === 409) {
          sessionPatchRequestRef.current = null;
          await fetchData();
        }
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setStatusChanging(false);
    }
  };

  const handleReopenSession = async () => {
    if (statusChanging || !session) return;
    if (!confirm("這個按鍵只有團主才能按喔！\n不然開了也沒人處理喲～\n\n確定要重新開放訂餐嗎？")) return;
    setStatusChanging(true);
    const payload = {
      status: "開放中",
      expectedVersion: session.version,
    };
    const requestId = getStableRequestId(
      sessionPatchRequestRef,
      JSON.stringify(payload)
    );
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      if (res.ok) {
        sessionPatchRequestRef.current = null;
        await fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "重新開放失敗");
        if (res.status === 409) {
          sessionPatchRequestRef.current = null;
          await fetchData();
        }
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setStatusChanging(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!session) return;
    if (
      !confirm(
        "確定要刪除此場次嗎？\n此操作將同時刪除所有訂單與付款紀錄，且無法復原！"
      )
    )
      return;
    if (!confirm("再次確認：真的要永久刪除這個場次嗎？")) return;
    try {
      const params = new URLSearchParams({
        expectedVersion: session.version,
      });
      const res = await fetch(`/api/sessions/${id}?${params}`, {
        method: "DELETE",
      });
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
    setEditingOrder(order);
    setEditForm({
      name: order.name,
      item: order.item,
      price: String(order.price),
      note: order.note,
    });
  };

  const parseTranscript = async () => {
    // 有圖片 → 直接走 AI
    if (transcriptImages.length > 0) {
      const filesToParse = [...transcriptImages];
      const submittedText = transcriptText.trim();
      if (filesToParse.length > MAX_TRANSCRIPT_IMAGES) {
        setFailedLines([
          `一次最多解析 ${MAX_TRANSCRIPT_IMAGES} 張截圖，請移除部分圖片後再試`,
        ]);
        return;
      }
      const rawTotalBytes = filesToParse.reduce(
        (sum, file) => sum + file.size,
        0
      );
      if (rawTotalBytes > MAX_TRANSCRIPT_RAW_BYTES) {
        setFailedLines([
          "截圖原始檔總大小超過 30 MB，請一次少選幾張、分批解析",
        ]);
        return;
      }

      setAiParsing(true);
      setFailedLines([]);
      try {
        const images: { data: string; mimeType: string }[] = [];
        let payloadSize = 0;
        for (const file of filesToParse) {
          const { base64, mimeType } = await imageFileToBase64(file);
          payloadSize += base64.length;
          // Vercel request body 上限 4.5MB，預留 JSON 開銷
          if (payloadSize > MAX_AI_IMAGE_PAYLOAD_CHARS) {
            setFailedLines([
              "截圖總大小超過限制，請一次少選幾張、分批解析（解析結果會累加）",
            ]);
            return;
          }
          images.push({ data: base64, mimeType });
        }

        const res = await fetch("/api/parse-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            images,
            text: submittedText || undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const orders = Array.isArray(data.orders) ? data.orders : [];
          if (orders.length === 0) {
            setFailedLines([
              "AI 沒有辨識到可匯入的訂單，截圖與文字已保留，請確認內容後再試",
            ]);
            return;
          }
          setParsedOrders((prev) => [...prev, ...orders]); // 分批解析累加
          setTranscriptImages((current) =>
            current.filter((file) => !filesToParse.includes(file))
          );
          if (submittedText) {
            setTranscriptText((current) =>
              current.trim() === submittedText ? "" : current
            );
          }
        } else {
          const data = await res.json().catch(() => null);
          setFailedLines([
            data?.error
              ? `截圖辨識失敗：${data.error}`
              : `截圖辨識失敗（HTTP ${res.status}），請改用文字貼上或手動新增`,
          ]);
        }
      } catch {
        setFailedLines(["截圖辨識失敗，請改用文字貼上或手動新增"]);
      } finally {
        setAiParsing(false);
      }
      return;
    }

    // 純文字 → regex 先試，失敗再 AI
    const result = parseTranscriptText(transcriptText);
    const regexOrders = result.orders;
    const failed = result.failedLines;

    if (failed.length === 0 && regexOrders.length > 0) {
      setParsedOrders((prev) => [...prev, ...regexOrders]);
      setFailedLines([]);
      return;
    }

    const textForAI =
      regexOrders.length === 0 ? transcriptText : failed.join("\n");
    setAiParsing(true);
    setFailedLines([]);
    try {
      const res = await fetch("/api/parse-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textForAI }),
      });
      if (res.ok) {
        const data = await res.json();
        const aiOrders = Array.isArray(data.orders) ? data.orders : [];
        setParsedOrders((prev) => [...prev, ...regexOrders, ...aiOrders]);
        if (aiOrders.length === 0) {
          setFailedLines([
            regexOrders.length > 0
              ? "AI 沒有辨識到其他可匯入的訂單，原有草稿與文字已保留，請確認內容後再試"
              : "AI 沒有辨識到可匯入的訂單，原有草稿與文字已保留，請確認內容後再試",
          ]);
        }
      } else {
        setParsedOrders((prev) => [...prev, ...regexOrders]);
        setFailedLines(failed.length > 0 ? failed : [transcriptText]);
      }
    } catch {
      setParsedOrders((prev) => [...prev, ...regexOrders]);
      setFailedLines(failed.length > 0 ? failed : [transcriptText]);
    } finally {
      setAiParsing(false);
    }
  };

  const handleTranscriptImport = async () => {
    if (parsedOrders.length === 0) return;
    const invalidIndex = parsedOrders.findIndex(
      (order) =>
        typeof order.name !== "string" ||
        order.name.trim() === "" ||
        order.name.trim().length > MAX_ORDER_TEXT_LENGTH ||
        typeof order.item !== "string" ||
        order.item.trim() === "" ||
        order.item.trim().length > MAX_ORDER_TEXT_LENGTH ||
        typeof order.price !== "number" ||
        !Number.isFinite(order.price) ||
        order.price <= 0 ||
        typeof order.note !== "string" ||
        order.note.trim().length > MAX_ORDER_NOTE_LENGTH
    );
    if (invalidIndex !== -1) {
      setEditingParsedIndex(invalidIndex);
      alert(
        `第 ${invalidIndex + 1} 筆訂單格式不正確：姓名、品項須在 ${MAX_ORDER_TEXT_LENGTH} 字內，備註須在 ${MAX_ORDER_NOTE_LENGTH} 字內，價格須大於 0`
      );
      return;
    }
    if (parsedOrders.length > MAX_BATCH_ORDERS) {
      alert(
        `一次最多匯入 ${MAX_BATCH_ORDERS} 筆訂單，請刪除部分訂單後再試`
      );
      return;
    }

    const payload = {
      sessionId: id,
      orders: parsedOrders.map((order) => ({ ...order })),
    };
    const requestId = getStableRequestId(
      transcriptBatchRequestRef,
      JSON.stringify(payload)
    );
    setTranscriptSubmitting(true);
    try {
      const res = await fetch("/api/orders/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      if (res.ok) {
        const data = await res.json();
        transcriptBatchRequestRef.current = null;
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
        {notFound
          ? "找不到此場次"
          : fetchError
            ? "載入失敗，請稍後重新整理"
            : "找不到此場次"}
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
        {(lastUpdated || fetchError) && (
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
                const payload = {
                  title: titleDraft,
                  expectedVersion: titleExpectedVersionRef.current,
                };
                const requestId = getStableRequestId(
                  sessionPatchRequestRef,
                  JSON.stringify(payload)
                );
                try {
                  const res = await fetch(`/api/sessions/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...payload, requestId }),
                  });
                  if (res.ok) {
                    sessionPatchRequestRef.current = null;
                    setEditingTitle(false);
                    fetchData();
                  } else {
                    const data = await res.json();
                    alert(data.error || "更新失敗");
                    if (res.status === 409) {
                      sessionPatchRequestRef.current = null;
                      setEditingTitle(false);
                      fetchData();
                    }
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
                  titleExpectedVersionRef.current = session.version;
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
              const payload = {
                organizer: infoDraft.organizer,
                bankName: infoDraft.bankName,
                bankAccount: infoDraft.bankAccount,
                qrCodeUrl: infoDraft.qrCodeUrl,
                transferLink: infoDraft.transferLink,
                menuImages: infoDraft.menuImages.join(","),
                expectedVersion: infoExpectedVersionRef.current,
              };
              const requestId = getStableRequestId(
                sessionPatchRequestRef,
                JSON.stringify(payload)
              );
              try {
                const res = await fetch(`/api/sessions/${id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...payload, requestId }),
                });
                if (res.ok) {
                  sessionPatchRequestRef.current = null;
                  setEditingInfo(false);
                  fetchData();
                } else {
                  const data = await res.json();
                  alert(data.error || "更新失敗");
                  if (res.status === 409) {
                    sessionPatchRequestRef.current = null;
                    setEditingInfo(false);
                    fetchData();
                  }
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
                infoExpectedVersionRef.current = session.version;
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
              min="1"
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
                把接龍文字貼進下方框框，或直接上傳 LINE 對話截圖 / 菜單照片。
                <br />
                不管什麼格式都可以，系統會自動辨識姓名、品項和價格。
              </p>
              <textarea
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder={"煜翔 香嫩爌肉飯 100\n子云 烤蒲燒鯛魚飯 110\n欣宜 蜜汁烤雞腿飯 120"}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition min-h-[120px] resize-y"
                rows={6}
              />
              {/* 截圖上傳 */}
              <div>
                <label className="flex items-center justify-center gap-2 cursor-pointer border-2 border-dashed border-stone-300 rounded-xl py-3 text-sm text-stone-500 font-medium active:bg-stone-50 hover:border-emerald-300 hover:text-emerald-600 transition">
                  <span>&#x1F4F7;</span>
                  <span>
                    {transcriptImages.length > 0
                      ? `已選 ${transcriptImages.length} 張截圖，可再加選`
                      : "上傳訂單截圖來匯入（可多張，LINE 對話、菜單照片等）"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      // 先複製出來：e.target.files 是即時 FileList，
                      // 清空 value 後、updater 執行時就變空了
                      const files = Array.from(e.target.files || []);
                      setTranscriptImages((prev) => [...prev, ...files]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {transcriptImages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {transcriptImages.map((img, i) => (
                      <div key={i} className="relative inline-block">
                        <img
                          src={URL.createObjectURL(img)}
                          alt={`截圖預覽 ${i + 1}`}
                          className="h-24 rounded-xl border border-stone-200"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setTranscriptImages((prev) =>
                              prev.filter((_, j) => j !== i)
                            )
                          }
                          className="absolute -top-1.5 -right-1.5 bg-rose-400 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={parseTranscript}
                disabled={(!transcriptText.trim() && transcriptImages.length === 0) || aiParsing}
                className="w-full bg-stone-100 text-stone-600 py-2.5 rounded-xl text-sm font-medium active:bg-stone-200 disabled:opacity-40"
              >
                {aiParsing ? "AI 解析中..." : "解析文字"}
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
                              min="1"
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
                    AI 也無法辨識這幾行，請手動新增這幾筆
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
              editingOrder &&
              (editingOrder.id
                ? editingOrder.id === order.id
                : editingOrder.rowIndex === order.rowIndex) ? (
                <form
                  key={order.id || `row-${order.rowIndex}`}
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
                    min="1"
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
                      onClick={() => setEditingOrder(null)}
                      className="flex-1 border border-stone-200 py-2 rounded-xl text-sm font-medium text-stone-500"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  key={order.id || `row-${order.rowIndex}`}
                  className="py-3.5"
                >
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
                        onClick={() => handleDeleteOrder(order)}
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
          disabled={statusChanging}
          className="w-full bg-rose-500 text-white py-3 rounded-2xl font-medium active:bg-rose-600 shadow-sm disabled:opacity-50"
        >
          {statusChanging ? "處理中..." : "關閉訂餐"}
        </button>
      ) : (
        <button
          onClick={handleReopenSession}
          disabled={statusChanging}
          className="w-full bg-amber-500 text-white py-3 rounded-2xl font-medium active:bg-amber-600 shadow-sm disabled:opacity-50"
        >
          {statusChanging ? "處理中..." : "重新開放訂餐"}
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
