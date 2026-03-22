"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Payment } from "@/types";

interface ReceiverGroup {
  receiver: string;
  bankName: string;
  bankAccount: string;
  payments: Payment[];
  totalAmount: number;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [showQrCode, setShowQrCode] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [fetchError, setFetchError] = useState(false);

  const fetchPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/payments");
      if (res.ok) {
        setPayments(await res.json());
        setLastUpdated(
          new Date().toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })
        );
        setFetchError(false);
      }
    } catch (err) {
      console.error("Failed to fetch payments:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Cleanup old settled records on first load
    fetch("/api/cleanup", { method: "POST" }).catch(() => {});
    fetchPayments();
    const interval = setInterval(fetchPayments, 10000);
    return () => clearInterval(interval);
  }, [fetchPayments]);

  const groups: ReceiverGroup[] = useMemo(() => {
    const grouped: Record<string, Payment[]> = {};
    for (const p of payments) {
      if (!grouped[p.receiver]) grouped[p.receiver] = [];
      grouped[p.receiver].push(p);
    }
    return Object.entries(grouped).map(([receiver, items]) => ({
      receiver,
      bankName: items[0]?.bankName || "",
      bankAccount: items[0]?.bankAccount || "",
      payments: items,
      totalAmount: items.reduce((sum, p) => sum + p.amount, 0),
    }));
  }, [payments]);

  const handleAction = async (
    rowIndex: number,
    action: "payerConfirm" | "receiverConfirm"
  ) => {
    if (action === "receiverConfirm") {
      if (!confirm("這個按鍵只有開團的人可以點喔！\n確定要確認收到嗎？")) return;
    } else {
      if (!confirm("確定要標記已轉帳？")) return;
    }

    setActionLoading(rowIndex);
    try {
      const res = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, action }),
      });
      if (res.ok) {
        fetchPayments();
      } else {
        const data = await res.json();
        alert(data.error || "操作失敗");
      }
    } catch {
      alert("網路錯誤，請稍後再試");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center text-gray-500">
        載入中...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">付款追蹤</h1>
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            {fetchError ? "更新失敗，重試中..." : `更新於 ${lastUpdated}`}
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-center text-gray-500 py-8">
          目前沒有未付款的帳款
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.receiver}>
              {/* Receiver header */}
              <div className="bg-blue-50 border border-blue-200 rounded-t-xl px-4 py-3">
                <p className="font-semibold text-blue-900">
                  收款人：{group.receiver}
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  {group.bankName} {group.bankAccount}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  待收款合計：$
                  {group.totalAmount.toLocaleString("zh-TW")}
                </p>
                {/* QR Code & Transfer Link */}
                {(group.payments[0]?.qrCodeUrl ||
                  group.payments[0]?.transferLink) && (
                  <div className="flex gap-2 mt-2">
                    {group.payments[0]?.qrCodeUrl && (
                      <button
                        onClick={() =>
                          setShowQrCode(group.payments[0].qrCodeUrl)
                        }
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium active:bg-blue-700"
                      >
                        查看 QR Code
                      </button>
                    )}
                    {group.payments[0]?.transferLink && (
                      <a
                        href={group.payments[0].transferLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium active:bg-green-700"
                      >
                        點此轉帳
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Payment items */}
              <div className="border border-t-0 border-gray-200 rounded-b-xl divide-y bg-white">
                {group.payments.map((p) => {
                  const isLoading = actionLoading === p.rowIndex;
                  return (
                    <div key={p.rowIndex} className="p-4">
                      {/* Payer + item + amount */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {p.payer}
                            </span>
                            <StatusBadge payment={p} />
                          </div>
                          <p className="text-sm text-gray-600 mt-1">
                            {p.item}
                          </p>
                          {p.note && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              備註：{p.note}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">
                            {p.sessionTitle}
                            {p.sessionDate && ` (${p.sessionDate})`}
                          </p>
                        </div>
                        <span className="text-blue-600 font-semibold text-sm ml-2 shrink-0">
                          ${p.amount.toLocaleString("zh-TW")}
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div className="mt-3 flex gap-2">
                        {!p.payerConfirmed && (
                          <button
                            onClick={() =>
                              handleAction(p.rowIndex, "payerConfirm")
                            }
                            disabled={isLoading}
                            className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium active:bg-blue-700 disabled:opacity-50"
                          >
                            {isLoading ? "處理中..." : "我已轉帳"}
                          </button>
                        )}
                        {p.payerConfirmed && !p.receiverConfirmed && (
                          <button
                            onClick={() =>
                              handleAction(p.rowIndex, "receiverConfirm")
                            }
                            disabled={isLoading}
                            className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium active:bg-green-700 disabled:opacity-50"
                          >
                            {isLoading ? "處理中..." : "確認收到"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* QR Code Modal */}
      {showQrCode && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowQrCode(null)}
        >
          <button
            className="absolute top-4 right-4 text-white text-3xl font-bold"
            onClick={() => setShowQrCode(null)}
          >
            &times;
          </button>
          <img
            src={showQrCode}
            alt="收款 QR Code"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ payment }: { payment: Payment }) {
  if (payment.payerConfirmed && payment.receiverConfirmed) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        已核銷
      </span>
    );
  }
  if (payment.payerConfirmed) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
        待確認
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
      未付款
    </span>
  );
}
