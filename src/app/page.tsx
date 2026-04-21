"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/utils/supabase/client";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Folder, Send } from "lucide-react";

type FolderItem = {
  id: string;
  name: string;
};

type TagItem = {
  id: string;
  name: string;
  color: string | null;
};

type NoteRow = {
  id: string;
  content: string;
  created_at: string;
  folder_id?: string | null;
};

type NoteTagRow = {
  note_id: string;
  tag: TagItem | TagItem[] | null;
};

type Note = {
  id: string;
  content: string;
  createdAt: string;
  folderId: string | null;
  folderName: string | null;
  tags: TagItem[];
};

const FETCH_TIMEOUT_MS = 8000;
const FALLBACK_POLL_MS = 60000;

function isMissingTableError(code?: string) {
  return code === "42P01";
}

function isMissingColumnError(code?: string) {
  return code === "42703";
}

async function fetchNotes() {
  const nextShape = await supabase
    .from("notes")
    .select("id, content, created_at, folder_id")
    .order("created_at", { ascending: true });

  if (!nextShape.error) {
    return {
      data: (nextShape.data ?? []) as NoteRow[],
      error: null,
    };
  }

  if (!isMissingColumnError(nextShape.error.code)) {
    return {
      data: [] as NoteRow[],
      error: nextShape.error,
    };
  }

  const legacyShape = await supabase
    .from("notes")
    .select("id, content, created_at")
    .order("created_at", { ascending: true });

  return {
    data: ((legacyShape.data ?? []) as NoteRow[]).map((note) => ({
      ...note,
      folder_id: null,
    })),
    error: legacyShape.error,
  };
}

async function fetchFolders() {
  const result = await supabase
    .from("folders")
    .select("id, name")
    .order("created_at", { ascending: true });

  if (result.error && isMissingTableError(result.error.code)) {
    return {
      data: [] as FolderItem[],
      error: null,
      enabled: false,
    };
  }

  return {
    data: (result.data ?? []) as FolderItem[],
    error: result.error,
    enabled: !result.error,
  };
}

async function fetchNoteTags() {
  const result = await supabase
    .from("note_tags")
    .select("note_id, tag:tags(id, name, color)");

  if (result.error && isMissingTableError(result.error.code)) {
    return {
      data: [] as NoteTagRow[],
      error: null,
      enabled: false,
    };
  }

  return {
    data: (result.data ?? []) as NoteTagRow[],
    error: result.error,
    enabled: !result.error,
  };
}

