import type { BeforeInstallPromptEvent } from "./types";

type EchoInstallBannerProps = {
  installPromptEvent: BeforeInstallPromptEvent | null;
  showIosInstallHint: boolean;
  isSidebarOpen: boolean;
  onInstall: () => void;
};

export function EchoInstallBanner({
  installPromptEvent,
  showIosInstallHint,
  isSidebarOpen,
  onInstall,
}: EchoInstallBannerProps) {
  if ((!installPromptEvent && !showIosInstallHint) || isSidebarOpen) {
    return null;
  }

  return (
    <section className="rounded-[1.75rem] border border-neutral-200 bg-white px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-950">安装体验</p>
          <p className="mt-1 text-sm text-neutral-500">
            {installPromptEvent
              ? "这个版本已经补了 PWA 基础能力，可以直接安装到桌面或主屏幕。"
              : "iPhone 上请点浏览器分享按钮，再选“添加到主屏幕”。"}
          </p>
        </div>
        {installPromptEvent ? (
          <button
            className="rounded-full bg-neutral-950 px-4 py-2 text-sm text-white"
            type="button"
            onClick={onInstall}
          >
            安装 Echo
          </button>
        ) : null}
      </div>
    </section>
  );
}
