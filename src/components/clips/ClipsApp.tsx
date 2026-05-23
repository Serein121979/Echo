"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";
import type { ClipRecord } from "@/components/clips/types";

const RECENT_LIMIT = 100;

type StatusTone = "neutral" | "success" | "error";

type StatusMessage = {
  tone: StatusTone;
  message: string;
} | null;

type AuthFormState = {
  email: string;
  password: string;
};

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
    sourceDeviceId: typeof row.source_device_id === "string" ? row.source_device_id : "",
    sourcePlatform: typeof row.source_platform === "string" ? row.source_platform : "",
    isPinned: Boolean(row.is_pinned),
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

async function fetchClips(session: Session) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
  }

  const buildQuery = () =>
    supabase
      .from("clips")
      .select("id, content, kind, source_device_id, source_platform, is_pinned, created_at")
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

function ClipContent({ clip }: { clip: ClipRecord }) {
  if (clip.kind === "code") {
    return (
      <pre className="overflow-x-auto rounded-2xl bg-neutral-950 px-4 py-3 text-xs leading-6 text-neutral-100 whitespace-pre-wrap">
        <code>{clip.content}</code>
      </pre>
    );
  }

  return <p className="text-sm leading-6 text-neutral-800 whitespace-pre-wrap">{clip.content}</p>;
}

