import "./style.css";
import "@phosphor-icons/web/regular/style.css";

import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import type { TrayIconEvent } from "@tauri-apps/api/tray";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load } from "@tauri-apps/plugin-store";
import * as tus from "tus-js-client";

const STORE_PATH = "echo-store.json";
const STORE_KEY = "appState";
const RECENT_LIMIT = 100;
const MAX_SYNC_BYTES = 200 * 1024;
const CLIPBOARD_POLL_MS = 1200;
const DEDUPE_WINDOW_MS = 10_000;
const IGNORE_WINDOW_MS = 15_000;
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const currentWindow = getCurrentWindow();
const isOrbWindow = currentWindow.label === "orb";

type ClipKind = "text" | "code";

type AttachmentRecord = {
  id: string;
  storagePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadStatus: string;
  signedUrl: string | null;
};

type ClipRecord = {
  id: string;
  content: string;
  kind: ClipKind;
  contentHash: string;
  sourceDeviceId: string;
  sourcePlatform: string;
  isPinned: boolean;
  createdAt: string;
  attachments: AttachmentRecord[];
};

type PendingClip = {
  content: string;
  kind: ClipKind;
  hash: string;
  createdAt: string;
};

type NativeClipboardFile = {
  kind: "native";
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type NativeFileDescriptor = {
  id: string;
  name: string;
  size: number;
  fileType: string;
  lastModified: number;
};

type PendingComposerAttachment =
  | { kind: "browser"; file: File }
  | NativeClipboardFile;

type TimedHash = {
  hash: string;
  expiresAt: number;
};

type PersistedState = {
  deviceId: string;
  pendingQueue: PendingClip[];
  recentUploads: TimedHash[];
  ignoredHashes: TimedHash[];
  settings: {
    monitorClipboard: boolean;
    autostartEnabled: boolean;
    floatingBallEnabled: boolean;
    lastSeenTimestamp: string | null;
  };
};

type BannerTone = "neutral" | "success" | "warning" | "danger";

type BannerState = {
  tone: BannerTone;
  message: string;
};

const env = import.meta.env as Record<string, string | undefined>;
const supabaseUrl = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const secureAuthStorage = {
  getItem(key: string) {
    return invoke<string | null>("secure_storage_get", { key });
  },
  setItem(key: string, value: string) {
    return invoke<void>("secure_storage_set", { key, value });
  },
  removeItem(key: string) {
    return invoke<void>("secure_storage_remove", { key });
  },
};

const root = (() => {
  const value = document.querySelector<HTMLDivElement>("#app");
  if (!value) {
    throw new Error("找不到桌面端挂载节点。");
  }
  return value;
})();

function isValidUrl(value?: string) {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isConfiguredKey(value?: string) {
  return Boolean(value && value.trim() && !value.includes("your_supabase"));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
}

function detectPlatform() {
  const agent = navigator.userAgent.toLowerCase();

  if (agent.includes("windows")) return "windows";
  if (agent.includes("mac")) return "macos";
  if (agent.includes("linux")) return "linux";

  return navigator.platform || "unknown";
}

function detectKind(content: string): ClipKind {
  if (content.includes("```")) return "code";
  if (/\n\s{2,}\S/.test(content)) return "code";
  if (/\t\S/.test(content)) return "code";
  if (/\b(function|const|let|class|import|export|def|return|SELECT|INSERT|UPDATE)\b/.test(content)) return "code";
  if (content.split("\n").length >= 4) return "code";
  return "text";
}

async function sha256(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function createDefaultState(): PersistedState {
  return {
    deviceId: crypto.randomUUID(),
    pendingQueue: [],
    recentUploads: [],
    ignoredHashes: [],
    settings: {
      monitorClipboard: true,
      autostartEnabled: true,
      floatingBallEnabled: true,
      lastSeenTimestamp: null,
    },
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the user-facing fallback below.
    }
  }

  return fallback;
}

function attachmentName(attachment: PendingComposerAttachment) {
  return attachment.kind === "browser" ? attachment.file.name : attachment.name;
}

function attachmentSize(attachment: PendingComposerAttachment) {
  return attachment.kind === "browser" ? attachment.file.size : attachment.size;
}

function attachmentType(attachment: PendingComposerAttachment) {
  if (attachment.kind === "browser") return attachment.file.type || "application/octet-stream";
  return attachment.type || "application/octet-stream";
}

function clipboardFilesFromDataTransfer(data: DataTransfer) {
  const candidates = [
    ...Array.from(data.files),
    ...Array.from(data.items).flatMap((item) => {
      if (item.kind !== "file") return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    }),
  ];
  const unique = new Map<string, File>();
  for (const file of candidates) {
    unique.set(`${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`, file);
  }
  return Array.from(unique.values());
}

function queueComposerBrowserFiles(files: File[]) {
  if (files.length === 0) return false;
  const oversized = files.find((file) => file.size > MAX_FILE_SIZE);
  if (oversized) {
    setStatus("warning", `“${oversized.name}”超过 500MB 上限。`);
    return false;
  }
  const existing = new Set(
    pendingComposerAttachments.map((attachment) =>
      `${attachmentName(attachment)}\u0000${attachmentSize(attachment)}`,
    ),
  );
  for (const file of files) {
    const key = `${file.name}\u0000${file.size}`;
    if (!existing.has(key)) {
      pendingComposerAttachments.push({ kind: "browser", file });
      existing.add(key);
    }
  }
  setStatus("neutral", files.length === 1 ? `已加入附件：${files[0].name}` : `已加入 ${files.length} 个附件。`);
  return true;
}

function insertPastedText(target: HTMLTextAreaElement, text: string) {
  if (!text) return;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  messageDraft = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  target.value = messageDraft;
  const caret = start + text.length;
  target.setSelectionRange(caret, caret);
  if (!target.isConnected) render();
}

async function queueNativeClipboardFiles(fallbackText: string, target: HTMLTextAreaElement) {
  try {
    const descriptors = await invoke<NativeFileDescriptor[]>("clipboard_file_descriptors");
    if (descriptors.length === 0) {
      insertPastedText(target, fallbackText);
      return;
    }
    await queueNativeDescriptors(descriptors, "剪贴板");
  } catch (error) {
    insertPastedText(target, fallbackText);
    setStatus("danger", getErrorMessage(error, "读取剪贴板中的图片或文件失败。"));
  }
}

async function queueNativeDescriptors(descriptors: NativeFileDescriptor[], source: "剪贴板" | "拖放") {
  const oversized = descriptors.find((file) => file.size > MAX_FILE_SIZE);
  if (oversized) {
    await Promise.allSettled(descriptors.map((file) => invoke("release_clipboard_file", { id: file.id })));
    setStatus("warning", `“${oversized.name}”超过 500MB 上限。`);
    return;
  }

  const existing = new Set(
    pendingComposerAttachments.map((attachment) =>
      `${attachmentName(attachment)}\u0000${attachmentSize(attachment)}`,
    ),
  );
  let added = 0;
  for (const descriptor of descriptors) {
    const key = `${descriptor.name}\u0000${descriptor.size}`;
    if (existing.has(key)) {
      await invoke("release_clipboard_file", { id: descriptor.id });
      continue;
    }
    pendingComposerAttachments.push({
      kind: "native",
      id: descriptor.id,
      name: descriptor.name,
      size: descriptor.size,
      type: descriptor.fileType || "application/octet-stream",
      lastModified: descriptor.lastModified,
    });
    existing.add(key);
    added += 1;
  }

  if (added > 0) {
    const prefix = source === "拖放" ? "已拖入" : "已从剪贴板加入";
    setStatus("neutral", added === 1 ? `${prefix}附件：${descriptors[0].name}` : `${prefix} ${added} 个附件。`);
  } else {
    render();
  }
}

async function queueDroppedPaths(paths: string[]) {
  try {
    const descriptors = await invoke<NativeFileDescriptor[]>("dropped_file_descriptors", { paths });
    if (descriptors.length === 0) {
      setStatus("warning", "没有检测到可发送的文件。请从文件夹中拖入一个或多个文件。");
      return;
    }
    await queueNativeDescriptors(descriptors, "拖放");
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "读取拖入的文件失败。"));
  }
}

