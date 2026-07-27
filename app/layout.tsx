import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "環狀線鋼軌狀態監測中心",
  description: "整合鋼軌潤滑設備與磨耗量測資料的全線視覺化監測介面。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