export function ClipsApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(() => !supabaseConfigError);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [authForm, setAuthForm] = useState<AuthFormState>({ email: "", password: "" });
  const [status, setStatus] = useState<StatusMessage>(null);
  const [pinnedClips, setPinnedClips] = useState<ClipRecord[]>([]);
  const [recentClips, setRecentClips] = useState<ClipRecord[]>([]);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    let mounted = true;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;

        if (error) {
          setStatus({ tone: "error", message: getErrorMessage(error, "登录状态加载失败") });
        }

        setSession(data.session);
        setAuthLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        setStatus({ tone: "error", message: getErrorMessage(error, "登录状态加载失败") });
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) {
        setPinnedClips([]);
        setRecentClips([]);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    let active = true;

    const load = async (silent = false) => {
      if (!silent) {
        setClipsLoading(true);
      }

      try {
        const nextData = await fetchClips(session);
        if (!active) return;
        setPinnedClips(nextData.pinned);
        setRecentClips(nextData.recent);
        if (!silent) {
          setStatus(null);
        }
      } catch (error) {
        if (!active) return;
        setStatus({ tone: "error", message: getErrorMessage(error, "Clips 加载失败") });
      } finally {
        if (active) {
          setClipsLoading(false);
        }
      }
    };

    void load();

    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel(`clips-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clips",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          void load(true);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [session]);

  const allVisibleCount = useMemo(() => pinnedClips.length + recentClips.length, [pinnedClips.length, recentClips.length]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus({ tone: "error", message: supabaseConfigError ?? "Supabase 客户端初始化失败" });
      return;
    }

    setSigningIn(true);
    setStatus(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authForm.email.trim(),
        password: authForm.password,
      });

      if (error) {
        throw error;
      }

      setStatus({ tone: "success", message: "登录成功，正在同步 Clips。" });
    } catch (error) {
      setStatus({ tone: "error", message: getErrorMessage(error, "登录失败，请检查邮箱和密码") });
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus({ tone: "error", message: supabaseConfigError ?? "Supabase 客户端初始化失败" });
      return;
    }

    setSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        throw error;
      }

      setStatus({ tone: "success", message: "你已退出 Clips。" });
    } catch (error) {
      setStatus({ tone: "error", message: getErrorMessage(error, "退出失败，请稍后再试") });
    } finally {
      setSigningOut(false);
    }
  }

  async function withClipAction(clipId: string, action: () => Promise<void>) {
    setBusyClipId(clipId);

    try {
      await action();
    } catch (error) {
      setStatus({ tone: "error", message: getErrorMessage(error, "操作失败，请稍后再试") });
    } finally {
      setBusyClipId(null);
    }
  }

  async function copyClip(clip: ClipRecord) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("当前浏览器不支持直接写入剪切板。");
    }

    await navigator.clipboard.writeText(clip.content);
    setStatus({ tone: "success", message: "内容已复制到本机剪切板。" });
  }

  async function togglePin(clip: ClipRecord) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
    }

    const { error } = await supabase.from("clips").update({ is_pinned: !clip.isPinned }).eq("id", clip.id);

    if (error) {
      throw error;
    }

    setStatus({ tone: "success", message: clip.isPinned ? "已取消置顶。" : "已置顶到长期区。" });
  }

  async function archiveClip(clip: ClipRecord) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
    }

    const { error } = await supabase
      .from("clips")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", clip.id);

    if (error) {
      throw error;
    }

    setStatus({ tone: "success", message: "这条 Clips 已从当前列表移除。" });
  }

  const statusClassName =
    status?.tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : status?.tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-neutral-200 bg-white text-neutral-600";

  if (supabaseConfigError) {
    return (
      <main className="h-screen overflow-y-auto bg-neutral-100 px-4 py-8 text-neutral-950">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-neutral-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Clips</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Supabase 还没准备好</h1>
          <p className="mt-4 text-sm leading-7 text-neutral-600">{supabaseConfigError}</p>
          <p className="mt-3 text-sm leading-7 text-neutral-600">
            先确认 `.env.local` 里的 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，再执行最新的
            `supabase/schema.sql`。
          </p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
        <div className="rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm text-neutral-600 shadow-sm">
          正在检查 Clips 登录状态…
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="h-screen overflow-y-auto bg-neutral-100 px-4 py-8 text-neutral-950">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Clips</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">给桌面同步面板留一个 Web 兜底入口</h1>
            </div>
            <Link
              href="/"
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
            >
              返回 Echo
            </Link>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[32px] border border-neutral-200 bg-white p-8 shadow-sm">
              <h2 className="text-2xl font-semibold tracking-tight">登录同一个个人账号</h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                这个页面只处理 `clips` 子系统。桌面端和 Web 端都使用同一个 Supabase Auth 账号，数据会按用户隔离。
              </p>

              <form className="mt-8 space-y-4" onSubmit={handleSignIn}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-neutral-700">邮箱</span>
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                    className="w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-900"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-neutral-700">密码</span>
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                    className="w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-900"
                    placeholder="请输入你的密码"
                    autoComplete="current-password"
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={signingIn}
                  className="inline-flex rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                >
                  {signingIn ? "登录中…" : "登录 Clips"}
                </button>
              </form>

              {status ? (
                <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${statusClassName}`}>{status.message}</div>
              ) : null}
            </section>

            <aside className="rounded-[32px] border border-neutral-200 bg-neutral-950 p-8 text-neutral-100 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">第一版边界</p>
              <ul className="mt-6 space-y-4 text-sm leading-7 text-neutral-200">
                <li>只同步纯文本和代码片段，不碰文件、图片和富文本。</li>
                <li>桌面端是主入口，Web 端只负责登录、查看历史、复制、置顶和删除。</li>
                <li>真正的自动监听、托盘常驻和开机自启由 Tauri 小客户端负责。</li>
              </ul>
            </aside>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-y-auto bg-neutral-100 px-4 py-8 text-neutral-950">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 rounded-[32px] border border-neutral-200 bg-white p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Clips</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">最近同步内容</h1>
            <p className="mt-2 text-sm leading-7 text-neutral-600">
              已登录 <span className="font-medium text-neutral-900">{session.user.email}</span>，当前共看到 {allVisibleCount} 条可用内容。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
            >
              返回 Echo
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
            >
              刷新页面
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-full bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              {signingOut ? "退出中…" : "退出"}
            </button>
          </div>
        </div>

        {status ? (
          <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${statusClassName}`}>{status.message}</div>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-[32px] border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-600">Pinned</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">长期保留区</h2>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                {pinnedClips.length} 条
              </span>
            </div>

            <div className="mt-5 space-y-4">
              {pinnedClips.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-neutral-300 px-5 py-6 text-sm leading-7 text-neutral-500">
                  还没有置顶内容。桌面端把常用代码片段置顶后，这里会长期保留。
                </div>
              ) : (
                pinnedClips.map((clip) => (
                  <article key={clip.id} className="rounded-3xl border border-neutral-200 bg-neutral-50 p-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span className="rounded-full bg-neutral-200 px-2.5 py-1 font-medium text-neutral-700">{clip.kind}</span>
                      <span>{clip.sourcePlatform || "unknown"}</span>
                      <span>#{clip.sourceDeviceId.slice(0, 8) || "device"}</span>
                      <span>{formatTimestamp(clip.createdAt)}</span>
                    </div>

                    <div className="mt-4">
                      <ClipContent clip={clip} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void withClipAction(clip.id, () => copyClip(clip))}
                        disabled={busyClipId === clip.id}
                        className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-800 transition hover:border-neutral-900 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => void withClipAction(clip.id, () => togglePin(clip))}
                        disabled={busyClipId === clip.id}
                        className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-800 transition hover:border-neutral-900 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        取消置顶
                      </button>
                      <button
                        type="button"
                        onClick={() => void withClipAction(clip.id, () => archiveClip(clip))}
                        disabled={busyClipId === clip.id}
                        className="rounded-full border border-red-200 px-4 py-2 text-sm text-red-600 transition hover:border-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[32px] border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Recent</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">最近 100 条</h2>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
                {clipsLoading ? "同步中…" : `${recentClips.length} 条`}
              </span>
            </div>

            <div className="mt-5 space-y-4">
              {recentClips.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-neutral-300 px-5 py-6 text-sm leading-7 text-neutral-500">
                  最近还没有可见内容。等桌面端开始同步后，这里会显示最近的临时接力记录。
                </div>
              ) : (
                recentClips.map((clip) => (
                  <article key={clip.id} className="rounded-3xl border border-neutral-200 bg-neutral-50 p-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span className="rounded-full bg-neutral-200 px-2.5 py-1 font-medium text-neutral-700">{clip.kind}</span>
                      <span>{clip.sourcePlatform || "unknown"}</span>
                      <span>#{clip.sourceDeviceId.slice(0, 8) || "device"}</span>
                      <span>{formatTimestamp(clip.createdAt)}</span>
                    </div>

                    <div className="mt-4">
                      <ClipContent clip={clip} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void withClipAction(clip.id, () => copyClip(clip))}
                        disabled={busyClipId === clip.id}
                        className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-800 transition hover:border-neutral-900 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => void withClipAction(clip.id, () => togglePin(clip))}
                        disabled={busyClipId === clip.id}
                        className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-800 transition hover:border-neutral-900 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        置顶
                      </button>
                      <button
                        type="button"
                        onClick={() => void withClipAction(clip.id, () => archiveClip(clip))}
                        disabled={busyClipId === clip.id}
                        className="rounded-full border border-red-200 px-4 py-2 text-sm text-red-600 transition hover:border-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