function mapAttachmentRecord(row: Record<string, unknown>): AttachmentRecord {
  return {
    id: String(row.id),
    storagePath: typeof row.storage_path === "string" ? row.storage_path : "",
    fileName: typeof row.file_name === "string" ? row.file_name : "未命名文件",
    fileType: typeof row.file_type === "string" ? row.file_type : "application/octet-stream",
    fileSize: typeof row.file_size === "number" ? row.file_size : Number(row.file_size) || 0,
    uploadStatus: typeof row.upload_status === "string" ? row.upload_status : "ready",
    signedUrl: null,
  };
}

function mapClipRecord(row: Record<string, unknown>): ClipRecord {
  const attachmentRows = Array.isArray(row.attachments)
    ? row.attachments.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
  return {
    id: String(row.id),
    content: typeof row.content === "string" ? row.content : "",
    kind: detectKind(typeof row.content === "string" ? row.content : ""),
    contentHash: "",
    sourceDeviceId: typeof row.source_device_id === "string" ? row.source_device_id : "",
    sourcePlatform: typeof row.source_platform === "string" ? row.source_platform : "",
    isPinned: Boolean(row.is_starred),
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    attachments: attachmentRows.map(mapAttachmentRecord),
  };
}

let supabase: SupabaseClient | null = null;
let currentSession: Session | null = null;
let trayIcon: TrayIcon | null = null;
let store: Awaited<ReturnType<typeof load>> | null = null;
let persistedState = createDefaultState();
let statusBanner: BannerState = { tone: "neutral", message: "桌面端启动中…" };
let pinnedClips: ClipRecord[] = [];
let recentClips: ClipRecord[] = [];
const busyActionIds = new Set<string>();
let authDraft = { email: "", password: "" };
let messageDraft = "";
let messageSending = false;
let pendingComposerAttachments: PendingComposerAttachment[] = [];
let clipboardTimer: number | null = null;
let lastObservedClipboard = "";
let notificationGranted = false;
let knownClipIds = new Set<string>();
let isQuitting = false;
let realtimeChannel: { unsubscribe: () => Promise<unknown> } | null = null;
let registeredDeviceId: string | null = null;
let pendingClipboard: PendingClip | null = null;
let pendingClipboardTimer: number | null = null;
let settingsOpen = false;
let dragActive = false;
let browserDragDepth = 0;
let compactMode = false;
let idleCollapseTimer: number | null = null;
let stickConversationToBottom = true;
let animateWindowEntry = false;
let animateOrbEntry = false;

function setStatus(tone: BannerTone, message: string) {
  statusBanner = { tone, message };
  void syncTrayTooltip();
  render();
}

function setDragActive(next: boolean) {
  if (dragActive === next) return;
  dragActive = next;
  root.querySelector(".chat-shell")?.classList.toggle("is-dragging", next);
  const composer = root.querySelector<HTMLElement>(".message-composer");
  if (!composer) return;
  const currentOverlay = composer.querySelector(".drop-overlay");
  if (!next) {
    currentOverlay?.remove();
    return;
  }
  if (!currentOverlay) {
    composer.insertAdjacentHTML("afterbegin", `<div class="drop-overlay"><i class="ph ph-download-simple"></i><strong>松开即可加入发送</strong><span>支持多个文件，单个最大 500MB</span></div>`);
  }
}

async function saveState() {
  if (!store) return;

  await store.set(STORE_KEY, persistedState);
  await store.save();
}

function cleanupTimedHashes() {
  const now = Date.now();
  persistedState.recentUploads = persistedState.recentUploads.filter((item) => item.expiresAt > now).slice(-40);
  persistedState.ignoredHashes = persistedState.ignoredHashes.filter((item) => item.expiresAt > now).slice(-40);
}

function hasTimedHash(collection: TimedHash[], hash: string) {
  cleanupTimedHashes();
  return collection.some((item) => item.hash === hash);
}

function upsertTimedHash(collection: TimedHash[], hash: string, ttlMs: number) {
  const expiresAt = Date.now() + ttlMs;
  const next = collection.filter((item) => item.hash !== hash);
  next.push({ hash, expiresAt });
  return next;
}

