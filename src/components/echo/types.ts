export type FolderItem = {
  id: string;
  name: string;
};

export type TagItem = {
  id: string;
  name: string;
  color: string | null;
};

export type AutoTagMatchType = "contains" | "regex" | "url" | "phone" | "min_length" | "line_breaks";

export type Note = {
  id: string;
  content: string;
  createdAt: string;
  folderId: string | null;
  folderName: string | null;
  tags: TagItem[];
  isStarred: boolean;
  isArchived: boolean;
  filePath: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
};

export type AutoTagRule = {
  id: string;
  matchType: AutoTagMatchType;
  matchValue: string;
  priority: number;
  tagId: string;
  tag: TagItem;
};

export type AutoTagRuleRow = {
  id: string;
  match_type: AutoTagMatchType;
  match_value: string | null;
  priority: number;
  tag_id: string;
  tag: TagItem | TagItem[] | null;
};

export type NoteRow = {
  id: string;
  content: string;
  created_at: string;
  folder_id?: string | null;
  deleted_at?: string | null;
  is_starred?: boolean;
  is_archived?: boolean;
  file_path?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
};

export type NoteTagRow = {
  note_id: string;
  tag: TagItem | TagItem[] | null;
};

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
