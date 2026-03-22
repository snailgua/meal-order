import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "癌醫藥劑部吃喝",
  description: "癌醫藥劑部訂餐與對帳系統",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
      </head>
      <body className="bg-stone-50 min-h-screen pb-14 text-stone-800">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
