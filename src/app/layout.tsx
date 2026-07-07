import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ManJyun Blog",
  description: "A self-hosted personal blog system.",
  icons: {
    icon: [{ url: "/icon-mj-terminal.svg", type: "image/svg+xml" }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
