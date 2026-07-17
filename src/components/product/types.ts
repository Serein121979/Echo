export type AttachmentRecord = {
  id: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  upload_status: "uploading" | "ready" | "failed";
  extraction_status: "pending" | "processing" | "ready" | "unsupported" | "failed";
};

export type ProductNote = {
  id: string;
  content: string;
  summary: string | null;
  ai_status: "pending" | "processing" | "ready" | "failed";
  folder_id: string | null;
  source_platform: string;
  created_at: string;
  is_starred: boolean;
  is_archived: boolean;
  attachments: AttachmentRecord[];
  tags: Array<{ id: string; name: string; color: string }>;
};

export type AiSuggestion = {
  id: string;
  note_id: string;
  summary: string;
  suggested_tags: string[];
  suggested_folder: string | null;
  confidence: number;
  reason: string | null;
};