export default function Home() {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState("轮询兜底中");
  const [supportsFolders, setSupportsFolders] = useState(false);
  const [supportsTags, setSupportsTags] = useState(false);

  const fetchAppData = useCallback(async (showLoading = false) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      if (showLoading) {
        setIsLoading(true);
      }

      setError(null);
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("加载超时，请检查网络或 Supabase 配置"));
        }, FETCH_TIMEOUT_MS);
      });

      const request = Promise.all([fetchNotes(), fetchFolders(), fetchNoteTags()]);
      const [notesResult, foldersResult, noteTagsResult] = await Promise.race([
        request,
        timeout,
      ]);

      if (notesResult.error) {
        throw notesResult.error;
      }

      if (foldersResult.error) {
        throw foldersResult.error;
      }

      if (noteTagsResult.error) {
        throw noteTagsResult.error;
      }

      const nextFolders = foldersResult.data;
      const folderMap = new Map(nextFolders.map((folder) => [folder.id, folder.name]));
      const tagsByNoteId = new Map<string, TagItem[]>();

      for (const row of noteTagsResult.data) {
        const rawTag = Array.isArray(row.tag) ? row.tag[0] : row.tag;

        if (!rawTag) {
          continue;
        }

        const current = tagsByNoteId.get(row.note_id) ?? [];
        current.push(rawTag);
        tagsByNoteId.set(row.note_id, current);
      }

      setFolders(nextFolders);
      setSupportsFolders(foldersResult.enabled);
      setSupportsTags(noteTagsResult.enabled);
      setNotes(
        notesResult.data.map((note) => ({
          id: note.id,
          content: note.content,
          createdAt: note.created_at,
          folderId: note.folder_id ?? null,
          folderName: note.folder_id ? folderMap.get(note.folder_id) ?? null : null,
          tags: tagsByNoteId.get(note.id) ?? [],
        })),
      );

      setSelectedFolderId((current) => {
        if (!foldersResult.enabled || nextFolders.length === 0) {
          return "";
        }

        if (current && nextFolders.some((folder) => folder.id === current)) {
          return current;
        }

        return nextFolders[0].id;
      });

      setActiveFolderId((current) => {
        if (current === "all") {
          return current;
        }

        if (nextFolders.some((folder) => folder.id === current)) {
          return current;
        }

        return "all";
      });
    } catch (error) {
      setNotes([]);
      setFolders([]);
      setSupportsFolders(false);
      setSupportsTags(false);
      setError(error instanceof Error ? error.message : "加载失败，请稍后重试");
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchAppData(true);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [fetchAppData]);

  useEffect(() => {
    const channel = supabase
      .channel("echo-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes" },
        () => {
          void fetchAppData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "folders" },
        () => {
          void fetchAppData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tags" },
        () => {
          void fetchAppData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "note_tags" },
        () => {
          void fetchAppData();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setSyncMode("实时同步已连接");
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setSyncMode("实时同步异常，使用轮询兜底");
          return;
        }

        if (status === "CLOSED") {
          setSyncMode("连接已关闭，等待重连");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchAppData]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchAppData();
    }, FALLBACK_POLL_MS);

    return () => clearInterval(intervalId);
  }, [fetchAppData]);

  const filteredNotes = useMemo(() => {
    if (activeFolderId === "all") {
      return notes;
    }

    return notes.filter((note) => note.folderId === activeFolderId);
  }, [activeFolderId, notes]);

  const handleSend = async () => {
    if (!input.trim() || isSending) {
      return;
    }

    setIsSending(true);
    setError(null);

    const content = input.trim();
    const payload: {
      content: string;
      folder_id?: string | null;
    } = { content };

    if (supportsFolders) {
      payload.folder_id = selectedFolderId || null;
    }

    try {
      const { error } = await supabase.from("notes").insert([payload]);

      if (error) {
        throw error;
      }

      setInput("");
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "发送失败，请稍后重试");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black font-sans">
      <header className="sticky top-0 z-10 backdrop-blur-md bg-white/80 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Echo
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                极简跨端云端剪贴板
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400 dark:text-gray-500">
                {syncMode}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {supportsFolders
                  ? "已启用文件夹结构"
                  : "兼容旧表结构，可先继续使用"}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-32">
        {supportsFolders && folders.length > 0 ? (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                activeFolderId === "all"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
              }`}
              type="button"
              onClick={() => setActiveFolderId("all")}
            >
              全部
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                  activeFolderId === folder.id
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                }`}
                type="button"
                onClick={() => setActiveFolderId(folder.id)}
              >
                {folder.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="space-y-6">
          {isLoading ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <p className="mt-4 text-gray-500">加载中...</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-red-500">{error}</p>
              <button
                className="mt-4 px-4 py-2 rounded-full bg-blue-600 text-white text-sm"
                type="button"
                onClick={() => {
                  void fetchAppData(true);
                }}
              >
                重新加载
              </button>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-500">
                {activeFolderId === "all"
                  ? "还没有任何消息，开始发送第一条吧！"
                  : "这个文件夹里还没有消息。"}
              </p>
            </div>
          ) : (
            filteredNotes.map((note) => (
              <article key={note.id} className="group">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                    <span className="text-white text-xs font-medium">E</span>
                  </div>

                  <div className="flex-1">
                    <div className="inline-block max-w-[92%]">
                      <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700 group-hover:shadow-md transition-shadow">
                        <p className="text-gray-800 dark:text-gray-200 text-base leading-relaxed whitespace-pre-wrap break-words">
                          {note.content}
                        </p>

                        {(note.folderName || note.tags.length > 0) && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {note.folderName ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-600 text-xs px-2.5 py-1">
                                <Folder size={12} />
                                {note.folderName}
                              </span>
                            ) : null}

                            {note.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="rounded-full text-xs px-2.5 py-1"
                                style={{
                                  backgroundColor: `${tag.color ?? "#60a5fa"}20`,
                                  color: tag.color ?? "#2563eb",
                                }}
                              >
                                #{tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-2 px-1">
                        <time className="text-xs text-gray-400 dark:text-gray-500">
                          {format(new Date(note.createdAt), "MM-dd HH:mm", {
                            locale: zhCN,
                          })}
                        </time>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="space-y-3">
            {supportsFolders && folders.length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Folder size={16} />
                <span>发送到</span>
                <select
                  className="bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                >
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex gap-3">
              <div className="flex-1">
                <textarea
                  className="w-full px-4 py-3 pr-12 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-none min-h-[44px] max-h-32"
                  placeholder="输入文本内容..."
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height = `${target.scrollHeight}px`;
                  }}
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 px-1">
                  {supportsTags
                    ? "已预留标签结构，后续可直接接入自动标签和手动分类"
                    : "当前仍可继续收发消息，执行新 SQL 后会自动启用标签和文件夹"}
                </p>
              </div>

              <div className="flex items-end">
                <button
                  className="h-[44px] px-5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-medium flex items-center gap-2 hover:from-blue-700 hover:to-purple-700 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={!input.trim() || isSending}
                >
                  <Send size={18} />
                  <span className="hidden sm:inline">
                    {isSending ? "发送中..." : "发送"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
