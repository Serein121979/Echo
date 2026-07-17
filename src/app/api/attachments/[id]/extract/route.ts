import { NextResponse } from "next/server";
import { requireUser } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;

function stripXml(value: string) {
  return value.replace(/<a:br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function extractBuffer(buffer: Buffer, fileType: string, fileName: string) {
  const type = fileType.toLowerCase();
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (type.startsWith("text/") || ["md", "json", "csv", "log", "txt"].includes(extension ?? "")) return buffer.toString("utf8");
  if (type === "application/pdf" || extension === "pdf") {
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return result.text;
  }
  if (extension === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer })).value;
  }
  if (extension === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    return workbook.worksheets.map((sheet) => {
      const lines: string[] = [sheet.name];
      sheet.eachRow((row) => lines.push(row.values instanceof Array ? row.values.slice(1).map((cell) => String(cell ?? "")).join("\t") : ""));
      return lines.join("\n");
    }).join("\n\n");
  }
  if (extension === "pptx") {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
    return (await Promise.all(slides.map(async (name) => stripXml(await zip.files[name].async("text"))))).join("\n\n");
  }
  if (type.startsWith("image/")) {
    const { recognize } = await import("tesseract.js");
    return (await recognize(buffer, "chi_sim+eng")).data.text;
  }
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { id } = await context.params;
    const { data: attachment, error } = await supabase.from("attachments").select("*").eq("id", id).eq("user_id", user.id).single();
    if (error || !attachment) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
    if (attachment.file_size > MAX_EXTRACT_BYTES) {
      await supabase.from("attachments").update({ extraction_status: "unsupported", extraction_error: "AI 提取仅支持 25MB 以内的附件" }).eq("id", id);
      return NextResponse.json({ status: "unsupported" });
    }

    await supabase.from("attachments").update({ extraction_status: "processing", extraction_error: null }).eq("id", id);
    const { data: file, error: downloadError } = await supabase.storage.from("echo-files").download(attachment.storage_path);
    if (downloadError) throw downloadError;
    const text = await extractBuffer(Buffer.from(await file.arrayBuffer()), attachment.file_type, attachment.file_name);
    if (text === null) {
      await supabase.from("attachments").update({ extraction_status: "unsupported" }).eq("id", id);
      return NextResponse.json({ status: "unsupported" });
    }
    await supabase.from("attachments").update({ extraction_status: "ready", extracted_text: text.slice(0, 200000), extraction_error: null }).eq("id", id);
    return NextResponse.json({ status: "ready", characters: text.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "附件解析失败";
    try {
      const { supabase } = await requireUser(request);
      const { id } = await context.params;
      await supabase.from("attachments").update({ extraction_status: "failed", extraction_error: message.slice(0, 500) }).eq("id", id);
    } catch {}
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "请先登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
