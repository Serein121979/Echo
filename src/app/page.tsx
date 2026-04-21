"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabase/client";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Send } from "lucide-react";

type Note = {
  id: string;
  content: string;
  created_at: string;
};

const FETCH_TIMEOUT_MS = 8000;

export default function Home() {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      setError(null);
      console.log("开始获取数据...");
      const request = supabase
        .from("notes")
        .select("id, content, created_at")
        .order("created_at", { ascending: true });

      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("加载超时，请检查网络或 Supabase 配置"));
        }, FETCH_TIMEOUT_MS);
      });

      const { data, error } = await Promise.race([request, timeout]);

      if (error) {
        console.error("获取数据失败:", error);
        setNotes([]);
        setError(error.message);
        return;
      }

      console.log("获取数据成功:", data?.length || 0, "条记录");
      setNotes(data || []);
    } catch (error) {
      console.error("获取数据异常:", error);
      setNotes([]);
      setError(error instanceof Error ? error.message : "加载失败，请稍后重试");
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setIsLoading(false);
    }
  };

  // 页面加载时获取数据
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      console.log("组件挂载，开始获取初始数据");
      void fetchNotes();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  // 设置轮询：每5秒获取一次最新数据，实现多设备同步
  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchNotes();
    }, 5000); // 每5秒轮询一次
    return () => clearInterval(intervalId); // 组件卸载时清理
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    setIsSending(true);
    const content = input.trim();

    try {
      // 插入数据到Supabase
      const { error } = await supabase
        .from("notes")
        .insert([{ content }]);

      if (error) {
        console.error("插入数据失败:", error);
        return;
      }

      // 清空输入框
      setInput("");
      
      // 立即获取最新数据（不需要等待轮询）
      await fetchNotes();
    } catch (error) {
      console.error("发送失败:", error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black font-sans">
      {/* 顶部标题栏 */}
      <header className="sticky top-0 z-10 backdrop-blur-md bg-white/80 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Echo
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                极简跨端云端剪贴板
              </p>
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500">
              在线 · 多设备同步
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* 消息列表 */}
        <div className="space-y-6 mb-24">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-500">加载中...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-500">{error}</p>
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">还没有任何消息，开始发送第一条吧！</p>
            </div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="group">
                <div className="flex gap-3">
                  {/* 头像/图标 */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                    <span className="text-white text-xs font-medium">E</span>
                  </div>
                  
                  {/* 消息气泡 */}
                  <div className="flex-1">
                    <div className="inline-block max-w-[85%]">
                      <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700 group-hover:shadow-md transition-shadow">
                        <p className="text-gray-800 dark:text-gray-200 text-base leading-relaxed whitespace-pre-wrap break-words">
                          {note.content}
                        </p>
                      </div>
                      <div className="mt-2 px-1">
                        <time className="text-xs text-gray-400 dark:text-gray-500">
                          {format(new Date(note.created_at), "HH:mm", { locale: zhCN })}
                        </time>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 输入区域 - 固定在底部 */}
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
            <div className="flex gap-3">
              {/* 输入框 */}
              <div className="flex-1">
                <div className="relative">
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
                      target.style.height = target.scrollHeight + "px";
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 px-1">
                  支持纯文本 · 自动同步到云端 · 多设备实时同步
                </p>
              </div>

              {/* 发送按钮 */}
              <div className="flex items-end">
                <button
                  className="h-[44px] px-5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-medium flex items-center gap-2 hover:from-blue-700 hover:to-purple-700 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                  onClick={handleSend}
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
      </main>
    </div>
  );
}
