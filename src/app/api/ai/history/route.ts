import { requireUser } from "@/utils/supabase/server";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId");

    const { data: threads, error: threadError } = await supabase
      .from("ai_threads")
      .select("id, title, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (threadError) throw threadError;

    let messages: Array<Record<string, unknown>> = [];
    if (threadId) {
      const ownsThread = threads?.some((thread) => thread.id === threadId);
      if (!ownsThread) return Response.json({ error: "对话不存在" }, { status: 404 });
      const { data, error } = await supabase
        .from("ai_messages")
        .select("id, role, content, citation_note_ids, created_at")
        .eq("user_id", user.id)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      messages = data ?? [];
    }

    return Response.json({ threads: threads ?? [], messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取对话历史失败";
    return Response.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