function renderClipCard(clip: ClipRecord) {
  const hasContent = Boolean(clip.content.trim());
  const isMine = Boolean(registeredDeviceId && clip.sourceDeviceId === registeredDeviceId);
  const contentHtml = hasContent
    ? clip.kind === "code"
      ? `<pre class="clip-code">${escapeHtml(clip.content)}</pre>`
      : `<p class="clip-text">${escapeHtml(clip.content)}</p>`
    : "";
  const attachmentHtml = clip.attachments.length > 0
    ? `<div class="attachment-grid">${clip.attachments.map((attachment) => {
        const isImage = attachment.fileType.startsWith("image/");
        const ready = Boolean(attachment.signedUrl);
        return `
          <button class="attachment-card${isImage ? " image" : ""}" data-action="open-attachment" data-attachment-id="${escapeHtml(attachment.id)}" ${ready ? "" : "disabled"}>
            ${isImage && ready ? `<img src="${escapeHtml(attachment.signedUrl!)}" alt="${escapeHtml(attachment.fileName)}" loading="lazy" />` : `<span class="file-mark">${escapeHtml(attachment.fileName.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE")}</span>`}
            <span class="attachment-copy">
              <strong>${escapeHtml(attachment.fileName)}</strong>
              <small>${escapeHtml(formatFileSize(attachment.fileSize))}${ready ? "，点击打开" : "，正在准备"}</small>
            </span>
          </button>
        `;
      }).join("")}</div>`
    : "";
  const clipBusy = busyActionIds.has(clip.id);

  return `
    <article class="message-row${isMine ? " is-mine" : ""}">
      ${isMine ? "" : `<div class="message-avatar">${escapeHtml((clip.sourcePlatform || "E").slice(0, 1).toUpperCase())}</div>`}
      <div class="message-stack">
        <div class="clip-meta">
          <span>${escapeHtml(clip.sourcePlatform || "设备")}</span>
          <span>${escapeHtml(formatTimestamp(clip.createdAt))}</span>
          ${clip.isPinned ? `<i class="ph ph-star" aria-label="已收藏"></i>` : ""}
        </div>
        <div class="clip-card">
          ${contentHtml ? `<div class="clip-body">${contentHtml}</div>` : ""}
          ${attachmentHtml}
        </div>
        <div class="clip-actions">
          ${hasContent ? `<button class="message-action" data-tooltip="复制" aria-label="复制" data-action="copy-clip" data-id="${clip.id}" ${clipBusy ? "disabled" : ""}><i class="ph ph-copy"></i></button>` : ""}
          <button class="message-action" data-tooltip="${clip.isPinned ? "取消收藏" : "收藏"}" aria-label="${clip.isPinned ? "取消收藏" : "收藏"}" data-action="${clip.isPinned ? "unpin-clip" : "pin-clip"}" data-id="${clip.id}" ${clipBusy ? "disabled" : ""}><i class="ph ph-star"></i></button>
          <button class="message-action danger" data-tooltip="删除" aria-label="删除" data-action="delete-clip" data-id="${clip.id}" ${clipBusy ? "disabled" : ""}><i class="ph ph-trash"></i></button>
        </div>
      </div>
    </article>
  `;
}

function renderClipList(items: ClipRecord[], emptyText: string) {
  if (items.length === 0) {
    return `<div class="empty-card">${escapeHtml(emptyText)}</div>`;
  }

  return `<div class="message-list">${items.map((item) => renderClipCard(item)).join("")}</div>`;
}

function renderLoginView() {
  return `
    <main class="login-shell">
      <section class="login-card">
        <div class="login-heading">
          <div class="brand-mark">E</div>
          <div><h1>登录 Echo</h1><p>连接手机、Windows 和 Mac</p></div>
        </div>
        <form id="login-form" class="login-form">
          <label for="email">邮箱</label>
          <input id="email" name="email" type="email" value="${escapeHtml(authDraft.email)}" autocomplete="email" required />
          <label for="password">密码</label>
          <input id="password" name="password" type="password" value="${escapeHtml(authDraft.password)}" autocomplete="current-password" required />
          <button class="login-button" type="submit">登录</button>
        </form>
        <p class="login-status ${statusBanner.tone}">${escapeHtml(statusBanner.message)}</p>
      </section>
    </main>
  `;
}

function renderOrbView() {
  const stateLabel = statusBanner.tone === "danger"
    ? "需要处理"
    : persistedState.pendingQueue.length > 0
      ? `${persistedState.pendingQueue.length} 条待发送`
      : "双击打开 Echo";
  return `
    <main class="orb-shell" data-tauri-drag-region>
      <button class="echo-orb ${statusBanner.tone}${animateOrbEntry ? " enter" : ""}" type="button" data-action="expand-window" aria-label="${escapeHtml(stateLabel)}" data-tooltip="${escapeHtml(stateLabel)}" data-tauri-drag-region>
        <span class="assistive-symbol" aria-hidden="true"><i></i></span>
        ${statusBanner.tone === "danger" || persistedState.pendingQueue.length > 0 ? `<i class="orb-alert"></i>` : ""}
      </button>
    </main>
  `;
}

function renderSettingsPanel() {
  if (!settingsOpen) return "";
  return `
    <aside class="settings-popover" aria-label="Echo 设置">
      <div class="settings-account">
        <strong>${escapeHtml(currentSession?.user.email ?? "未登录")}</strong>
        <small>${escapeHtml(detectPlatform())} 桌面端</small>
      </div>
      <button class="menu-action" data-action="send-current-clipboard"><i class="ph ph-clipboard-text"></i><span>发送当前剪切板</span></button>
      <button class="menu-action" data-action="flush-queue"><i class="ph ph-arrow-clockwise"></i><span>重试离线队列</span><small>${persistedState.pendingQueue.length}</small></button>
      <label class="menu-toggle">
        <span><i class="ph ph-eye"></i>监听剪切板</span>
        <input id="monitor-toggle" type="checkbox" ${persistedState.settings.monitorClipboard ? "checked" : ""} />
      </label>
      <label class="menu-toggle">
        <span><i class="ph ph-circle-dashed"></i>悬浮球模式</span>
        <input id="floating-ball-toggle" type="checkbox" ${persistedState.settings.floatingBallEnabled ? "checked" : ""} />
      </label>
      <label class="menu-toggle">
        <span><i class="ph ph-power"></i>开机自启</span>
        <input id="autostart-toggle" type="checkbox" ${persistedState.settings.autostartEnabled ? "checked" : ""} />
      </label>
      <button class="menu-action danger" data-action="sign-out"><i class="ph ph-sign-out"></i><span>退出当前账号</span></button>
    </aside>
  `;
}

