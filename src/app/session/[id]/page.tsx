"use client";

import { useState, useEffect, useCallback, useMemo, use } from "react";
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
    if (!confirm("確定要關閉訂餐？關閉後將無法新增訂單。")) return;
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
    if (!confirm("確定要重新開放訂餐？")) return;
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
    if (!confirm("確定要刪除此場次嗎？\n此操作將同時刪除所有訂單與付款紀錄，且無法復原！")) return;
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

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center text-gray-500">
        載入中...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center text-gray-500">
        找不到此場次
      </div>
    );
  }

  const isOpen = session.status === "開放中";

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="text-blue-600 text-sm"
        >
          &larr; 返回
        </button>
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            {fetchError ? "更新失敗，重試中..." : `更新於 ${lastUpdated}`}
          </span>
        )}
      </div>

      {/* ① Session Info */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
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
                className="flex-1 border rounded-lg px-2 py-1 text-sm font-bold"
                autoFocus
                required
              />
              <button
                type="submit"
                className="text-blue-600 text-xs px-2 py-1 border border-blue-200 rounded"
              >
                儲存
              </button>
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                className="text-gray-500 text-xs px-2 py-1 border rounded"
              >
                取消
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{session.title}</h1>
              <button
                onClick={() => {
                  setTitleDraft(session.title);
                  setEditingTitle(true);
                }}
                className="text-gray-400 text-xs px-1.5 py-0.5 border rounded"
              >
                改標題
              </button>
            </div>
          )}
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              isOpen
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {session.status}
          </span>
        </div>
        <div className="mt-2 text-sm text-gray-600 space-y-1">
          <p>負責人：{session.organizer}</p>
          <p>
            收款帳戶：{session.bankName} {session.bankAccount}
          </p>
        </div>

        {/* QR Code */}
        {session.qrCodeUrl && (
          <div className="mt-3">
            <p className="text-sm text-gray-500 mb-1">收款 QR Code</p>
            <img
              src={session.qrCodeUrl}
              alt="收款 QR Code"
              className="h-40 rounded-lg border cursor-pointer"
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
            className="mt-3 inline-block bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium active:bg-green-700"
          >
            點此轉帳
          </a>
        )}

        {/* Menu Images */}
        {session.menuImages && session.menuImages.length > 0 && (
          <div className="mt-3">
            <p className="text-sm text-gray-500 mb-1">
              菜單（{session.menuImages.length} 張）
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {session.menuImages.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`菜單 ${i + 1}`}
                  className="h-32 rounded-lg border cursor-pointer shrink-0"
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
          className="bg-white rounded-xl shadow-sm border p-4 space-y-3"
        >
          <h2 className="font-semibold">我要訂餐</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              你的名字 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={orderForm.name}
              onChange={(e) =>
                setOrderForm({ ...orderForm, name: e.target.value })
              }
              className="w-full border rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              品項名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={orderForm.item}
              onChange={(e) =>
                setOrderForm({ ...orderForm, item: e.target.value })
              }
              placeholder="例如：香嫩爌肉飯"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              價格 <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={orderForm.price}
              onChange={(e) =>
                setOrderForm({ ...orderForm, price: e.target.value })
              }
              placeholder="例如：100"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              min="0"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">備註</label>
            <input
              type="text"
              value={orderForm.note}
              onChange={(e) =>
                setOrderForm({ ...orderForm, note: e.target.value })
              }
              placeholder="例如：配菜不要芹菜"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium active:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "送出中..." : "送出訂單"}
          </button>
        </form>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center text-yellow-700 text-sm">
          訂餐已截止，無法新增訂單
        </div>
      )}

      {/* ③ Order List */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h2 className="font-semibold mb-3">訂單列表（{orders.length} 筆）</h2>
        {orders.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">尚無訂單</p>
        ) : (
          <div className="divide-y">
            {orders.map((order) =>
              editingRowIndex === order.rowIndex ? (
                <form
                  key={order.rowIndex}
                  onSubmit={handleEditOrder}
                  className="py-3 space-y-2"
                >
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="姓名"
                    required
                  />
                  <input
                    type="text"
                    value={editForm.item}
                    onChange={(e) =>
                      setEditForm({ ...editForm, item: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="品項"
                    required
                  />
                  <input
                    type="number"
                    value={editForm.price}
                    onChange={(e) =>
                      setEditForm({ ...editForm, price: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
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
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="備註"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingRowIndex(null)}
                      className="flex-1 border py-2 rounded-lg text-sm font-medium text-gray-600"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <div key={order.rowIndex} className="py-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {order.name}
                        </span>
                        <span className="text-gray-300">|</span>
                        <span className="text-sm">{order.item}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-blue-600 font-medium text-sm">
                          ${order.price}
                        </span>
                        {order.note && (
                          <span className="text-gray-400 text-xs">
                            {order.note}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <button
                        onClick={() => startEdit(order)}
                        className="text-blue-600 text-xs px-2 py-1 border border-blue-200 rounded"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDeleteOrder(order.rowIndex)}
                        className="text-red-500 text-xs px-2 py-1 border border-red-200 rounded"
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
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">統計摘要</h2>
            <button
              onClick={handleCopySummary}
              className={`text-xs px-3 py-1 rounded-lg font-medium ${
                copied
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600 active:bg-gray-200"
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
                  <span className="text-gray-600">
                    ${s.total.toLocaleString("zh-TW")}
                  </span>
                </div>
                {s.notes.length > 0 && (
                  <div className="text-xs text-gray-400 ml-4">
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
          <div className="mt-3 pt-3 border-t font-semibold text-sm flex justify-between">
            <span>總計 {totalCount} 份</span>
            <span>共 ${totalPrice.toLocaleString("zh-TW")}</span>
          </div>
        </div>
      )}

      {/* ⑤ Close / Reopen Button */}
      {isOpen ? (
        <button
          onClick={handleCloseSession}
          className="w-full bg-red-500 text-white py-3 rounded-xl font-medium active:bg-red-600"
        >
          關閉訂餐
        </button>
      ) : (
        <button
          onClick={handleReopenSession}
          className="w-full bg-orange-500 text-white py-3 rounded-xl font-medium active:bg-orange-600"
        >
          重新開放訂餐
        </button>
      )}

      {/* ⑥ Delete Session */}
      <button
        onClick={handleDeleteSession}
        className="w-full border border-red-300 text-red-500 py-3 rounded-xl text-sm font-medium active:bg-red-50"
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
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
