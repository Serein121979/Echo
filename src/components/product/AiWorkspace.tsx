"use client";

import { Check, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AiSuggestion } from "./types";

type Citation = { index: number; noteId: string; excerpt: string; createdAt: string };
type AiThread = { id: string; title: string; created_at: string; updated_at: string };
type HistoryMessage = { id: string; role: "user" | "assistant"; content: string; citation_note_ids: string[]; created_at: string };

export function AiWorkspace({
  accessToken,
  suggestions,
  onClose,
  onSuggestionHandled,
  onOpenNote,
}: {
  accessToken: string;
  suggestions: AiSuggestion[];
  onClose: () => void;
  onSuggestionHandled: () => Promise<void>;
  onOpenNote: (id: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AiThread[]>([]);
  const [historyMessages, setHistoryMessages] = useState<HistoryMessage[]>([]);

  const loadHistory = useCallback(async (selectedThreadId?: string) => {
    const suffix = selectedThreadId ? `?threadId=${encodeURIComponent(selectedThreadId)}` : "";
    const response = await fetch(`/api/ai/history${suffix}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "读取对话历史失败");
    setThreads(body.threads ?? []);
    if (selectedThreadId) {
      setThreadId(selectedThreadId);
      setHistoryMessages(body.messages ?? []);
      setAnswer("");
      setCitations([]);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai/history", { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "读取对话历史失败");
        return body;
      })
      .then((body) => setThreads(body.threads ?? []))
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "读取对话历史失败");
      });
    return () => controller.abort();
  }, [accessToken]);

  async function ask() {
    const value = question.trim();
    if (!value || isAsking) return;
    setAnswer("");
    setCitations([]);
    setError(null);
    setIsAsking(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ question: value, threadId }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "AI 检索失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const name = block.match(/^event: (.+)$/m)?.[1];
          const raw = block.match(/^data: (.+)$/m)?.[1];
          if (!name || !raw) continue;
          const data = JSON.parse(raw);
          if (name === "meta") {
            setThreadId(data.threadId);
            setCitations(data.citations ?? []);
          } else if (name === "token") {
            setAnswer((current) => current + String(data));
          } else if (name === "error") {
            throw new Error(data.message || "AI 回答失败");
          }
        }
      }
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 检索失败");
    } finally {
      setIsAsking(false);
    }
  }

  async function handleSuggestion(id: string, action: "accept" | "reject") {
    setBusySuggestionId(id);
    setError(null);
    try {
      const response = await fetch(`/api/ai/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "处理建议失败");
      await onSuggestionHandled();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "处理建议失败");
    } finally {
      setBusySuggestionId(null);
    }
  }

  async function handleAllSuggestions(action: "accept" | "reject") {
    if (suggestions.length === 0) return;
    setBusySuggestionId("all");
    setError(null);
    try {
      for (const suggestion of suggestions) {
        const response = await fetch(`/api/ai/suggestions/${suggestion.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ action }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "批量处理建议失败");
      }
      await onSuggestionHandled();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量处理建议失败");
      await onSuggestionHandled();
    } finally {
      setBusySuggestionId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm" onMouseDown={onClose}>
      <aside className="flex h-[100dvh] w-full max-w-xl flex-col border-l border-[var(--line)] bg-[var(--surface)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--ink)] text-white"><Sparkles size={17} /></div>
            <div><h2 className="font-semibold">Echo AI</h2><p className="text-xs text-[var(--muted)]">只依据你的消息回答，并附原文引用</p></div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭 AI 面板"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section>
            <label className="text-sm font-semibold">问历史消息</label>
            <div className="mt-3 flex gap-2">
              <textarea className="min-h-24 flex-1 resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm outline-none focus:border-[var(--accent)]" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：上个月保存的 Docker 命令是什么？" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask(); }} />
              <button className="grid h-11 w-11 place-items-center self-end rounded-xl bg-[var(--ink)] text-white disabled:opacity-50" onClick={() => void ask()} disabled={!question.trim() || isAsking} aria-label="开始检索"><Search size={18} /></button>
            </div>
            {isAsking && !answer ? <div className="mt-4 h-20 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /> : null}
            {answer ? <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 text-sm leading-7">{answer}</div> : null}
            {citations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {citations.map((citation) => <button key={citation.noteId} onClick={() => onOpenNote(citation.noteId)} className="max-w-full truncate rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-left text-xs text-[var(--muted)] hover:text-[var(--ink)]">[{citation.index}] {citation.excerpt || new Date(citation.createdAt).toLocaleString("zh-CN")}</button>)}
              </div>
            ) : null}
            {historyMessages.length > 0 ? <div className="mt-4 space-y-3 rounded-2xl border border-[var(--line)] p-3">{historyMessages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-8 rounded-xl bg-[var(--ink)] p-3 text-sm text-white" : "mr-8 rounded-xl bg-[var(--surface-muted)] p-3 text-sm leading-6"}><p className="whitespace-pre-wrap">{message.content}</p>{message.role === "assistant" && message.citation_note_ids.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.citation_note_ids.map((noteId, index) => <button key={noteId} className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--muted)]" onClick={() => onOpenNote(noteId)}>引用 {index + 1}</button>)}</div> : null}</div>)}</div> : null}
          </section>

          <section className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">最近对话</h3>{threadId ? <button className="text-xs text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => { setThreadId(null); setHistoryMessages([]); setAnswer(""); setCitations([]); }}>新对话</button> : null}</div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{threads.length === 0 ? <span className="text-xs text-[var(--muted)]">还没有历史问答</span> : threads.map((thread) => <button key={thread.id} className={`max-w-48 flex-none truncate rounded-lg border px-3 py-2 text-left text-xs ${thread.id === threadId ? "border-[var(--ink)] bg-[var(--surface-muted)]" : "border-[var(--line)]"}`} onClick={() => void loadHistory(thread.id).catch((caught) => setError(caught instanceof Error ? caught.message : "读取对话历史失败"))}>{thread.title}</button>)}</div>
          </section>

          <section className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold">整理建议</h3><span className="text-xs text-[var(--muted)]">{suggestions.length} 条待确认</span></div>
              {suggestions.length > 1 ? <div className="flex gap-2"><button className="rounded-lg bg-[var(--ink)] px-3 py-2 text-xs text-white disabled:opacity-50" disabled={busySuggestionId !== null} onClick={() => void handleAllSuggestions("accept")}>全部采用</button><button className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-50" disabled={busySuggestionId !== null} onClick={() => void handleAllSuggestions("reject")}>全部忽略</button></div> : null}
            </div>
            <div className="mt-3 space-y-3">
              {suggestions.length === 0 ? <p className="rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">新消息生成的摘要、标签和文件夹建议会出现在这里。</p> : suggestions.map((item) => (
                <article key={item.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <button className="text-left text-sm font-medium leading-6 hover:underline" onClick={() => onOpenNote(item.note_id)}>{item.summary}</button>
                  <div className="mt-3 flex flex-wrap gap-1.5">{item.suggested_folder ? <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs">{item.suggested_folder}</span> : null}{item.suggested_tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs">#{tag}</span>)}</div>
                  {item.reason ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{item.reason}</p> : null}
                  <div className="mt-4 flex gap-2"><button className="inline-flex items-center gap-1 rounded-lg bg-[var(--ink)] px-3 py-2 text-xs text-white disabled:opacity-50" disabled={busySuggestionId !== null} onClick={() => void handleSuggestion(item.id, "accept")}><Check size={14} />采用</button><button className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-50" disabled={busySuggestionId !== null} onClick={() => void handleSuggestion(item.id, "reject")}><X size={14} />忽略</button></div>
                </article>
              ))}
            </div>
          </section>
          {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
        </div>
      </aside>
    </div>
  );
}
