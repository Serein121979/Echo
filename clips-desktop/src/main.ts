import "./style.css";

import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Menu } from "@tauri-apps/api/menu";
import type { TrayIconEvent } from "@tauri-apps/api/tray";
import { TrayIcon } from "@tauri-apps/api/tray";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { load } from "@tauri-apps/plugin-store";

const STORE_PATH = "clips-store.json";
const STORE_KEY = "appState";
const RECENT_LIMIT = 100;
const MAX_SYNC_BYTES = 200 * 1024;
const CLIPBOARD_POLL_MS = 1200;
const DEDUPE_WINDOW_MS = 10_000;
const IGNORE_WINDOW_MS = 15_000;

type ClipKind = "text" | "code";

type ClipRecord = {
  id: string;
  content: string;
  kind: ClipKind;
  contentHash: string;
  sourceDeviceId: string;
  sourcePlatform: string;
  isPinned: boolean;
  createdAt: string;
};

type PendingClip = {
  content: string;
  kind: ClipKind;
  hash: string;
  createdAt: string;
};

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

function shortenDeviceId(value: string) {
  return value ? value.slice(0, 8) : "device";
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
      lastSeenTimestamp: null,
    },
  };
}

function getErrorMessage(error: unknown, fallback: string) {
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

  return fallback;
}

