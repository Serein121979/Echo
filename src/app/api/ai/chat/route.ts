import { deepSeekJson, deepSeekStream } from "@/utils/deepseek";
import { requireUser } from "@/utils/supabase/server";

export const maxDuration = 120;

type SearchPlan = {
  keywords?: string[];
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[];
  fileTypes?: string[];
  sourcePlatforms?: string[];
};
type SearchRow = { id: string; content: string; summary: string | null; created_at: string; source_platform: string; attachment_names: string[]; rank: number };

function event(name: string, data: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const body = await request.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return new Response(JSON.stringify({ error: "请输入问题" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const plan = await deepSeekJson<SearchPlan>([
      {
        role: "system",
        content: `把用户对私人消息库的问题改写为数据库检索 JSON：
{"keywords":[string],"startDate":string|null,"endDate":string|null,"tags":[string],"fileTypes":[string],"sourcePlatforms":[string]}。
keywords 输出 2-5 个短关键词，保留人名和技术名词。日期必须是 ISO 8601；endDate 是不包含的上界。fileTypes 使用 image、video、audio、pdf、docx、xlsx、pptx、zip 等简短类型。sourcePlatforms 只用 web、pwa、windows、macos、ios、android。无法确定的过滤条件用 null 或空数组。当前日期是 ${new Date().toISOString().slice(0, 10)}。不要回答问题。`,
      },
      { role: "user", content: question },
    ]);

    const terms = Array.from(new Set([question, ...(Array.isArray(plan.keywords) ? plan.keywords : [])])).slice(0, 6);
    const searchFilters = {
      search_start: typeof plan.startDate === "string" ? plan.startDate : null,
      search_end: typeof plan.endDate === "string" ? plan.endDate : null,
      search_tags: Array.isArray(plan.tags) ? plan.tags.slice(0, 10) : null,
      search_file_types: Array.isArray(plan.fileTypes) ? plan.fileTypes.slice(0, 10) : null,
      search_platforms: Array.isArray(plan.sourcePlatforms) ? plan.sourcePlatforms.slice(0, 10) : null,
    };
    const candidates = new Map<string, SearchRow>();
    for (const term of terms) {
      const { data, error } = await supabase.rpc("search_echo_notes", {
        search_query: term,
        result_limit: 20,
        ...searchFilters,
      });
      if (error) throw error;
      for (const row of (data ?? []) as SearchRow[]) {
        const current = candidates.get(row.id);
        if (!current || row.rank > current.rank) candidates.set(row.id, row);
      }
    }
    const sources = Array.from(candidates.values()).sort((a, b) => b.rank - a.rank).slice(0, 20);

    let threadId = typeof body.threadId === "string" ? body.threadId : null;
    if (threadId) {
      const { data: existingThread } = await supabase.from("ai_threads").select("id").eq("id", threadId).eq("user_id", user.id).maybeSingle();
      if (!existingThread) threadId = null;
    }
    if (!threadId) {
      const { data, error } = await supabase.from("ai_threads").insert({ user_id: user.id, title: question.slice(0, 40) }).select("id").single();
      if (error) throw error;
      threadId = data.id;
    }
    const { data: previousMessages } = await supabase
      .from("ai_messages")
      .select("role, content")
      .eq("user_id", user.id)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(12);
    const { error: userMessageError } = await supabase.from("ai_messages").insert({ user_id: user.id, thread_id: threadId, role: "user", content: question });
    if (userMessageError) throw userMessageError;

    const evidence = sources.map((item, index) => `[${index + 1}] note_id=${item.id}\n时间=${item.created_at}\n设备=${item.source_platform}\n附件=${item.attachment_names.join("、")}\n摘要=${item.summary ?? ""}\n正文=${item.content.slice(0, 2500)}`).join("\n\n");
    const upstream = await deepSeekStream([
      { role: "system", content: "你是 Echo 私人信息检索助手。只能依据提供的历史消息回答。每个事实后用 [数字] 引用来源；没有足够证据时明确说“没有找到”，不得补充常识或猜测。回答简洁、使用中文。" },
      ...((previousMessages ?? []).map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }))),
      { role: "user", content: `问题：${question}\n\n历史消息：\n${evidence || "（没有候选消息）"}` },
    ]);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const citationIds = sources.map((item) => item.id);
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(event("meta", { threadId, citations: sources.map((item, index) => ({ index: index + 1, noteId: item.id, excerpt: item.content.slice(0, 100), createdAt: item.created_at })) })));
        const reader = upstream.getReader();
        let pending = "";
        let answer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
              try {
                const parsed = JSON.parse(line.slice(6));
                const token = parsed?.choices?.[0]?.delta?.content;
                if (typeof token === "string" && token) {
                  answer += token;
                  controller.enqueue(encoder.encode(event("token", token)));
                }
              } catch {}
            }
          }
          await supabase.from("ai_messages").insert({ user_id: user.id, thread_id: threadId, role: "assistant", content: answer || "没有找到。", citation_note_ids: citationIds });
          controller.enqueue(encoder.encode(event("done", { ok: true })));
          controller.close();
        } catch (error) {
          controller.enqueue(encoder.encode(event("error", { message: error instanceof Error ? error.message : "回答生成失败" })));
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 检索失败";
    return new Response(JSON.stringify({ error: message === "UNAUTHORIZED" ? "请先登录" : message }), { status: message === "UNAUTHORIZED" ? 401 : 500, headers: { "Content-Type": "application/json" } });
  }
}
