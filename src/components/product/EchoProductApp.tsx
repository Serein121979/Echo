"use client";

import type { Session } from "@supabase/supabase-js";
import { Archive, Copy, Download, File, Inbox, LogOut, Paperclip, Send, Sparkles, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";
import { AiWorkspace } from "./AiWorkspace";
import { MAX_FILE_SIZE, uploadToSupabase } from "./resumableUpload";
import type { AiSuggestion, ProductNote } from "./types";

type View = "inbox" | "starred" | "archived";
type UploadProgress = { name: string; percent: number };

function platformName() {
  if (typeof navigator === "undefined") return "web";
  const value = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|android/.test(value)) return "mobile";
  if (value.includes("windows")) return "windows";
  if (value.includes("mac")) return "macos";
  return "web";
}

function getClientId() {
  const key = "echo-device-client-id";
  const current = localStorage.getItem(key);
  if (current) return current;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function formatSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(value > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function mapNote(row: Record<string, unknown>): ProductNote {
  const tagRows = Array.isArray(row.note_tags) ? row.note_tags : [];
  return {
    id: String(row.id), content: String(row.content ?? ""), summary: typeof row.summary === "string" ? row.summary : null,
    ai_status: ["pending", "processing", "ready", "failed"].includes(String(row.ai_status)) ? row.ai_status as ProductNote["ai_status"] : "pending",
    folder_id: typeof row.folder_id === "string" ? row.folder_id : null, source_platform: String(row.source_platform ?? "web"),
    created_at: String(row.created_at), is_starred: Boolean(row.is_starred), is_archived: Boolean(row.is_archived),
    attachments: Array.isArray(row.attachments) ? row.attachments as ProductNote["attachments"] : [],
    tags: tagRows.flatMap((item) => {
      if (!item || typeof item !== "object" || !("tag" in item)) return [];
      const tag = (item as { tag: ProductNote["tags"][number] | ProductNote["tags"][number][] | null }).tag;
      return tag ? [Array.isArray(tag) ? tag[0] : tag].filter(Boolean) : [];
    }),
  };
}

export function EchoProductApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(!supabaseConfigError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [notes, setNotes] = useState<ProductNote[]>([]);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [activeFolder, setActiveFolder] = useState("all");
  const [view, setView] = useState<View>("inbox");
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [error, setError] = useState<string | null>(supabaseConfigError);
  const [notice, setNotice] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const analyzingRef = useRef(new Set<string>());

  const loadData = useCallback(async (currentSession: Session, loading = false) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (loading) setIsLoading(true);
    try {
      const [notesResult, foldersResult, suggestionsResult] = await Promise.all([
        supabase.from("notes").select("id,content,summary,ai_status,folder_id,source_platform,created_at,is_starred,is_archived,attachments(id,storage_path,file_name,file_type,file_size,upload_status,extraction_status),note_tags(tag:tags(id,name,color))").eq("user_id", currentSession.user.id).is("deleted_at", null).order("created_at", { ascending: false }),
        supabase.from("folders").select("id,name").eq("user_id", currentSession.user.id).order("created_at"),
        supabase.from("ai_suggestions").select("id,note_id,summary,suggested_tags,suggested_folder,confidence,reason").eq("user_id", currentSession.user.id).eq("status", "pending").order("created_at", { ascending: false }),
      ]);
      if (notesResult.error) throw notesResult.error;
      if (foldersResult.error) throw foldersResult.error;
      if (suggestionsResult.error) throw suggestionsResult.error;
      setNotes((notesResult.data ?? []).map((row) => mapNote(row as Record<string, unknown>)));
      setFolders(foldersResult.data ?? []);
      setSuggestions((suggestionsResult.data ?? []) as AiSuggestion[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setAuthLoading(false); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthLoading(false); if (!next) setNotes([]); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    void (async () => {
      await supabase.rpc("bootstrap_echo_user");
      const clientId = getClientId();
      await supabase.from("devices").upsert({ user_id: session.user.id, client_id: clientId, name: `${platformName()} 设备`, platform: platformName(), last_seen_at: new Date().toISOString() }, { onConflict: "user_id,client_id" });
      await loadData(session, true);
    })();
    const channel = supabase.channel(`echo-private-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${session.user.id}` }, () => void loadData(session))
      .on("postgres_changes", { event: "*", schema: "public", table: "attachments", filter: `user_id=eq.${session.user.id}` }, () => void loadData(session))
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_suggestions", filter: `user_id=eq.${session.user.id}` }, () => void loadData(session))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadData, session]);

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return notes.filter((note) => {
      const viewMatch = view === "archived" ? note.is_archived : view === "starred" ? note.is_starred && !note.is_archived : !note.is_archived;
      const folderMatch = activeFolder === "all" || note.folder_id === activeFolder;
      const haystack = [note.content, note.summary ?? "", ...note.tags.map((tag) => tag.name), ...note.attachments.map((file) => file.file_name)].join(" ").toLocaleLowerCase();
      return viewMatch && folderMatch && (!normalized || haystack.includes(normalized));
    });
  }, [activeFolder, notes, query, view]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSigningIn(true); setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message);
    setSigningIn(false);
  }

  function addFiles(files: File[]) {
    const oversized = files.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) return setError(`“${oversized.name}”超过 500MB 上限。`);
    setPendingFiles((current) => [...current, ...files]);
    setError(null);
  }

  async function analyzeNote(noteId: string, attachmentIds: string[]) {
    if (!session || analyzingRef.current.has(noteId)) return;
    analyzingRef.current.add(noteId);
    try {
      const headers = { Authorization: `Bearer ${session.access_token}` };
      await Promise.allSettled(attachmentIds.map((id) => fetch(`/api/attachments/${id}/extract`, { method: "POST", headers })));
      await fetch("/api/ai/suggest", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ noteId }) });
      await loadData(session);
    } finally {
      analyzingRef.current.delete(noteId);
    }
  }

  useEffect(() => {
    if (!session || isSending) return;
    const pending = notes.find((note) => note.ai_status === "pending");
    if (pending) void analyzeNote(pending.id, pending.attachments.map((item) => item.id));
    // analyzeNote is intentionally driven by synchronized note state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSending, notes, session]);

  async function send() {
    if (!session || isSending || (!input.trim() && pendingFiles.length === 0)) return;
    const supabase = getSupabaseClient();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabase || !supabaseUrl) return;
    setIsSending(true); setError(null); setNotice(null);
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    try {
      const clientId = getClientId();
      const { data: device } = await supabase.from("devices").select("id").eq("user_id", session.user.id).eq("client_id", clientId).single();
      const { data: note, error: noteError } = await supabase.from("notes").insert({ user_id: session.user.id, content: input.trim(), folder_id: activeFolder === "all" ? null : activeFolder, source_device_id: device?.id ?? null, source_platform: platformName() }).select("id").single();
      if (noteError) throw noteError;
      const attachmentIds: string[] = [];
      for (const file of pendingFiles) {
        setUploads((current) => [...current.filter((item) => item.name !== file.name), { name: file.name, percent: 0 }]);
        const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
        const objectName = `${session.user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
        await uploadToSupabase({ file, supabaseUrl, accessToken: session.access_token, objectName, signal: abort.signal, onProgress: (percent) => setUploads((current) => current.map((item) => item.name === file.name ? { ...item, percent } : item)) });
        const { data: attachment, error: attachmentError } = await supabase.from("attachments").insert({ user_id: session.user.id, note_id: note.id, storage_path: objectName, file_name: file.name, file_type: file.type || "application/octet-stream", file_size: file.size, upload_status: "ready" }).select("id").single();
        if (attachmentError) throw attachmentError;
        attachmentIds.push(attachment.id);
      }
      setInput(""); setPendingFiles([]); setUploads([]); setNotice("已发送到所有设备，AI 正在生成整理建议。");
      await loadData(session);
      void analyzeNote(note.id, attachmentIds);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败");
    } finally {
      setIsSending(false); uploadAbortRef.current = null;
    }
  }

  async function updateNote(noteId: string, patch: Record<string, unknown>) {
    if (!session) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error: updateError } = await supabase.from("notes").update(patch).eq("id", noteId).eq("user_id", session.user.id);
    if (updateError) setError(updateError.message); else await loadData(session);
  }

  async function downloadAttachment(id: string) {
    if (!session) return;
    const response = await fetch(`/api/attachments/${id}/url`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "下载失败");
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  function openNote(id: string) {
    setShowAi(false); setView("inbox"); setActiveFolder("all"); setQuery(""); setHighlightedId(id);
    window.setTimeout(() => document.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    window.setTimeout(() => setHighlightedId(null), 2400);
  }

  if (authLoading) return <main className="grid min-h-[100dvh] place-items-center bg-[var(--canvas)]"><div className="h-10 w-40 animate-pulse rounded-xl bg-[var(--surface-muted)]" /></main>;
  if (!session) return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--canvas)] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7 shadow-[0_24px_80px_rgba(15,23,42,.1)]">
        <div className="echo-mark">E</div><h1 className="mt-6 text-2xl font-semibold tracking-tight">登录你的私人 Echo</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">同一个账号连接手机、Windows 和 Mac。这里不提供公开注册。</p>
        <form className="mt-7 space-y-4" onSubmit={signIn}><label className="block text-sm font-medium">邮箱<input className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-3 outline-none" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="block text-sm font-medium">密码<input className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-3 outline-none" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="w-full rounded-xl bg-[var(--ink)] py-3 text-sm font-semibold text-[var(--surface)] disabled:opacity-50" disabled={signingIn}>{signingIn ? "登录中…" : "登录"}</button></form>
        {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      </div>
    </main>
  );

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--canvas)]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col border-x border-[var(--line)] bg-[var(--surface)]">
        <header className="shrink-0 border-b border-[var(--line)] px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:px-6">
          <div className="flex items-center gap-3"><div className="echo-mark">E</div><div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">Echo</h1><p className="text-xs text-[var(--muted)]">{session.user.email}</p></div><button className="relative icon-button" onClick={() => setShowAi(true)} aria-label="打开 Echo AI"><Sparkles size={17} />{suggestions.length ? <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9px] text-white">{suggestions.length}</span> : null}</button><button className="icon-button" onClick={() => void getSupabaseClient()?.auth.signOut({ scope: "local" })} aria-label="退出登录"><LogOut size={17} /></button></div>
          <div className="mt-4 flex items-center gap-2 overflow-x-auto">{([{ id: "inbox", label: "收件箱", icon: Inbox }, { id: "starred", label: "收藏", icon: Star }, { id: "archived", label: "归档", icon: Archive }] as const).map(({ id, label, icon: Icon }) => <button key={id} className={`view-tab ${view === id ? "view-tab-active" : ""}`} onClick={() => setView(id)}><Icon size={15} />{label}</button>)}<select className="ml-auto rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-2 text-xs" value={activeFolder} onChange={(event) => setActiveFolder(event.target.value)}><option value="all">全部文件夹</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>
          <input className="mt-3 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索正文、文件名、标签和摘要" />
        </header>
        {error ? <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><span>{error}</span><button onClick={() => setError(null)}><X size={15} /></button></div> : notice ? <div className="mx-4 mt-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--muted)]">{notice}</div> : null}

        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {isLoading ? <div className="space-y-4">{[1,2,3].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />)}</div> : visibleNotes.length === 0 ? <div className="mx-auto max-w-sm py-20 text-center"><div className="echo-empty-mark mx-auto">E</div><h2 className="mt-5 font-semibold">{query ? "没有找到匹配内容" : "这里还没有消息"}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">从任意设备发送文字或文件，它会立即同步到这里。</p></div> : <div className="space-y-4">{visibleNotes.map((note) => (
            <article key={note.id} data-note-id={note.id} className={`rounded-2xl border bg-[var(--surface-raised)] p-4 transition ${highlightedId === note.id ? "border-[var(--accent)] ring-4 ring-blue-500/10" : "border-[var(--line)]"}`}>
              <div className="flex items-start gap-3"><div className="min-w-0 flex-1">{note.content ? <p className="whitespace-pre-wrap break-words text-sm leading-7">{note.content}</p> : null}{note.summary ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">AI 摘要：{note.summary}</p> : null}</div><button onClick={() => void navigator.clipboard.writeText(note.content)} className="text-[var(--muted)] hover:text-[var(--ink)]" aria-label="复制正文"><Copy size={16} /></button></div>
              {note.attachments.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{note.attachments.map((attachment) => <button key={attachment.id} onClick={() => void downloadAttachment(attachment.id)} className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-left"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)]"><File size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{attachment.file_name}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{formatSize(attachment.file_size)} · {attachment.extraction_status === "ready" ? "已建立索引" : attachment.extraction_status === "failed" ? "解析失败" : "等待解析"}</p></div><Download size={15} /></button>)}</div> : null}
              {note.tags.length ? <div className="mt-3 flex flex-wrap gap-1.5">{note.tags.map((tag) => <span key={tag.id} className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[10px]">#{tag.name}</span>)}</div> : null}
              <footer className="mt-4 flex items-center gap-3 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--muted)]"><span>来自 {note.source_platform}</span><span>{new Date(note.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><div className="ml-auto flex gap-2"><button onClick={() => void updateNote(note.id, { is_starred: !note.is_starred })} aria-label="收藏"><Star size={15} className={note.is_starred ? "fill-current text-amber-500" : ""} /></button><button onClick={() => void updateNote(note.id, { is_archived: !note.is_archived })} aria-label="归档"><Archive size={15} /></button><button onClick={() => { if (confirm("把这条消息移到回收站？")) void updateNote(note.id, { deleted_at: new Date().toISOString() }); }} aria-label="删除"><Trash2 size={15} /></button></div></footer>
            </article>
          ))}</div>}
        </section>

        <footer className="shrink-0 border-t border-[var(--line)] bg-[var(--surface)] px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-5">
          {pendingFiles.length ? <div className="mb-2 flex gap-2 overflow-x-auto">{pendingFiles.map((file, index) => <div key={`${file.name}-${index}`} className="flex max-w-56 shrink-0 items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-2.5 py-2 text-xs"><span className="truncate">{file.name}</span><button onClick={() => setPendingFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}><X size={13} /></button></div>)}</div> : null}
          {uploads.length ? <div className="mb-2 space-y-1">{uploads.map((upload) => <div key={upload.name}><div className="flex justify-between text-[10px] text-[var(--muted)]"><span className="truncate">{upload.name}</span><span>{upload.percent}%</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${upload.percent}%` }} /></div></div>)}</div> : null}
          <div className="flex items-end gap-2"><input ref={fileInputRef} className="hidden" type="file" multiple onChange={(event) => addFiles(Array.from(event.target.files ?? []))} /><button className="icon-button shrink-0" onClick={() => fileInputRef.current?.click()} aria-label="添加文件"><Paperclip size={18} /></button><textarea className="max-h-36 min-h-10 flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]" rows={1} value={input} onChange={(event) => setInput(event.target.value)} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) addFiles(files); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="输入消息，或粘贴文件…" />{isSending ? <button className="icon-button shrink-0" onClick={() => uploadAbortRef.current?.abort()} aria-label="取消发送"><X size={18} /></button> : <button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-[var(--surface)] disabled:opacity-40" onClick={() => void send()} disabled={!input.trim() && pendingFiles.length === 0} aria-label="发送"><Send size={17} /></button>}</div>
        </footer>
      </div>
      {showAi ? <AiWorkspace accessToken={session.access_token} suggestions={suggestions} onClose={() => setShowAi(false)} onSuggestionHandled={() => loadData(session)} onOpenNote={openNote} /> : null}
    </main>
  );
}