function mapClipRecord(row: Record<string, unknown>): ClipRecord {
  return {
    id: String(row.id),
    content: typeof row.content === "string" ? row.content : "",
    kind: row.kind === "code" ? "code" : "text",
    contentHash: typeof row.content_hash === "string" ? row.content_hash : "",
    sourceDeviceId: typeof row.source_device_id === "string" ? row.source_device_id : "",
    sourcePlatform: typeof row.source_platform === "string" ? row.source_platform : "",
    isPinned: Boolean(row.is_pinned),
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
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
let clipboardTimer: number | null = null;
let lastObservedClipboard = "";
let notificationGranted = false;
let knownClipIds = new Set<string>();
let isQuitting = false;
let realtimeChannel: { unsubscribe: () => Promise<unknown> } | null = null;

function setStatus(tone: BannerTone, message: string) {
  statusBanner = { tone, message };
  void syncTrayTooltip();
  render();
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
  const contentHtml =
    clip.kind === "code"
      ? `<pre class="clip-code">${escapeHtml(clip.content)}</pre>`
      : `<p class="clip-text">${escapeHtml(clip.content)}</p>`;
  const clipBusy = busyActionIds.has(clip.id);

  return `
    <article class="clip-card">
      <div class="clip-meta">
        <span class="chip">${clip.kind}</span>
        <span>${escapeHtml(clip.sourcePlatform || "unknown")}</span>
        <span>#${escapeHtml(shortenDeviceId(clip.sourceDeviceId))}</span>
        <span>${escapeHtml(formatTimestamp(clip.createdAt))}</span>
      </div>
      <div class="clip-body">${contentHtml}</div>
      <div class="clip-actions">
        <button class="button-secondary" data-action="copy-clip" data-id="${clip.id}" ${clipBusy ? "disabled" : ""}>复制到本机剪切板</button>
        <button class="button-secondary" data-action="${clip.isPinned ? "unpin-clip" : "pin-clip"}" data-id="${clip.id}" ${clipBusy ? "disabled" : ""}>${clip.isPinned ? "取消置顶" : "置顶"}</button>
        <button class="button-danger" data-action="delete-clip" data-id="${clip.id}" ${clipBusy ? "disabled" : ""}>删除</button>
      </div>
    </article>
  `;
}

function renderClipList(items: ClipRecord[], emptyText: string) {
  if (items.length === 0) {
    return `<div class="empty-card">${escapeHtml(emptyText)}</div>`;
  }

  return `<div class="list">${items.map((item) => renderClipCard(item)).join("")}</div>`;
}

function renderLoginView() {
  return `
    <div class="shell">
      <div class="frame">
        <section class="hero">
          <p class="eyebrow">Echo Clips Desktop</p>
          <div class="title-row">
            <div>
              <h1>让剪切板常驻在线</h1>
              <p class="hero-subtitle">桌面端会自动监听纯文本和代码片段，同步到你的个人 Clips 流。</p>
            </div>
            <span class="status-pill neutral">未登录</span>
          </div>
        </section>

        <section class="status-banner ${statusBanner.tone}">${escapeHtml(statusBanner.message)}</section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Login</p>
              <div class="title-row">
                <div>
                  <h2>使用同一个 Supabase 账号登录</h2>
                  <p class="panel-subtitle">桌面端和 Web 端共享同一条 Clips 私有数据流，RLS 会按用户隔离。</p>
                </div>
              </div>
            </div>
          </div>

          <form id="login-form" class="stack auth-grid">
            <div class="field">
              <label for="email">邮箱</label>
              <input id="email" name="email" type="email" value="${escapeHtml(authDraft.email)}" placeholder="you@example.com" autocomplete="email" required />
            </div>
            <div class="field">
              <label for="password">密码</label>
              <input id="password" name="password" type="password" value="${escapeHtml(authDraft.password)}" placeholder="请输入密码" autocomplete="current-password" required />
            </div>
            <button class="button" type="submit">登录并开始同步</button>
          </form>
        </section>
      </div>
    </div>
  `;
}

function renderAppView() {
  return `
    <div class="shell">
      <div class="frame">
        <section class="hero">
          <p class="eyebrow">Echo Clips Desktop</p>
          <div class="title-row">
            <div>
              <h1>托盘常驻的小面板</h1>
              <p class="hero-subtitle">复制代码以后它会自动同步，另一台设备收到通知后点一下就能写回本机剪切板。</p>
            </div>
            <span class="status-pill ${statusBanner.tone}">${escapeHtml(statusBanner.tone === "success" ? "在线" : statusBanner.tone === "warning" ? "离线队列" : statusBanner.tone === "danger" ? "异常" : "待命")}</span>
          </div>
          <div class="meta-grid">
            <div class="meta-card">
              <strong>账号</strong>
              <span>${escapeHtml(currentSession?.user.email ?? "未登录")}</span>
            </div>
            <div class="meta-card">
              <strong>设备 ID</strong>
              <span class="mono">${escapeHtml(shortenDeviceId(persistedState.deviceId))}</span>
            </div>
            <div class="meta-card">
              <strong>待发送队列</strong>
              <span>${persistedState.pendingQueue.length} 条</span>
            </div>
            <div class="meta-card">
              <strong>最近同步</strong>
              <span>${escapeHtml(persistedState.settings.lastSeenTimestamp ? formatTimestamp(persistedState.settings.lastSeenTimestamp) : "暂无")}</span>
            </div>
          </div>
          <div class="action-row">
            <button class="button" data-action="send-current-clipboard">发送当前剪切板</button>
            <button class="button-secondary" data-action="flush-queue">重试离线队列</button>
            <button class="button-secondary" data-action="refresh-clips">刷新列表</button>
            <button class="button-danger" data-action="sign-out">退出当前设备登录</button>
          </div>
          <div class="toggle-row">
            <label class="toggle">
              <input id="monitor-toggle" type="checkbox" ${persistedState.settings.monitorClipboard ? "checked" : ""} />
              自动监听剪切板
            </label>
            <label class="toggle">
              <input id="autostart-toggle" type="checkbox" ${persistedState.settings.autostartEnabled ? "checked" : ""} />
              开机自启
            </label>
          </div>
        </section>

        <section class="status-banner ${statusBanner.tone}">${escapeHtml(statusBanner.message)}</section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Pinned</p>
              <div class="title-row">
                <div>
                  <h2>长期保留区</h2>
                  <p class="panel-subtitle">适合固定命令、常用代码和跨设备反复要用的片段。</p>
                </div>
              </div>
            </div>
            <span class="counter">${pinnedClips.length} 条</span>
          </div>
          ${renderClipList(pinnedClips, "还没有置顶内容。等你把常用片段在任一设备上置顶后，这里会长期保留。")}
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Recent</p>
              <div class="title-row">
                <div>
                  <h2>最近 100 条</h2>
                  <p class="panel-subtitle">这里保留临时接力用的最近记录，不会自动覆盖你的当前剪切板。</p>
                </div>
              </div>
            </div>
            <span class="counter">${recentClips.length} 条</span>
          </div>
          ${renderClipList(recentClips, "最近还没有同步记录。复制一段文本或代码，桌面端就会开始写入 Clips。")}
        </section>
      </div>
    </div>
  `;
}

function render() {
  root.innerHTML = currentSession ? renderAppView() : renderLoginView();
}

async function syncTrayTooltip() {
  if (!trayIcon) return;

  const prefix = currentSession ? "Echo Clips 已登录" : "Echo Clips 未登录";
  await trayIcon.setTooltip(`${prefix} · ${statusBanner.message}`);
}

async function saveAndRender() {
  cleanupTimedHashes();
  await saveState();
  render();
}

async function ensureStore() {
  store = await load(STORE_PATH, { autoSave: false });
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
    title: "Echo Clips",
    body: clip.kind === "code" ? "收到一段新的代码片段，点击面板即可复制。" : "收到一条新的文本片段，点击面板即可复制。",
  });
}

async function setupWindowChrome() {
  const windowRef = getCurrentWindow();

  await windowRef.onCloseRequested(async (event: CloseRequestedEvent) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    await windowRef.hide();
    setStatus("neutral", "面板已隐藏，托盘仍在后台监听剪切板。");
  });
}

