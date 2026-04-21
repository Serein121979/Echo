import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";
import type {
  AutoTagMatchType,
  AutoTagRule,
  AutoTagRuleRow,
  FolderItem,
  NoteRow,
  NoteTagRow,
  TagItem,
} from "./types";

export const FETCH_TIMEOUT_MS = 8000;
export const FALLBACK_POLL_MS = 60000;
export const STORAGE_BUCKET = "echo-files";
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const TAG_COLORS = {
  待办: "#f97316",
  链接: "#2563eb",
  代码: "#7c3aed",
  清单: "#16a34a",
  长文: "#db2777",
  电话: "#0f766e",
} as const;

export const DEFAULT_AUTO_TAG_RULES = [
  { tagName: "链接", matchType: "url", matchValue: "", priority: 100 },
  { tagName: "待办", matchType: "contains", matchValue: "todo", priority: 100 },
  { tagName: "待办", matchType: "contains", matchValue: "待办", priority: 90 },
  { tagName: "待办", matchType: "contains", matchValue: "待处理", priority: 80 },
  { tagName: "待办", matchType: "contains", matchValue: "follow up", priority: 70 },
  { tagName: "待办", matchType: "contains", matchValue: "follow-up", priority: 60 },
  {
    tagName: "代码",
    matchType: "regex",
    matchValue: "```|function |const |let |var |=>|class |import |export ",
    priority: 100,
  },
  { tagName: "清单", matchType: "regex", matchValue: "^[-*]\\s", priority: 100 },
  { tagName: "清单", matchType: "line_breaks", matchValue: "2", priority: 90 },
  { tagName: "长文", matchType: "min_length", matchValue: "120", priority: 100 },
  { tagName: "电话", matchType: "phone", matchValue: "", priority: 100 },
] as const satisfies ReadonlyArray<{
  tagName: keyof typeof TAG_COLORS;
  matchType: AutoTagMatchType;
  matchValue: string;
  priority: number;
}>;

export const FALLBACK_AUTO_TAG_NAMES = Array.from(
  new Set(DEFAULT_AUTO_TAG_RULES.map((rule) => rule.tagName)),
);

export const MATCH_TYPE_OPTIONS: Array<{ value: AutoTagMatchType; label: string; hint: string }> = [
  { value: "contains", label: "关键词", hint: "包含指定文本时命中" },
  { value: "regex", label: "正则", hint: "使用正则表达式匹配" },
  { value: "url", label: "链接", hint: "内容里出现 URL 时命中" },
  { value: "phone", label: "电话", hint: "内容里出现手机号时命中" },
  { value: "min_length", label: "最短字数", hint: "内容长度达到阈值时命中" },
  { value: "line_breaks", label: "换行数", hint: "换行数达到阈值时命中" },
];

export type FetchNotesResult = {
  data: NoteRow[];
  error: { code?: string; message: string } | null;
  supportsSoftDelete: boolean;
  supportsServerSearch: boolean;
};

export function isMissingTableError(code?: string) {
  return code === "42P01";
}

export function isMissingColumnError(code?: string) {
  return code === "42703";
}

export function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export function getTagColor(name: string, currentCount: number) {
  const direct = TAG_COLORS[name as keyof typeof TAG_COLORS];

  if (direct) {
    return direct;
  }

  const palette = ["#111111", "#262626", "#404040", "#525252", "#737373"];
  return palette[currentCount % palette.length];
}

export function getRuleHelperText(matchType: AutoTagMatchType) {
  return MATCH_TYPE_OPTIONS.find((option) => option.value === matchType)?.hint ?? "";
}

export function getRuleInputPlaceholder(matchType: AutoTagMatchType) {
  switch (matchType) {
    case "contains":
      return "例如：待办";
    case "regex":
      return "例如：^[-*]\\s";
    case "min_length":
      return "例如：120";
    case "line_breaks":
      return "例如：2";
    case "url":
    case "phone":
      return "此类型无需填写";
    default:
      return "";
  }
}

export function requiresMatchValue(matchType: AutoTagMatchType) {
  return matchType === "contains" || matchType === "regex" || matchType === "min_length" || matchType === "line_breaks";
}

export function parseRuleNumber(value: string) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function matchesAutoTagRule(
  content: string,
  rule:
    | Pick<AutoTagRule, "matchType" | "matchValue">
    | {
        matchType: AutoTagMatchType;
        matchValue: string;
      },
) {
  const text = content.trim();

  switch (rule.matchType) {
    case "contains":
      return rule.matchValue.length > 0 && text.toLowerCase().includes(rule.matchValue.toLowerCase());
    case "regex":
      if (!rule.matchValue) {
        return false;
      }

      try {
        return new RegExp(rule.matchValue, "im").test(text);
      } catch {
        return false;
      }
    case "url":
      return /https?:\/\//i.test(text);
    case "phone":
      return /\b1\d{10}\b/.test(text);
    case "min_length": {
      const threshold = parseRuleNumber(rule.matchValue);
      return threshold !== null && text.length >= threshold;
    }
    case "line_breaks": {
      const threshold = parseRuleNumber(rule.matchValue);
      return threshold !== null && (text.match(/\n/g) ?? []).length >= threshold;
    }
    default:
      return false;
  }
}

export function inferAutoTags(content: string, rules: AutoTagRule[]) {
  const next = new Set<string>();

  for (const rule of rules) {
    if (matchesAutoTagRule(content, rule)) {
      next.add(rule.tag.name);
    }
  }

  return Array.from(next);
}

