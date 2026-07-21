import type { Metadata } from "next";
import "./styles.css";
import "./chart.css";

export const metadata: Metadata = {
  title: "Epoch · Portfolio",
  description: "Personal satellite portfolio console",
  icons: {
    icon: [
      { url: "/favicon.png?v=epoch-20260721", type: "image/png", sizes: "64x64" },
      { url: "/favicon.ico?v=epoch-20260721", type: "image/x-icon" },
    ],
    shortcut: "/favicon.png?v=epoch-20260721",
    apple: "/apple-touch-icon.png?v=epoch-20260721",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