function renderAppView() {
  const pendingAttachmentsHtml = pendingComposerAttachments.length > 0
    ? `<div class="pending-attachments" aria-label="待发送附件">${pendingComposerAttachments.map((attachment, index) => `
        <div class="pending-attachment">
          <span class="pending-file-mark">${escapeHtml(attachmentName(attachment).split(".").pop()?.slice(0, 4).toUpperCase() || "FILE")}</span>
          <span class="pending-file-copy">
            <strong>${escapeHtml(attachmentName(attachment))}</strong>
            <small>${escapeHtml(formatFileSize(attachmentSize(attachment)))}</small>
          </span>
          <button class="remove-attachment" type="button" data-action="remove-pending-attachment" data-index="${index}" aria-label="移除 ${escapeHtml(attachmentName(attachment))}" data-tooltip="移除"><i class="ph ph-x"></i></button>
        </div>
      `).join("")}</div>`
    : "";
  const conversation = [...pinnedClips, ...recentClips]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const statusLabel = statusBanner.tone === "success"
    ? "已同步"
    : statusBanner.tone === "warning"
      ? "等待处理"
      : statusBanner.tone === "danger"
        ? "同步异常"
        : "在线";

  return `
    <main class="chat-shell${dragActive ? " is-dragging" : ""}${animateWindowEntry ? " enter" : ""}">
      <header class="chat-header" data-tauri-drag-region>
        <div class="chat-identity" data-tauri-drag-region>
          <div class="brand-mark">E</div>
          <div>
            <h1>文件传输助手</h1>
            <p><i class="connection-dot ${statusBanner.tone}"></i>${escapeHtml(statusLabel)}</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="icon-button" type="button" data-action="refresh-clips" aria-label="刷新" data-tooltip="刷新"><i class="ph ph-arrow-clockwise"></i></button>
          <button class="icon-button" type="button" data-action="toggle-settings" aria-label="设置" data-tooltip="设置"><i class="ph ph-dots-three"></i></button>
          <button class="icon-button" type="button" data-action="collapse-window" aria-label="收起为悬浮球" data-tooltip="收起"><i class="ph ph-minus"></i></button>
        </div>
        ${renderSettingsPanel()}
      </header>

      <section class="conversation" aria-label="消息记录">
        ${pendingClipboard ? `
          <div class="clipboard-confirm">
            <div><strong>发送刚复制的内容？</strong><p>${escapeHtml(pendingClipboard.content.slice(0, 120))}</p></div>
            <div><button class="button" data-action="confirm-clipboard">发送</button><button class="button-secondary" data-action="ignore-clipboard">忽略</button></div>
          </div>
        ` : ""}
        ${renderClipList(conversation, "把文字、图片或文件拖到下方发送区，Echo 会同步到你的所有设备。")}
      </section>

      <footer class="composer-dock">
        <div class="compact-status ${statusBanner.tone}">${escapeHtml(statusBanner.message)}</div>
        <form id="message-form" class="message-composer">
          ${dragActive ? `<div class="drop-overlay"><i class="ph ph-download-simple"></i><strong>松开即可加入发送</strong><span>支持多个文件，单个最大 500MB</span></div>` : ""}
          ${pendingAttachmentsHtml}
          <label class="sr-only" for="message-input">消息内容</label>
          <textarea id="message-input" name="message" rows="2" placeholder="输入消息，粘贴或拖入文件">${escapeHtml(messageDraft)}</textarea>
          <div class="composer-actions">
            <div class="composer-tools">
              <button class="icon-button" type="button" data-action="choose-files" aria-label="选择文件" data-tooltip="选择文件"><i class="ph ph-paperclip"></i></button>
              <button class="icon-button" type="button" data-action="send-current-clipboard" aria-label="发送当前剪切板" data-tooltip="发送剪切板"><i class="ph ph-scissors"></i></button>
            </div>
            <button class="send-button" type="submit" ${messageSending || (!messageDraft.trim() && pendingComposerAttachments.length === 0) ? "disabled" : ""} aria-label="发送" data-tooltip="发送">
              <i class="ph ${messageSending ? "ph-circle-notch" : "ph-paper-plane-tilt"}"></i>
            </button>
          </div>
        </form>
        <input id="desktop-file-input" type="file" multiple hidden />
      </footer>
    </main>
  `;
}

function render() {
  root.innerHTML = isOrbWindow || compactMode ? renderOrbView() : currentSession ? renderAppView() : renderLoginView();
  if (!isOrbWindow && !compactMode && currentSession && stickConversationToBottom) {
    window.requestAnimationFrame(() => {
      const conversation = root.querySelector<HTMLElement>(".conversation");
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
    });
  }
}

async function syncTrayTooltip() {
  if (!trayIcon) return;

  const prefix = currentSession ? "Echo 已登录" : "Echo 未登录";
  await trayIcon.setTooltip(`${prefix} · ${statusBanner.message}`);
}

async function saveAndRender() {
  cleanupTimedHashes();
  await saveState();
  render();
}

async function ensureStore() {
  store = await load(STORE_PATH, { autoSave: false, defaults: {} });
  const saved = await store.get<PersistedState>(STORE_KEY);
  if (saved) {
    persistedState = {
      ...createDefaultState(),
      ...saved,
      settings: {
        ...createDefaultState().settings,
        ...(saved.settings ?? {}),
      },
    };
  }

  cleanupTimedHashes();
  await saveState();
}

async function syncAutostartPreference() {
  const enabled = await isEnabled();

  if (persistedState.settings.autostartEnabled && !enabled) {
    await enable();
  } else if (!persistedState.settings.autostartEnabled && enabled) {
    await disable();
  }
}

async function ensureNotificationPermission() {
  notificationGranted = await isPermissionGranted();
  if (!notificationGranted) {
    const permission = await requestPermission();
    notificationGranted = permission === "granted";
  }
}

async function notifyNewClip(clip: ClipRecord) {
  if (!notificationGranted) {
    return;
  }

  sendNotification({
    title: "Echo",
    body: clip.kind === "code" ? "收到一段新的代码片段，点击面板即可复制。" : "收到一条新的文本片段，点击面板即可复制。",
  });
}

function clearIdleCollapseTimer() {
  if (idleCollapseTimer) {
    window.clearTimeout(idleCollapseTimer);
    idleCollapseTimer = null;
  }
}

function scheduleIdleCollapse() {
  clearIdleCollapseTimer();
  if (!currentSession || compactMode || !persistedState.settings.floatingBallEnabled) return;
  idleCollapseTimer = window.setTimeout(() => {
    if (messageSending) {
      scheduleIdleCollapse();
      return;
    }
    void collapseToOrb();
  }, 2 * 60 * 1000);
}

async function collapseToOrb() {
  if (isOrbWindow) return;

  settingsOpen = false;
  clearIdleCollapseTimer();

  const windowRef = currentWindow;

  if (!persistedState.settings.floatingBallEnabled) {
    await windowRef.hide();
    return;
  }

  compactMode = true;
  dragActive = false;
  await invoke("collapse_to_orb");
}

async function expandFromOrb() {
  if (isOrbWindow) {
    await invoke("expand_main_window");
    return;
  }

  compactMode = false;
  animateWindowEntry = true;
  render();
  animateWindowEntry = false;
  await invoke("expand_main_window");
  scheduleIdleCollapse();
}

async function setupWindowChrome() {
  const windowRef = currentWindow;

  await windowRef.listen("echo-main-shown", () => {
    compactMode = false;
    animateWindowEntry = true;
    render();
    animateWindowEntry = false;
    scheduleIdleCollapse();
  });

  await windowRef.onCloseRequested(async (event: CloseRequestedEvent) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    await collapseToOrb();
  });
}