export function formatFileSize(size: number | null) {
  if (!size || size <= 0) {
    return null;
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildDownloadUrl(url: string, fileName: string | null) {
  if (!fileName) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}download=${encodeURIComponent(fileName)}`;
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
}

function buildNotesQuery(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  selectClause: string,
  searchQuery: string,
  enableServerSearch: boolean,
) {
  let query = supabase.from("notes").select(selectClause).order("created_at", { ascending: true });

  if (selectClause.includes("deleted_at")) {
    query = query.is("deleted_at", null);
  }

  if (enableServerSearch && searchQuery) {
    query = query.textSearch("fts", searchQuery, { config: "simple", type: "plain" });
  }

  return query;
}

function asNoteRows(data: unknown) {
  return (data ?? []) as NoteRow[];
}

export async function fetchNotes(searchQuery: string): Promise<FetchNotesResult> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      data: [],
      error: { message: supabaseConfigError ?? "Supabase 客户端初始化失败" },
      supportsSoftDelete: false,
      supportsServerSearch: false,
    };
  }

  const normalizedSearch = searchQuery.trim();
  const latestShape = await buildNotesQuery(
    supabase,
    "id, content, created_at, folder_id, deleted_at, is_starred, is_archived, file_path, file_url, file_name, file_type, file_size",
    normalizedSearch,
    normalizedSearch.length > 0,
  );

  if (!latestShape.error) {
    return {
      data: asNoteRows(latestShape.data),
      error: null,
      supportsSoftDelete: true,
      supportsServerSearch: true,
    };
  }

  if (!isMissingColumnError(latestShape.error.code)) {
    return {
      data: [],
      error: latestShape.error,
      supportsSoftDelete: false,
      supportsServerSearch: false,
    };
  }

  const withoutSearchVector = await buildNotesQuery(
    supabase,
    "id, content, created_at, folder_id, deleted_at, is_starred, is_archived, file_path, file_url, file_name, file_type, file_size",
    normalizedSearch,
    false,
  );

  if (!withoutSearchVector.error) {
    return {
      data: asNoteRows(withoutSearchVector.data),
      error: null,
      supportsSoftDelete: true,
      supportsServerSearch: false,
    };
  }

  if (!isMissingColumnError(withoutSearchVector.error.code)) {
    return {
      data: [],
      error: withoutSearchVector.error,
      supportsSoftDelete: false,
      supportsServerSearch: false,
    };
  }

  const folderShape = await supabase
    .from("notes")
    .select("id, content, created_at, folder_id")
    .order("created_at", { ascending: true });

  if (!folderShape.error) {
    return {
      data: asNoteRows(folderShape.data),
      error: null,
      supportsSoftDelete: false,
      supportsServerSearch: false,
    };
  }

  if (!isMissingColumnError(folderShape.error.code)) {
    return {
      data: [],
      error: folderShape.error,
      supportsSoftDelete: false,
      supportsServerSearch: false,
    };
  }

  const legacyShape = await supabase
    .from("notes")
    .select("id, content, created_at")
    .order("created_at", { ascending: true });

  return {
    data: asNoteRows(legacyShape.data).map((note) => ({
      ...note,
      folder_id: null,
      is_starred: false,
      is_archived: false,
      file_path: null,
      file_url: null,
      file_name: null,
      file_type: null,
      file_size: null,
    })),
    error: legacyShape.error,
    supportsSoftDelete: false,
    supportsServerSearch: false,
  };
}

export async function fetchFolders() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      data: [] as FolderItem[],
      error: { message: supabaseConfigError ?? "Supabase 客户端初始化失败" },
      enabled: false,
    };
  }

  const result = await supabase
    .from("folders")
    .select("id, name")
    .order("created_at", { ascending: true });

  if (result.error && isMissingTableError(result.error.code)) {
    return {
      data: [] as FolderItem[],
      error: null,
      enabled: false,
    };
  }

  return {
    data: (result.data ?? []) as FolderItem[],
    error: result.error,
    enabled: !result.error,
  };
}

export async function fetchNoteTags() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      data: [] as NoteTagRow[],
      error: { message: supabaseConfigError ?? "Supabase 客户端初始化失败" },
      enabled: false,
    };
  }

  const result = await supabase
    .from("note_tags")
    .select("note_id, tag:tags(id, name, color)");

  if (result.error && isMissingTableError(result.error.code)) {
    return {
      data: [] as NoteTagRow[],
      error: null,
      enabled: false,
    };
  }

  return {
    data: (result.data ?? []) as NoteTagRow[],
    error: result.error,
    enabled: !result.error,
  };
}

export async function fetchTags() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      data: [] as TagItem[],
      error: { message: supabaseConfigError ?? "Supabase 客户端初始化失败" },
      enabled: false,
    };
  }

  const result = await supabase
    .from("tags")
    .select("id, name, color")
    .order("created_at", { ascending: true });

  if (result.error && isMissingTableError(result.error.code)) {
    return {
      data: [] as TagItem[],
      error: null,
      enabled: false,
    };
  }

  return {
    data: (result.data ?? []) as TagItem[],
    error: result.error,
    enabled: !result.error,
  };
}

export async function fetchAutoTagRules() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      data: [] as AutoTagRuleRow[],
      error: { message: supabaseConfigError ?? "Supabase 客户端初始化失败" },
      enabled: false,
    };
  }

  const result = await supabase
    .from("auto_tag_rules")
    .select("id, match_type, match_value, priority, tag_id, tag:tags(id, name, color)")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (result.error && isMissingTableError(result.error.code)) {
    return {
      data: [] as AutoTagRuleRow[],
      error: null,
      enabled: false,
    };
  }

  return {
    data: (result.data ?? []) as AutoTagRuleRow[],
    error: result.error,
    enabled: !result.error,
  };
}
