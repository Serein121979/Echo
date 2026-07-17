import { NextResponse } from "next/server";
import { requireUser } from "@/utils/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { id } = await context.params;
    const { data: attachment, error } = await supabase
      .from("attachments")
      .select("storage_path, file_name")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (error || !attachment) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
    const { data, error: signError } = await supabase.storage
      .from("echo-files")
      .createSignedUrl(attachment.storage_path, 300, { download: attachment.file_name });
    if (signError) throw signError;
    return NextResponse.json({ url: data.signedUrl, expiresIn: 300 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成下载链接失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
