import { NextResponse } from "next/server";
import { deepSeekJson } from "@/utils/deepseek";
import { requireUser } from "@/utils/supabase/server";

export const maxDuration = 120;

type Suggestion = { summary: string; tags: string[]; folder: string | null; confidence: number; reason: string };

export async function POST(request: Request) {
  let activeNoteId: string | null = null;
  try {
    const { supabase, user } = await requireUser(request);
    const { noteId } = await request.json();
    if (typeof noteId !== "string") return NextResponse.json({ error: "noteId 无效" }, { status: 400 });
    activeNoteId = noteId;
    await supabase.from("notes").update({ ai_status: "processing" }).eq("id", noteId).eq("user_id", user.id);

    const { data: note, error } = await supabase
      .from("notes")
      .select("id, content, attachments(file_name, file_type, extracted_text)")
      .eq("id", noteId)
      .eq("user_id", user.id)
      .single();
    if (error || !note) return NextResponse.json({ error: "消息不存在" }, { status: 404 });

    const { data: folders } = await supabase.from("folders").select("name").eq("user_id", user.id);
    const source = [note.content, ...(note.attachments ?? []).map((item: { file_name: string; extracted_text: string | null }) => `${item.file_name}\n${item.extracted_text ?? ""}`)]
      .join("\n\n")
      .slice(0, 30000);
    const result = await deepSeekJson<Suggestion>([
      { role: "system", content: "你是私人信息收件箱的整理助手。只依据输入生成 JSON，格式为 {\"summary\":string,\"tags\":string[],\"folder\":string|null,\"confidence\":number,\"reason\":string}。摘要不超过60字，标签最多5个。不得建议删除或归档。folder 只能来自给定文件夹。" },
      { role: "user", content: `可用文件夹：${(folders ?? []).map((item) => item.name).join("、") || "收件箱"}\n\n待整理内容：\n${source || "（仅附件）"}` },
    ]);

    const payload = {
      user_id: user.id,
      note_id: noteId,
      summary: String(result.summary || "").slice(0, 500),
      suggested_tags: Array.isArray(result.tags) ? result.tags.map(String).slice(0, 5) : [],
      suggested_folder: result.folder ? String(result.folder) : null,
      confidence: Math.min(1, Math.max(0, Number(result.confidence) || 0)),
      reason: String(result.reason || "").slice(0, 500),
      status: "pending",
    };
    await supabase.from("ai_suggestions").delete().eq("note_id", noteId).eq("status", "pending");
    const { data, error: insertError } = await supabase.from("ai_suggestions").insert(payload).select().single();
    if (insertError) throw insertError;
    await supabase.from("notes").update({ ai_status: "ready" }).eq("id", noteId).eq("user_id", user.id);
    return NextResponse.json({ suggestion: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成整理建议失败";
    if (activeNoteId) {
      try {
        const { supabase, user } = await requireUser(request);
        await supabase.from("notes").update({ ai_status: "failed" }).eq("id", activeNoteId).eq("user_id", user.id);
      } catch {}
    }
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
