import { NextResponse } from "next/server";
import { requireUser } from "@/utils/supabase/server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { id } = await context.params;
    const { action } = await request.json();
    if (action !== "accept" && action !== "reject") return NextResponse.json({ error: "操作无效" }, { status: 400 });
    const { data: suggestion, error } = await supabase.from("ai_suggestions").select("*").eq("id", id).eq("user_id", user.id).eq("status", "pending").single();
    if (error || !suggestion) return NextResponse.json({ error: "建议不存在或已处理" }, { status: 404 });

    if (action === "accept") {
      let folderId: string | null = null;
      if (suggestion.suggested_folder) {
        const { data: folder } = await supabase.from("folders").select("id").eq("user_id", user.id).eq("name", suggestion.suggested_folder).maybeSingle();
        folderId = folder?.id ?? null;
      }
      await supabase.from("notes").update({ summary: suggestion.summary, ...(folderId ? { folder_id: folderId } : {}) }).eq("id", suggestion.note_id).eq("user_id", user.id);
      for (const rawName of suggestion.suggested_tags ?? []) {
        const name = String(rawName).trim().slice(0, 40);
        if (!name) continue;
        let { data: tag } = await supabase.from("tags").select("id").eq("user_id", user.id).ilike("name", name).maybeSingle();
        if (!tag) {
          const created = await supabase.from("tags").insert({ user_id: user.id, name }).select("id").single();
          tag = created.data;
        }
        if (tag) await supabase.from("note_tags").upsert({ user_id: user.id, note_id: suggestion.note_id, tag_id: tag.id });
      }
    }

    const { error: updateError } = await supabase.from("ai_suggestions").update({ status: action === "accept" ? "accepted" : "rejected", decided_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理建议失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
