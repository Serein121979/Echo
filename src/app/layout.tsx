import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo - 极简跨端云端剪贴板",
  description: "一个简洁现代的跨设备文本同步工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
