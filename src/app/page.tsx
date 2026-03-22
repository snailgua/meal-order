"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Session } from "@/types";

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
        setForm({
          title: `${todayStr} `,
          organizer: "",
          bankName: "第一銀行",
          bankAccount: "",
          transferLink: "",
        });
        setQrCodeFile(null);
        setMenuFiles([]);
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

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium active:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {submitting ? uploadProgress || "建立中..." : "建立場次"}
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
