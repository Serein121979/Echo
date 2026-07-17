import { NextResponse } from "next/server";
import { requireUser } from "@/utils/supabase/server";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

function redirect(request: Request, state: "shared" | "signin" | "error") {
  return NextResponse.redirect(new URL(`/?share=${state}`, request.url), 303);
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const form = await request.formData();
    const content = [stringValue(form.get("title")), stringValue(form.get("text")), stringValue(form.get("url"))].filter(Boolean).join("\n");
    const files = [...form.getAll("file"), ...form.getAll("files")].filter((item): item is File => item instanceof File && item.size > 0);
    if (!content && files.length === 0) return redirect(request, "error");
    if (files.some((file) => file.size > MAX_FILE_SIZE)) return redirect(request, "error");

    const { data: note, error: noteError } = await supabase.from("notes").insert({ user_id: user.id, content, source_platform: "share-target" }).select("id").single();
    if (noteError) throw noteError;
    for (const file of files) {
      const suffix = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
      const path = `${user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${suffix}`;
      const { error: uploadError } = await supabase.storage.from("echo-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadError) throw uploadError;
      const { error: attachmentError } = await supabase.from("attachments").insert({ user_id: user.id, note_id: note.id, storage_path: path, file_name: file.name, file_type: file.type || "application/octet-stream", file_size: file.size });
      if (attachmentError) throw attachmentError;
    }
    return redirect(request, "shared");
  } catch (error) {
    console.error("POST /share failed", error);
    return redirect(request, error instanceof Error && error.message === "UNAUTHORIZED" ? "signin" : "error");
  }
}
