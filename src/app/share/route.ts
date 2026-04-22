import { NextResponse } from "next/server";
import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";

const STORAGE_BUCKET = "echo-files";

function redirectHome(request: Request) {
  return NextResponse.redirect(new URL("/", request.url), 303);
}

function getString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getShareContent(title: string, text: string, url: string) {
  const parts = [text, url].filter(Boolean);

  if (parts.length > 0) {
    return parts.join("\n");
  }

  return title;
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex);
}

function collectSharedFiles(formData: FormData) {
  const entries = [...formData.getAll("file"), ...formData.getAll("files")];
  return entries.filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

async function uploadSharedFile(file: File) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
  }

  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${getFileExtension(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
    upsert: false,
  });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  return {
    file_path: path,
    file_url: data.publicUrl,
    file_name: file.name,
    file_type: file.type || "application/octet-stream",
    file_size: file.size,
  };
}

async function insertSharedNote(payload: {
  content: string;
  file_path?: string;
  file_url?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
}) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
  }

  const { error } = await supabase.from("notes").insert([
    {
      content: payload.content,
      folder_id: null,
      ...(payload.file_path ? { file_path: payload.file_path } : {}),
      ...(payload.file_url ? { file_url: payload.file_url } : {}),
      ...(payload.file_name ? { file_name: payload.file_name } : {}),
      ...(payload.file_type ? { file_type: payload.file_type } : {}),
      ...(typeof payload.file_size === "number" ? { file_size: payload.file_size } : {}),
    },
  ]);

  if (error) {
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const title = getString(formData.get("title"));
    const text = getString(formData.get("text"));
    const url = getString(formData.get("url"));
    const sharedFiles = collectSharedFiles(formData);
    const content = getShareContent(title, text, url);

    if (sharedFiles.length === 0) {
      await insertSharedNote({ content });
      return redirectHome(request);
    }

    for (const file of sharedFiles) {
      const attachment = await uploadSharedFile(file);
      await insertSharedNote({
        content,
        ...attachment,
      });
    }
  } catch (error) {
    console.error("POST /share failed", error);
  }

  return redirectHome(request);
}
