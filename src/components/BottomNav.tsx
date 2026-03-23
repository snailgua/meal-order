"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  const tabs = [
    { href: "/guide", label: "怎麼用？" },
    { href: "/", label: "今日訂餐" },
    { href: "/payments", label: "付款追蹤" },
    { href: "/feedback", label: "回報問題" },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-md border-t border-stone-200 z-50">
      <div className="flex max-w-2xl mx-auto">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/" || pathname.startsWith("/session")
              : pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
                isActive
                  ? "text-emerald-700 border-t-2 border-emerald-600"
                  : "text-stone-400"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
