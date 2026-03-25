"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Session } from "@/types";
import { parseTranscriptText, type ParsedOrder } from "@/lib/parseTranscript";

export default function HomePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const todayStr = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
  });

  const [form, setForm] = useState({
    title: `${todayStr} `,
    organizer: "",
    bankName: "第一銀行",
    bankAccount: "",
    transferLink: "",
  });
  const [qrCodeFile, setQrCodeFile] = useState<File | null>(null);
  const [menuFiles, setMenuFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [parsedOrders, setParsedOrders] = useState<ParsedOrder[]>([]);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [editingParsedIndex, setEditingParsedIndex] = useState<number | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        setSessions(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("上傳失敗");
    const data = await res.json();
    return data.urls;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let qrCodeUrl = "";
      let menuImages: string[] = [];

      if (qrCodeFile) {
        setUploadProgress("上傳 QR Code 中...");
        const urls = await uploadFiles([qrCodeFile]);
        qrCodeUrl = urls[0];
      }
      if (menuFiles.length > 0) {
        setUploadProgress("上傳菜單圖片中...");
        menuImages = await uploadFiles(menuFiles);
      }

      setUploadProgress("建立場次中...");
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          qrCodeUrl,
          menuImages,
        }),
      });
      if (res.ok) {
        const sessionData = await res.json();

        // 如果有預輸入訂單（轉錄或手動），批次匯入
        const validOrders = parsedOrders.filter(
          (o) => o.name.trim() && o.item.trim() && o.price > 0
        );
        if (validOrders.length > 0 && sessionData.id) {
          setUploadProgress(`匯入 ${validOrders.length} 筆訂單中...`);
          const batchRes = await fetch("/api/orders/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionData.id,
              orders: validOrders,
            }),
          });
          if (!batchRes.ok) {
            alert("場次已建立，但訂單匯入失敗，請到場次頁重新匯入");
          }
        }

        setForm({
          title: `${todayStr} `,
          organizer: "",
          bankName: "第一銀行",
          bankAccount: "",
          transferLink: "",
        });
        setQrCodeFile(null);
        setMenuFiles([]);
        setTranscriptText("");
        setParsedOrders([]);
        setFailedLines([]);
        setShowTranscript(false);
        setShowForm(false);
        fetchSessions();
      } else {
        const data = await res.json();
        alert(data.error || "建立失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
      setUploadProgress("");
    }
  };

  const inputClass =
    "w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">NTUCCPharEats</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-full text-sm font-medium active:bg-emerald-700 shadow-sm"
        >
          {showForm ? "取消" : "開新訂單"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-2xl shadow-sm p-5 mb-6 space-y-4"
        >
          <h2 className="font-semibold text-lg">建立新訂餐場次</h2>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              訂餐標題 <span className="text-rose-400">*</span>
              <span className="text-stone-400 font-normal ml-1">
                例如：{todayStr} 午餐 — 池上便當
              </span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              負責人姓名 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={form.organizer}
              onChange={(e) => setForm({ ...form, organizer: e.target.value })}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              銀行名稱 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              placeholder="例如：第一銀行"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              銀行帳號 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={form.bankAccount}
              onChange={(e) =>
                setForm({ ...form, bankAccount: e.target.value })
              }
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-stone-500 mb-1">
              收款 QR Code 圖片
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setQrCodeFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-stone-400 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-600"
            />
            {qrCodeFile && (
              <div className="mt-2 relative inline-block">
                <img
                  src={URL.createObjectURL(qrCodeFile)}
                  alt="QR Code 預覽"
                  className="h-24 rounded-xl border border-stone-200"
                />
                <button
                  type="button"
                  onClick={() => setQrCodeFile(null)}
                  className="absolute -top-1.5 -right-1.5 bg-rose-400 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                >
                  x
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-stone-500 mb-1">
              轉帳連結
            </label>
            <input
              type="url"
              value={form.transferLink}
              onChange={(e) =>
                setForm({ ...form, transferLink: e.target.value })
              }
              placeholder="銀行 App 深層連結（選填）"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm text-stone-500 mb-1">
              菜單圖片（可多選）
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) =>
                setMenuFiles(Array.from(e.target.files || []))
              }
              className="w-full text-sm text-stone-400 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-600"
            />
            {menuFiles.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {menuFiles.map((file, i) => (
                  <div key={i} className="relative shrink-0">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`菜單 ${i + 1}`}
                      className="h-24 rounded-xl border border-stone-200"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMenuFiles((prev) =>
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

          {/* 預先輸入訂單區 */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-stone-600">
              預先輸入訂單（選填）
            </p>
            <p className="text-xs text-stone-400">
              團主可以在建立場次時先幫大家輸入訂單，用轉錄匯入或手動一筆一筆加都可以。
            </p>

            {/* 轉錄匯入 */}
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTranscript(!showTranscript)}
                className="w-full px-4 py-3 flex items-center justify-between text-left bg-stone-50"
              >
                <span className="text-sm font-medium text-stone-600">
                  轉錄匯入
                </span>
                <span className="text-stone-400 text-xs">
                  {showTranscript ? "收起" : "展開"}
                </span>
              </button>
              {showTranscript && (
                <div className="p-4 space-y-3">
                  <p className="text-xs text-stone-400">
                    貼上接龍或其他系統的訂單文字，建立場次時會一起匯入。
                    <br />
                    支援「你訂」、餐盒平台等格式。若格式無法解析，也可以用下方「手動新增」逐筆輸入。
                  </p>
                  <textarea
                    value={transcriptText}
                    onChange={(e) => setTranscriptText(e.target.value)}
                    placeholder={"煜翔 香嫩爌肉飯 100\n子云 烤蒲燒鯛魚飯 110\n欣宜 蜜汁烤雞腿飯 120"}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition min-h-[100px] resize-y"
                    rows={5}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const result = parseTranscriptText(transcriptText);
                      setParsedOrders((prev) => [...prev, ...result.orders]);
                      setFailedLines(result.failedLines);
                    }}
                    disabled={!transcriptText.trim()}
                    className="w-full bg-stone-100 text-stone-600 py-2 rounded-xl text-sm font-medium active:bg-stone-200 disabled:opacity-40"
                  >
                    解析文字
                  </button>

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
                        請確認格式為「姓名 品項 價格」，或用下方手動新增
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 手動新增按鈕 */}
            <button
              type="button"
              onClick={() => {
                const newOrder: ParsedOrder = { name: "", item: "", price: 0, note: "" };
                setParsedOrders((prev) => [...prev, newOrder]);
                setEditingParsedIndex(parsedOrders.length);
              }}
              className="w-full border-2 border-dashed border-stone-300 text-stone-500 py-2.5 rounded-xl text-sm font-medium active:bg-stone-50"
            >
              ＋ 手動新增一筆訂單
            </button>

            {/* 訂單列表（轉錄 + 手動共用） */}
            {parsedOrders.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-stone-600">
                    已輸入 {parsedOrders.length} 筆訂單
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
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium active:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {(() => {
              if (submitting) return uploadProgress || "建立中...";
              const valid = parsedOrders.filter(
                (o) => o.name.trim() && o.item.trim() && o.price > 0
              ).length;
              return valid > 0
                ? `建立場次並匯入 ${valid} 筆訂單`
                : "建立場次";
            })()}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-center text-stone-400 py-12">載入中...</p>
      ) : sessions.length === 0 ? (
        <p className="text-center text-stone-400 py-12">今天還沒有訂餐場次</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {sessions.map((session, i) => (
            <Link
              key={session.id}
              href={`/session/${session.id}`}
              className="block"
            >
              <div
                className={`px-5 py-4 active:bg-stone-50 transition ${
                  i > 0 ? "border-t border-stone-100" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base truncate">
                      {session.title}
                    </h3>
                    <p className="text-sm text-stone-400 mt-0.5">
                      負責人：{session.organizer}　|　已訂餐：
                      {session.orderCount} 人
                    </p>
                  </div>
                  <span
                    className={`ml-3 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                      session.status === "開放中"
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-stone-100 text-stone-400"
                    }`}
                  >
                    {session.status}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
