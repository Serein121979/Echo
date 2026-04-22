import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaServiceWorker } from "@/components/pwa/PwaServiceWorker";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Echo - 极简跨设备消息箱",
  description: "一个黑白极简的跨设备消息同步与整理工具",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Echo",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full overflow-hidden flex flex-col bg-background text-foreground">
        {children}
        <PwaServiceWorker />
      </body>
    </html>
  );
}