async function toggleWindow() {
  const windowRef = getCurrentWindow();
  const visible = await windowRef.isVisible();

  if (visible) {
    if (compactMode) await expandFromOrb();
    else await collapseToOrb();
  } else {
    await expandFromOrb();
  }
}

async function setupFileDrop() {
  await getCurrentWebview().onDragDropEvent((event) => {
    if (!currentSession || compactMode) return;
    if (event.payload.type === "enter" || event.payload.type === "over") {
      setDragActive(true);
      scheduleIdleCollapse();
      return;
    }
    if (event.payload.type === "drop") {
      setDragActive(false);
      scheduleIdleCollapse();
      void queueDroppedPaths(event.payload.paths);
      return;
    }
    if (dragActive) {
      setDragActive(false);
    }
  });
}

async function quitApplication() {
  isQuitting = true;
  await getCurrentWindow().close();
}

async function setupTray() {
  const menu = await Menu.new({
    items: [
      {
        id: "toggle",
        text: "展开 / 收起悬浮球",
        action: () => {
          void toggleWindow();
        },
      },
      {
        id: "sync",
        text: "发送当前剪切板",
        action: () => {
          void sendCurrentClipboard();
        },
      },
      {
        id: "quit",
        text: "退出",
        action: () => {
          void quitApplication();
        },
      },
    ],
  });

  let icon;
  try {
    icon = (await defaultWindowIcon()) ?? undefined;
  } catch {
    icon = undefined;
  }

  trayIcon = await TrayIcon.new({
    id: "echo-tray",
    menu,
    icon,
    tooltip: "Echo",
    iconAsTemplate: true,
    menuOnLeftClick: false,
    action: (event: TrayIconEvent) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
        void toggleWindow();
      }
    },
  });

  await syncTrayTooltip();
}

async function fetchClipBuckets() {
  const client = supabase;
  const session = currentSession;

  if (!client || !session) {
    return { pinned: [] as ClipRecord[], recent: [] as ClipRecord[] };
  }

  const buildQuery = () =>
    client
      .from("notes")
      .select("id, content, source_device_id, source_platform, is_starred, created_at, attachments(id, storage_path, file_name, file_type, file_size, upload_status)")
      .eq("user_id", session.user.id)
      .is("deleted_at", null);

  const [pinnedResult, recentResult] = await Promise.all([
    buildQuery().eq("is_starred", true).order("created_at", { ascending: false }),
    buildQuery().eq("is_starred", false).eq("is_archived", false).order("created_at", { ascending: false }).limit(RECENT_LIMIT),
  ]);

  if (pinnedResult.error) {
    throw pinnedResult.error;
  }

  if (recentResult.error) {
    throw recentResult.error;
  }

  const buckets = {
    pinned: (pinnedResult.data ?? []).map(mapClipRecord),
    recent: (recentResult.data ?? []).map(mapClipRecord),
  };

  const allClips = [...buckets.pinned, ...buckets.recent];
  const paths = [...new Set(allClips.flatMap((clip) => clip.attachments.map((item) => item.storagePath)).filter(Boolean))];
  if (paths.length > 0) {
    const { data, error } = await client.storage.from("echo-files").createSignedUrls(paths, 60 * 60);
    if (!error && data) {
      const urls = new Map(data.filter((item) => item.path && item.signedUrl).map((item) => [item.path!, item.signedUrl!]));
      for (const clip of allClips) {
        for (const attachment of clip.attachments) {
          attachment.signedUrl = urls.get(attachment.storagePath) ?? null;
        }
      }
    }
  }

  return buckets;
}

async function refreshClips(silent = false) {
  if (!currentSession) {
    pinnedClips = [];
    recentClips = [];
    knownClipIds = new Set();
    render();
    return;
  }

  try {
    const next = await fetchClipBuckets();
    pinnedClips = next.pinned;
    recentClips = next.recent;
    knownClipIds = new Set([...pinnedClips, ...recentClips].map((clip) => clip.id));
    persistedState.settings.lastSeenTimestamp = [pinnedClips[0], recentClips[0]]
      .map((clip) => clip?.createdAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? persistedState.settings.lastSeenTimestamp;
    await saveState();
    if (!silent) {
      setStatus("success", "Echo 已刷新完成。");
    } else {
      render();
    }
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "Echo 刷新失败。"));
  }
}

