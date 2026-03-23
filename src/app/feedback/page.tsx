"use client";

import { useState, useEffect, useRef } from "react";

export default function FeedbackPage() {
  const [form, setForm] = useState({
    name: "",
    type: "Bug 回報",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedName = localStorage.getItem("userName");
    if (savedName) {
      setForm((prev) => ({ ...prev, name: savedName }));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, imageUrls: imageUrls.join(",") }),
      });
      if (res.ok) {
        setSubmitted(true);
        setForm((prev) => ({ ...prev, type: "Bug 回報", description: "" }));
        setImageUrls([]);
      } else {
        const data = await res.json();
        alert(data.error || "送出失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">回報問題</h1>
        <p className="text-stone-400 text-sm mt-1">
          遇到 bug 或有建議？跟我說！
        </p>
      </div>

      {submitted ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3">
          <div className="text-5xl">&#x1F389;</div>
          <p className="font-semibold text-lg">感謝回報！</p>
          <p className="text-sm text-stone-400">
            我會盡快處理，謝謝你幫忙讓這個 app 變得更好～
          </p>
          <button
            onClick={() => setSubmitted(false)}
            className="mt-2 bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium active:bg-emerald-700"
          >
            再回報一個
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm p-5 space-y-4"
        >
          <div>
            <label className="block text-sm text-stone-500 mb-1">
              你的名字 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-stone-500 mb-1">
              問題類型 <span className="text-rose-400">*</span>
            </label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={inputClass}
            >
              <option value="Bug 回報">Bug 回報</option>
              <option value="功能建議">功能建議</option>
              <option value="其他">其他</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-stone-500 mb-1">
              問題描述 <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="請描述你遇到的問題或建議..."
              className={`${inputClass} min-h-[120px] resize-y`}
              rows={5}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-stone-500 mb-1">
              截圖（選填，可多張）
            </label>
            {imageUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
                {imageUrls.map((url, i) => (
                  <div key={i} className="relative shrink-0">
                    <img
                      src={url}
                      alt={`截圖 ${i + 1}`}
                      className="h-20 rounded-lg border border-stone-200"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setImageUrls((prev) => prev.filter((_, j) => j !== i))
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
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full border border-dashed border-stone-300 rounded-xl py-3 text-sm text-stone-400 active:bg-stone-50 disabled:opacity-50"
            >
              {uploading ? "上傳中..." : "上傳截圖"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                setUploading(true);
                try {
                  const formData = new FormData();
                  for (const file of Array.from(files)) {
                    formData.append("files", file);
                  }
                  const res = await fetch("/api/upload", {
                    method: "POST",
                    body: formData,
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setImageUrls((prev) => [...prev, ...data.urls]);
                  } else {
                    alert("上傳失敗");
                  }
                } catch {
                  alert("上傳失敗");
                } finally {
                  setUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || uploading}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium active:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            {submitting ? "送出中..." : "送出回報"}
          </button>
        </form>
      )}
    </div>
  );
}
