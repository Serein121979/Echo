import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaServiceWorker } from "@/components/pwa/PwaServiceWorker";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181c21" },
  ],
};

export const metadata: Metadata = {
  title: "Echo - 私人跨设备信息助手",
  description: "跨设备传输、检索和整理私人信息",
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