async function subscribeToRealtime() {
  if (!supabase || !currentSession) {
    return;
  }

  if (realtimeChannel) {
    await realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel(`echo-${currentSession.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notes",
        filter: `user_id=eq.${currentSession.user.id}`,
      },
      (payload: { eventType?: string; new?: Record<string, unknown> }) => {
        const nextRow = payload.new;
        if (
          payload.eventType === "INSERT" &&
          nextRow &&
          typeof nextRow.id === "string" &&
          !knownClipIds.has(nextRow.id) &&
          nextRow.source_device_id !== registeredDeviceId
        ) {
          void notifyNewClip(mapClipRecord(nextRow));
        }

        void refreshClips(true);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "attachments",
        filter: `user_id=eq.${currentSession.user.id}`,
      },
      () => {
        void refreshClips(true);
      },
    )
    .subscribe();
}

async function signOutLocal() {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    throw error;
  }
}

async function initializeSession() {
  if (!supabase) return;

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  currentSession = data.session;
}

async function handleSignedIn() {
  if (supabase && currentSession) {
    const { data, error } = await supabase.from("devices").upsert({
      user_id: currentSession.user.id,
      client_id: persistedState.deviceId,
      name: `${detectPlatform()} 桌面端`,
      platform: detectPlatform(),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "user_id,client_id" }).select("id").single();
    if (error) throw error;
    registeredDeviceId = data.id;
    await supabase.rpc("bootstrap_echo_user");
  }
  await refreshClips(true);
  await subscribeToRealtime();
  await flushPendingQueue();
  setStatus("success", "桌面端已接入你的 Echo 数据流。");
  scheduleIdleCollapse();
}

async function setupAuth() {
  if (!supabase) return;

  await initializeSession();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;

    if (!session) {
      pinnedClips = [];
      recentClips = [];
      knownClipIds = new Set();
      setStatus("neutral", "当前设备已退出登录。");
      render();
      return;
    }

    void handleSignedIn();
  });

  void subscription;

  if (currentSession) {
    await handleSignedIn();
  } else {
    setStatus("neutral", "请先登录同一个个人账号。");
  }
}

function startClipboardWatcher() {
  if (clipboardTimer) {
    window.clearInterval(clipboardTimer);
  }

  clipboardTimer = window.setInterval(() => {
    void pollClipboard();
  }, CLIPBOARD_POLL_MS);
}

async function readClipboardSafely() {
  try {
    return await readText();
  } catch {
    return "";
  }
}

async function pollClipboard() {
  if (!currentSession || !persistedState.settings.monitorClipboard) {
    return;
  }

  const nextText = await readClipboardSafely();
  if (nextText === lastObservedClipboard) {
    return;
  }

  lastObservedClipboard = nextText;
  await proposeClipboardContent(nextText);
}

async function proposeClipboardContent(content: string) {
  if (!content.trim()) return;
  const byteLength = new TextEncoder().encode(content).length;
  if (byteLength > MAX_SYNC_BYTES) return setStatus("warning", "剪切板内容超过 200 KB，未进入发送确认。");
  const hash = await sha256(content);
  if (hasTimedHash(persistedState.ignoredHashes, hash) || hasTimedHash(persistedState.recentUploads, hash)) return;
  pendingClipboard = { content, kind: detectKind(content), hash, createdAt: new Date().toISOString() };
  if (pendingClipboardTimer) window.clearTimeout(pendingClipboardTimer);
  pendingClipboardTimer = window.setTimeout(() => {
    if (pendingClipboard) void markIgnoredHash(pendingClipboard.hash);
    pendingClipboard = null;
    render();
  }, 8000);
  if (notificationGranted) sendNotification({ title: "Echo", body: "检测到新的剪切板内容，打开 Echo 确认是否发送。" });
  setStatus("warning", "检测到新的剪切板内容，8 秒内确认后才会发送。");
}

async function queueClip(clip: PendingClip) {
  if (persistedState.pendingQueue.some((item) => item.hash === clip.hash && item.content === clip.content)) {
    return;
  }

  persistedState.pendingQueue.push(clip);
  await saveAndRender();
}

async function sendClip(clip: PendingClip, queueOnFailure: boolean) {
  if (!supabase || !currentSession) {
    if (queueOnFailure) {
      await queueClip(clip);
    }
    return false;
  }

  try {
    const { error } = await supabase.from("notes").insert([
      {
        user_id: currentSession.user.id,
        content: clip.content,
        source_device_id: registeredDeviceId,
        source_platform: detectPlatform(),
      },
    ]);

    if (error) {
      throw error;
    }

    persistedState.recentUploads = upsertTimedHash(persistedState.recentUploads, clip.hash, DEDUPE_WINDOW_MS);
    await saveState();
    setStatus("success", clip.kind === "code" ? "代码片段已同步到云端。" : "文本片段已同步到云端。");
    return true;
  } catch (error) {
    if (queueOnFailure) {
      await queueClip(clip);
      setStatus("warning", `${getErrorMessage(error, "同步失败。")} 已放入离线队列。`);
    }
    return false;
  }
}

async function processClipboardContent(content: string, manual: boolean) {
  if (!currentSession) {
    setStatus("warning", "还没登录，当前内容不会同步。");
    return;
  }

  if (!content.trim()) {
    if (manual) {
      setStatus("warning", "当前剪切板为空白内容，没有发送。");
    }
    return;
  }

  const byteLength = new TextEncoder().encode(content).length;
  if (byteLength > MAX_SYNC_BYTES) {
    setStatus("warning", "这段内容超过 200 KB，已按规则跳过同步。");
    return;
  }

  const hash = await sha256(content);
  cleanupTimedHashes();

  if (hasTimedHash(persistedState.ignoredHashes, hash)) {
    return;
  }

  if (!manual && hasTimedHash(persistedState.recentUploads, hash)) {
    return;
  }

  const clip: PendingClip = {
    content,
    kind: detectKind(content),
    hash,
    createdAt: new Date().toISOString(),
  };

  await sendClip(clip, true);
}

async function sendCurrentClipboard() {
  const clipboard = await readClipboardSafely();
  await processClipboardContent(clipboard, true);
}

async function sendTypedMessage(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    setStatus("warning", "请输入要发送的消息。");
    return;
  }

  if (new TextEncoder().encode(normalized).length > MAX_SYNC_BYTES) {
    setStatus("warning", "这段消息超过 200 KB，请改用文件发送。");
    return;
  }

  messageSending = true;
  render();
  try {
    const clip: PendingClip = {
      content: normalized,
      kind: detectKind(normalized),
      hash: await sha256(normalized),
      createdAt: new Date().toISOString(),
    };
    await sendClip(clip, true);
    messageDraft = "";
  } finally {
    messageSending = false;
    render();
  }
}

function uploadDesktopFile(file: File, objectName: string) {
  return new Promise<void>((resolve, reject) => {
    if (!currentSession || !supabaseUrl) return reject(new Error("当前设备未登录"));
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${currentSession.access_token}`, "x-upsert": "false" },
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: "echo-files", objectName, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
      onProgress: (sent, total) => setStatus("neutral", `正在上传 ${file.name} · ${total ? Math.round(sent / total * 100) : 0}%`),
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}

const nativeClipboardFileReader = {
  async openFile(input: NativeClipboardFile) {
    return {
      size: input.size,
      async slice(start: number, end: number) {
        const raw = await invoke<ArrayBuffer | Uint8Array | number[]>("read_clipboard_file_chunk", {
          id: input.id,
          start,
          end,
        });
        const bytes = raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : raw instanceof Uint8Array
            ? raw
            : Uint8Array.from(raw);
        const payload = new Uint8Array(bytes.byteLength);
        payload.set(bytes);
        return { value: new Blob([payload.buffer]), done: end >= input.size };
      },
      close() {},
    };
  },
};

function uploadNativeClipboardFile(file: NativeClipboardFile, objectName: string) {
  return new Promise<void>((resolve, reject) => {
    if (!currentSession || !supabaseUrl) return reject(new Error("当前设备未登录"));
    const upload = new tus.Upload(file as unknown as File, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${currentSession.access_token}`, "x-upsert": "false" },
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fileReader: nativeClipboardFileReader,
      metadata: { bucketName: "echo-files", objectName, contentType: file.type, cacheControl: "3600" },
      onProgress: (sent, total) => setStatus("neutral", `正在上传 ${file.name} · ${total ? Math.round(sent / total * 100) : 0}%`),
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}

async function sendComposerMessage(content: string) {
  const normalized = content.trim();
  if (pendingComposerAttachments.length === 0) {
    await sendTypedMessage(normalized);
    return;
  }
  if (!supabase || !currentSession || messageSending) return;
  if (new TextEncoder().encode(normalized).length > MAX_SYNC_BYTES) {
    setStatus("warning", "这段消息超过 200 KB，请改用文件发送。");
    return;
  }
  const oversized = pendingComposerAttachments.find((file) => attachmentSize(file) > MAX_FILE_SIZE);
  if (oversized) return setStatus("warning", `“${attachmentName(oversized)}”超过 500MB 上限。`);
  messageSending = true;
  render();
  try {
    const attachments = [...pendingComposerAttachments];
    const { data: note, error } = await supabase.from("notes").insert({ user_id: currentSession.user.id, content: normalized, source_device_id: registeredDeviceId, source_platform: detectPlatform() }).select("id").single();
    if (error) throw error;
    for (const file of attachments) {
      const name = attachmentName(file);
      const suffix = name.includes(".") ? `.${name.split(".").pop()}` : "";
      const objectName = `${currentSession.user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${suffix}`;
      if (file.kind === "browser") await uploadDesktopFile(file.file, objectName);
      else await uploadNativeClipboardFile(file, objectName);
      const { error: attachmentError } = await supabase.from("attachments").insert({ user_id: currentSession.user.id, note_id: note.id, storage_path: objectName, file_name: name, file_type: attachmentType(file), file_size: attachmentSize(file), upload_status: "ready" });
      if (attachmentError) throw attachmentError;
    }
    messageDraft = "";
    pendingComposerAttachments = [];
    stickConversationToBottom = true;
    await Promise.allSettled(attachments.filter((file): file is NativeClipboardFile => file.kind === "native").map((file) => invoke("release_clipboard_file", { id: file.id })));
    setStatus("success", `${attachments.length} 个附件已发送到 Echo。`);
    await refreshClips(true);
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "消息或附件发送失败。"));
  } finally {
    messageSending = false;
    render();
  }
}

async function flushPendingQueue() {
  if (!currentSession || persistedState.pendingQueue.length === 0) {
    return;
  }

  const remaining: PendingClip[] = [];

  for (const item of persistedState.pendingQueue) {
    const sent = await sendClip(item, false);
    if (!sent) {
      remaining.push(item);
    }
  }

  persistedState.pendingQueue = remaining;
  await saveAndRender();

  if (remaining.length === 0) {
    setStatus("success", "离线队列已全部补发完成。");
  } else {
    setStatus("warning", `还有 ${remaining.length} 条离线内容等待网络恢复。`);
  }
}

function getClipById(clipId: string) {
  return [...pinnedClips, ...recentClips].find((clip) => clip.id === clipId) ?? null;
}

function getAttachmentById(attachmentId: string) {
  return [...pinnedClips, ...recentClips]
    .flatMap((clip) => clip.attachments)
    .find((attachment) => attachment.id === attachmentId) ?? null;
}

async function openAttachment(attachmentId: string) {
  const attachment = getAttachmentById(attachmentId);
  if (!attachment?.signedUrl) {
    setStatus("warning", "附件预览地址还没准备好，请刷新后重试。");
    return;
  }

  try {
    await openUrl(attachment.signedUrl);
    setStatus("success", `已用系统默认程序打开“${attachment.fileName}”。`);
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "打开附件失败。"));
  }
}

async function markIgnoredHash(hash: string) {
  persistedState.ignoredHashes = upsertTimedHash(persistedState.ignoredHashes, hash, IGNORE_WINDOW_MS);
  lastObservedClipboard = "";
  await saveState();
}

async function copyClipToLocalClipboard(clipId: string) {
  const clip = getClipById(clipId);
  if (!clip) {
    setStatus("danger", "找不到要复制的那条消息。");
    return;
  }

  busyActionIds.add(clipId);
  render();

  try {
    await writeText(clip.content);
    await markIgnoredHash(clip.contentHash);
    lastObservedClipboard = clip.content;
    setStatus("success", "内容已写回本机剪切板。");
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "写入本机剪切板失败。"));
  } finally {
    busyActionIds.delete(clipId);
    render();
  }
}

async function mutateClip(clipId: string, payload: Record<string, unknown>, successMessage: string) {
  if (!supabase) return;

  busyActionIds.add(clipId);
  render();

  try {
    const { error } = await supabase.from("notes").update(payload).eq("id", clipId).eq("user_id", currentSession?.user.id);
    if (error) {
      throw error;
    }

    setStatus("success", successMessage);
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "更新 Echo 消息失败。"));
  } finally {
    busyActionIds.delete(clipId);
    render();
  }
}

async function togglePin(clipId: string, nextPinned: boolean) {
  await mutateClip(clipId, { is_starred: nextPinned }, nextPinned ? "这条消息已收藏。" : "这条消息已取消收藏。");
}

async function deleteClip(clipId: string) {
  await mutateClip(clipId, { deleted_at: new Date().toISOString() }, "这条消息已从列表中移除。");
}

async function handleLoginFormSubmit(form: HTMLFormElement) {
  if (!supabase) {
    setStatus("danger", "Supabase 环境变量未配置，无法登录。");
    return;
  }

  const formData = new FormData(form);
  authDraft = {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? "").trim(),
  };

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: authDraft.email,
      password: authDraft.password,
    });

    if (error) {
      throw error;
    }

    authDraft.password = "";
    setStatus("success", "登录成功，正在接入你的 Echo 数据流。");
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "登录失败，请检查邮箱和密码。"));
  }
}

async function handleToggleChange(input: HTMLInputElement) {
  if (input.id === "monitor-toggle") {
    persistedState.settings.monitorClipboard = input.checked;
    await saveAndRender();
    setStatus("neutral", input.checked ? "已恢复自动监听剪切板。" : "已暂停自动监听剪切板。");
    return;
  }

  if (input.id === "autostart-toggle") {
    persistedState.settings.autostartEnabled = input.checked;
    await syncAutostartPreference();
    await saveAndRender();
    setStatus("neutral", input.checked ? "开机自启已开启。" : "开机自启已关闭。");
    return;
  }

  if (input.id === "floating-ball-toggle") {
    persistedState.settings.floatingBallEnabled = input.checked;
    await saveAndRender();
    if (input.checked) {
      setStatus("neutral", "悬浮球模式已开启，空闲 2 分钟后自动收起。");
      scheduleIdleCollapse();
    } else {
      clearIdleCollapseTimer();
      setStatus("neutral", "悬浮球模式已关闭，收起时会隐藏到托盘。");
    }
  }
}

function attachDomEvents() {
  root.addEventListener("scroll", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("conversation")) return;
    stickConversationToBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 72;
  }, true);

  root.addEventListener("dragenter", (event) => {
    if (!currentSession || compactMode || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    browserDragDepth += 1;
    setDragActive(true);
    scheduleIdleCollapse();
  });

  root.addEventListener("dragover", (event) => {
    if (!currentSession || compactMode || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  root.addEventListener("dragleave", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    browserDragDepth = Math.max(0, browserDragDepth - 1);
    if (browserDragDepth === 0 && dragActive) {
      setDragActive(false);
    }
  });

  root.addEventListener("drop", (event) => {
    if (!currentSession || compactMode) return;
    event.preventDefault();
    browserDragDepth = 0;
    setDragActive(false);
    const files = event.dataTransfer ? clipboardFilesFromDataTransfer(event.dataTransfer) : [];
    if (files.length > 0) queueComposerBrowserFiles(files);
    else render();
    scheduleIdleCollapse();
  });

  root.addEventListener("dblclick", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action='expand-window']");
    if (target) void expandFromOrb();
  });

  root.addEventListener("paste", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.id !== "message-input") return;
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    event.preventDefault();
    const files = clipboardFilesFromDataTransfer(clipboardData);
    if (files.length > 0) {
      queueComposerBrowserFiles(files);
      return;
    }
    void queueNativeClipboardFiles(clipboardData.getData("text/plain"), target);
  });

  root.addEventListener("input", (event) => {
    scheduleIdleCollapse();
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.id === "message-input") {
      messageDraft = target.value;
      const sendButton = root.querySelector<HTMLButtonElement>(".send-button");
      if (sendButton) {
        sendButton.disabled = messageSending || (!messageDraft.trim() && pendingComposerAttachments.length === 0);
      }
      return;
    }

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.id === "email") {
      authDraft.email = target.value;
    }

    if (target.id === "password") {
      authDraft.password = target.value;
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.id === "desktop-file-input") {
      queueComposerBrowserFiles(Array.from(target.files ?? []));
      target.value = "";
      return;
    }

    if (target.id === "monitor-toggle" || target.id === "autostart-toggle" || target.id === "floating-ball-toggle") {
      void handleToggleChange(target);
    }
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.id !== "message-input") return;
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    root.querySelector<HTMLFormElement>("#message-form")?.requestSubmit();
  });

  root.addEventListener("submit", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) {
      return;
    }

    if (target.id === "login-form") {
      event.preventDefault();
      void handleLoginFormSubmit(target);
      return;
    }

    if (target.id === "message-form") {
      event.preventDefault();
      const formData = new FormData(target);
      void sendComposerMessage(String(formData.get("message") ?? ""));
    }
  });

  root.addEventListener("click", (event) => {
    scheduleIdleCollapse();
    const actionTarget = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.dataset.action;
    const clipId = actionTarget.dataset.id;

    if (!action) {
      return;
    }

    if (action === "copy-clip" && clipId) {
      void copyClipToLocalClipboard(clipId);
      return;
    }

    if (action === "open-attachment") {
      const attachmentId = actionTarget.dataset.attachmentId;
      if (attachmentId) void openAttachment(attachmentId);
      return;
    }

    if (action === "pin-clip" && clipId) {
      void togglePin(clipId, true);
      return;
    }

    if (action === "unpin-clip" && clipId) {
      void togglePin(clipId, false);
      return;
    }

    if (action === "delete-clip" && clipId) {
      void deleteClip(clipId);
      return;
    }

    if (action === "send-current-clipboard") {
      void sendCurrentClipboard();
      return;
    }

    if (action === "choose-files") {
      root.querySelector<HTMLInputElement>("#desktop-file-input")?.click();
      return;
    }

    if (action === "remove-pending-attachment") {
      const index = Number(actionTarget.dataset.index);
      const attachment = pendingComposerAttachments[index];
      if (!attachment) return;
      pendingComposerAttachments.splice(index, 1);
      if (attachment.kind === "native") {
        void invoke("release_clipboard_file", { id: attachment.id });
      }
      setStatus("neutral", `已移除附件：${attachmentName(attachment)}`);
      return;
    }

    if (action === "confirm-clipboard" && pendingClipboard) {
      const clip = pendingClipboard;
      pendingClipboard = null;
      if (pendingClipboardTimer) window.clearTimeout(pendingClipboardTimer);
      void sendClip(clip, true);
      render();
      return;
    }

    if (action === "ignore-clipboard" && pendingClipboard) {
      const clip = pendingClipboard;
      pendingClipboard = null;
      if (pendingClipboardTimer) window.clearTimeout(pendingClipboardTimer);
      void markIgnoredHash(clip.hash);
      setStatus("neutral", "这次复制已忽略，不会上传。");
      return;
    }

    if (action === "flush-queue") {
      void flushPendingQueue();
      return;
    }

    if (action === "refresh-clips") {
      void refreshClips();
      return;
    }

    if (action === "toggle-settings") {
      settingsOpen = !settingsOpen;
      render();
      return;
    }

    if (action === "collapse-window") {
      void collapseToOrb();
      return;
    }

    if (action === "sign-out") {
      void signOutLocal().catch((error) => {
        setStatus("danger", getErrorMessage(error, "退出当前设备登录失败。"));
      });
    }
  });
}

async function initSupabase() {
  if (!isValidUrl(supabaseUrl) || !isConfiguredKey(supabaseAnonKey)) {
    setStatus("danger", "还没配置好 Supabase URL 和 anon key，桌面端无法启动同步。");
    render();
    return false;
  }

  supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      storage: secureAuthStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return true;
}

async function bootstrap() {
  render();
  await ensureStore();
  await syncAutostartPreference();
  await setupWindowChrome();
  await setupFileDrop();
  await setupTray();
  await ensureNotificationPermission();
  startClipboardWatcher();
  attachDomEvents();

  const ready = await initSupabase();
  if (!ready) {
    return;
  }

  lastObservedClipboard = await readClipboardSafely();

  window.addEventListener("online", () => {
    void flushPendingQueue();
  });

  window.addEventListener("offline", () => {
    setStatus("warning", "网络已断开，新内容会先进入离线队列。");
  });

  await setupAuth();
  if (currentSession && persistedState.settings.floatingBallEnabled) {
    await collapseToOrb();
  } else {
    scheduleIdleCollapse();
  }
}

function bootstrapOrbWindow() {
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;

  compactMode = true;
  animateOrbEntry = true;
  render();
  animateOrbEntry = false;

  root.addEventListener("dblclick", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action='expand-window']");
    if (target) void expandFromOrb();
  });
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".echo-orb");
    if (!target) return;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
  });
  root.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) < 4) return;
    dragPointerId = null;
    void invoke("start_orb_drag");
  });
  const clearDragPointer = () => {
    dragPointerId = null;
  };
  root.addEventListener("pointerup", clearDragPointer);
  root.addEventListener("pointercancel", clearDragPointer);
}

if (isOrbWindow) {
  bootstrapOrbWindow();
} else {
  void bootstrap();
}