async function toggleWindow() {
  const windowRef = getCurrentWindow();
  const visible = await windowRef.isVisible();

  if (visible) {
    await windowRef.hide();
  } else {
    await windowRef.show();
  }
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
        text: "显示 / 隐藏面板",
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
    icon = await defaultWindowIcon();
  } catch {
    icon = undefined;
  }

  trayIcon = await TrayIcon.new({
    id: "echo-clips-tray",
    menu,
    icon,
    tooltip: "Echo Clips",
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
      .from("clips")
      .select("id, content, kind, content_hash, source_device_id, source_platform, is_pinned, created_at")
      .eq("user_id", session.user.id)
      .is("deleted_at", null);

  const [pinnedResult, recentResult] = await Promise.all([
    buildQuery().eq("is_pinned", true).order("created_at", { ascending: false }),
    buildQuery().eq("is_pinned", false).order("created_at", { ascending: false }).limit(RECENT_LIMIT),
  ]);

  if (pinnedResult.error) {
    throw pinnedResult.error;
  }

  if (recentResult.error) {
    throw recentResult.error;
  }

  return {
    pinned: (pinnedResult.data ?? []).map(mapClipRecord),
    recent: (recentResult.data ?? []).map(mapClipRecord),
  };
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
      setStatus("success", "Clips 已刷新完成。");
    } else {
      render();
    }
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "Clips 刷新失败。"));
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
    .channel(`clips-${currentSession.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "clips",
        filter: `user_id=eq.${currentSession.user.id}`,
      },
      (payload: { eventType?: string; new?: Record<string, unknown> }) => {
        const nextRow = payload.new;
        if (
          payload.eventType === "INSERT" &&
          nextRow &&
          typeof nextRow.id === "string" &&
          !knownClipIds.has(nextRow.id) &&
          nextRow.source_device_id !== persistedState.deviceId
        ) {
          void notifyNewClip(mapClipRecord(nextRow));
        }

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
  await refreshClips(true);
  await subscribeToRealtime();
  await flushPendingQueue();
  setStatus("success", "桌面端已接入你的 Clips 数据流。");
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
  await processClipboardContent(nextText, false);
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
    const { error } = await supabase.from("clips").insert([
      {
        content: clip.content,
        kind: clip.kind,
        content_hash: clip.hash,
        source_device_id: persistedState.deviceId,
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

async function markIgnoredHash(hash: string) {
  persistedState.ignoredHashes = upsertTimedHash(persistedState.ignoredHashes, hash, IGNORE_WINDOW_MS);
  lastObservedClipboard = "";
  await saveState();
}

async function copyClipToLocalClipboard(clipId: string) {
  const clip = getClipById(clipId);
  if (!clip) {
    setStatus("danger", "找不到要复制的那条 Clips。");
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
    const { error } = await supabase.from("clips").update(payload).eq("id", clipId);
    if (error) {
      throw error;
    }

    setStatus("success", successMessage);
  } catch (error) {
    setStatus("danger", getErrorMessage(error, "更新 Clips 失败。"));
  } finally {
    busyActionIds.delete(clipId);
    render();
  }
}

async function togglePin(clipId: string, nextPinned: boolean) {
  await mutateClip(clipId, { is_pinned: nextPinned }, nextPinned ? "这条 Clips 已置顶。" : "这条 Clips 已取消置顶。");
}

async function deleteClip(clipId: string) {
  await mutateClip(clipId, { deleted_at: new Date().toISOString() }, "这条 Clips 已从列表中移除。");
}

async function handleLoginFormSubmit(form: HTMLFormElement) {
  if (!supabase) {
    setStatus("danger", "Supabase 环境变量未配置，无法登录。");
    return;
  }

  const formData = new FormData(form);
  authDraft = {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
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
    setStatus("success", "登录成功，正在接入你的 Clips 数据流。");
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
  }
}

function attachDomEvents() {
  root.addEventListener("input", (event) => {
    const target = event.target;
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

    if (target.id === "monitor-toggle" || target.id === "autostart-toggle") {
      void handleToggleChange(target);
    }
  });

  root.addEventListener("submit", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) {
      return;
    }

    if (target.id === "login-form") {
      event.preventDefault();
      void handleLoginFormSubmit(target);
    }
  });

  root.addEventListener("click", (event) => {
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

    if (action === "flush-queue") {
      void flushPendingQueue();
      return;
    }

    if (action === "refresh-clips") {
      void refreshClips();
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
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return true;
}

async function bootstrap() {
  render();
  await ensureStore();
  await syncAutostartPreference();
  await setupWindowChrome();
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
}

void bootstrap();
