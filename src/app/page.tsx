"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Folder, Pencil, Plus, Search, Send, Tag, Trash2, X } from "lucide-react";

type FolderItem = {
  id: string;
  name: string;
};

type TagItem = {
  id: string;
  name: string;
  color: string | null;
};

type NoteRow = {
  id: string;
  content: string;
  created_at: string;
  folder_id?: string | null;
  deleted_at?: string | null;
};

type NoteTagRow = {
  note_id: string;
  tag: TagItem | TagItem[] | null;
};

type Note = {
  id: string;
  content: string;
  createdAt: string;
  folderId: string | null;
  folderName: string | null;
  tags: TagItem[];
};

const FETCH_TIMEOUT_MS = 8000;
const FALLBACK_POLL_MS = 60000;
const TAG_COLORS = {
  待办: "#f97316",
  链接: "#2563eb",
  代码: "#7c3aed",
  清单: "#16a34a",
  长文: "#db2777",
  电话: "#0f766e",
} as const;
const AUTO_TAG_NAMES = Object.keys(TAG_COLORS);

type FetchNotesResult = {
  data: NoteRow[];
  error: { code?: string; message: string } | null;
  supportsSoftDelete: boolean;
  supportsServerSearch: boolean;
};

function isMissingTableError(code?: string) {
  return code === "42P01";
}

function isMissingColumnError(code?: string) {
  return code === "42703";
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function getTagColor(name: string, currentCount: number) {
  const direct = TAG_COLORS[name as keyof typeof TAG_COLORS];

  if (direct) {
    return direct;
  }

  const palette = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777"];
  return palette[currentCount % palette.length];
}

function inferAutoTags(content: string) {
  const next = new Set<string>();
  const text = content.trim();

  if (/https?:\/\//i.test(text)) {
    next.add("链接");
  }

  if (/(todo|待办|待处理|follow up|follow-up)/i.test(text)) {
    next.add("待办");
  }

  if (/```|function |const |let |var |=>|class |import |export /i.test(text)) {
    next.add("代码");
  }

  if ((text.match(/\n/g) ?? []).length >= 2 || /^[-*]\s/m.test(text)) {
    next.add("清单");
  }

  if (text.length >= 120) {
    next.add("长文");
  }

  if (/\b1\d{10}\b/.test(text)) {
    next.add("电话");
  }

  return Array.from(next);
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

async function fetchNotes(searchQuery: string): Promise<FetchNotesResult> {
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
    "id, content, created_at, folder_id, deleted_at",
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
    "id, content, created_at, folder_id, deleted_at",
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
    })),
    error: legacyShape.error,
    supportsSoftDelete: false,
    supportsServerSearch: false,
  };
}

async function fetchFolders() {
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

async function fetchNoteTags() {
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

async function fetchTags() {
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

export default function Home() {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [activeTagId, setActiveTagId] = useState("all");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [noteTagInputs, setNoteTagInputs] = useState<Record<string, string>>({});
  const [noteFolderSelections, setNoteFolderSelections] = useState<Record<string, string>>(
    {},
  );
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [noteActionId, setNoteActionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState("轮询兜底中");
  const [supportsFolders, setSupportsFolders] = useState(false);
  const [supportsTags, setSupportsTags] = useState(false);
  const [supportsSoftDelete, setSupportsSoftDelete] = useState(false);
  const [supportsServerSearch, setSupportsServerSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevNoteCountRef = useRef(0);
  const shouldScrollToBottomRef = useRef(true);
  const currentSyncMode = supabaseConfigError ? "Supabase 未配置" : syncMode;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchAppData = useCallback(async (showLoading = false) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      if (showLoading) {
        setIsLoading(true);
      }

      setError(null);
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("加载超时，请检查网络或 Supabase 配置"));
        }, FETCH_TIMEOUT_MS);
      });

      const request = Promise.all([
        fetchNotes(debouncedSearchQuery),
        fetchFolders(),
        fetchNoteTags(),
        fetchTags(),
      ]);
      const [notesResult, foldersResult, noteTagsResult, tagsResult] =
        await Promise.race([request, timeout]);

      if (notesResult.error) throw notesResult.error;
      if (foldersResult.error) throw foldersResult.error;
      if (noteTagsResult.error) throw noteTagsResult.error;
      if (tagsResult.error) throw tagsResult.error;

      const nextFolders = foldersResult.data;
      const folderMap = new Map(nextFolders.map((folder) => [folder.id, folder.name]));
      const tagsByNoteId = new Map<string, TagItem[]>();

      for (const row of noteTagsResult.data) {
        const rawTag = Array.isArray(row.tag) ? row.tag[0] : row.tag;

        if (!rawTag) continue;

        const current = tagsByNoteId.get(row.note_id) ?? [];
        current.push(rawTag);
        tagsByNoteId.set(row.note_id, current);
      }

      const nextNotes = notesResult.data.map((note) => ({
        id: note.id,
        content: note.content,
        createdAt: note.created_at,
        folderId: note.folder_id ?? null,
        folderName: note.folder_id ? folderMap.get(note.folder_id) ?? null : null,
        tags: tagsByNoteId.get(note.id) ?? [],
      }));

      setFolders(nextFolders);
      setAllTags(tagsResult.data);
      setSupportsFolders(foldersResult.enabled);
      setSupportsTags(noteTagsResult.enabled && tagsResult.enabled);
      setSupportsSoftDelete(notesResult.supportsSoftDelete);
      setSupportsServerSearch(notesResult.supportsServerSearch);
      setNotes(nextNotes);

      setSelectedFolderId((current) => {
        if (!foldersResult.enabled || nextFolders.length === 0) return "";
        if (current && nextFolders.some((folder) => folder.id === current)) return current;
        return nextFolders[0].id;
      });

      setActiveFolderId((current) => {
        if (current === "all") return current;
        if (nextFolders.some((folder) => folder.id === current)) return current;
        return "all";
      });

      setActiveTagId((current) => {
        if (current === "all") return current;
        if (tagsResult.data.some((tag) => tag.id === current)) return current;
        return "all";
      });

      setNoteFolderSelections((current) => {
        const nextSelections = { ...current };

        for (const note of notesResult.data) {
          nextSelections[note.id] = note.folder_id ?? "";
        }

        return nextSelections;
      });
    } catch (error) {
      setNotes([]);
      setFolders([]);
      setAllTags([]);
      setSupportsFolders(false);
      setSupportsTags(false);
      setSupportsSoftDelete(false);
      setSupportsServerSearch(false);
      setError(error instanceof Error ? error.message : "加载失败，请稍后重试");
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [debouncedSearchQuery]);

  const ensureTag = useCallback(
    async (name: string) => {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const normalized = normalizeName(name);
      const existing = allTags.find((tag) => normalizeName(tag.name) === normalized);

      if (existing) {
        return existing;
      }

      const { data, error } = await supabase
        .from("tags")
        .insert([{ name, color: getTagColor(name, allTags.length) }])
        .select("id, name, color")
        .single();

      if (error) {
        throw error;
      }

      return data as TagItem;
    },
    [allTags],
  );

  const applyTagsToNote = useCallback(
    async (noteId: string, tagNames: string[]) => {
      if (!supportsTags || tagNames.length === 0) {
        return;
      }

      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const note = notes.find((item) => item.id === noteId);
      const existingNames = new Set(note?.tags.map((tag) => normalizeName(tag.name)) ?? []);

      for (const rawName of tagNames) {
        const name = rawName.trim();

        if (!name || existingNames.has(normalizeName(name))) {
          continue;
        }

        const tag = await ensureTag(name);
        const { error } = await supabase
          .from("note_tags")
          .insert([{ note_id: noteId, tag_id: tag.id }]);

        if (error && error.code !== "23505") {
          throw error;
        }
      }
    },
    [ensureTag, notes, supportsTags],
  );

  const syncAutoTagsForNote = useCallback(
    async (noteId: string, content: string) => {
      if (!supportsTags) {
        return;
      }

      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const note = notes.find((item) => item.id === noteId);
      const desiredNames = inferAutoTags(content).map(normalizeName);
      const desiredSet = new Set(desiredNames);
      const currentAutoTags = (note?.tags ?? []).filter((tag) =>
        AUTO_TAG_NAMES.map(normalizeName).includes(normalizeName(tag.name)),
      );

      for (const tag of currentAutoTags) {
        if (!desiredSet.has(normalizeName(tag.name))) {
          const { error } = await supabase
            .from("note_tags")
            .delete()
            .eq("note_id", noteId)
            .eq("tag_id", tag.id);

          if (error) {
            throw error;
          }
        }
      }

      await applyTagsToNote(noteId, Array.from(desiredSet));
    },
    [applyTagsToNote, notes, supportsTags],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchAppData(true);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [fetchAppData]);

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel("echo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, () => {
        void fetchAppData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "folders" }, () => {
        void fetchAppData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tags" }, () => {
        void fetchAppData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "note_tags" }, () => {
        void fetchAppData();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setSyncMode("实时同步已连接");
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setSyncMode("实时同步异常，使用轮询兜底");
          return;
        }

        if (status === "CLOSED") {
          setSyncMode("连接已关闭，等待重连");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchAppData]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchAppData();
    }, FALLBACK_POLL_MS);

    return () => clearInterval(intervalId);
  }, [fetchAppData]);

  useEffect(() => {
    const hasNewNote = notes.length > prevNoteCountRef.current;

    if (hasNewNote || shouldScrollToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    prevNoteCountRef.current = notes.length;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const normalizedSearch = debouncedSearchQuery.toLowerCase();

    return notes.filter((note) => {
      const matchesFolder = activeFolderId === "all" || note.folderId === activeFolderId;
      const matchesTag =
        activeTagId === "all" || note.tags.some((tag) => tag.id === activeTagId);
      const matchesSearch =
        !normalizedSearch ||
        supportsServerSearch ||
        note.content.toLowerCase().includes(normalizedSearch);

      return matchesFolder && matchesTag && matchesSearch;
    });
  }, [activeFolderId, activeTagId, debouncedSearchQuery, notes, supportsServerSearch]);

  const createFolder = async () => {
    const name = newFolderName.trim();

    if (!name || isCreatingFolder) return;

    setIsCreatingFolder(true);
    setError(null);
    setNotice(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const existing = folders.find(
        (folder) => normalizeName(folder.name) === normalizeName(name),
      );

      if (existing) {
        setSelectedFolderId(existing.id);
        setActiveFolderId(existing.id);
        setNewFolderName("");
        setNotice(`文件夹“${existing.name}”已存在，已帮你切换到它。`);
        return;
      }

      const { data, error } = await supabase
        .from("folders")
        .insert([{ name }])
        .select("id, name")
        .single();

      if (error) throw error;

      const folder = data as FolderItem;
      setNewFolderName("");
      setSelectedFolderId(folder.id);
      setActiveFolderId(folder.id);
      setNotice(`已创建文件夹“${folder.name}”。`);
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建文件夹失败");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const createTag = async () => {
    const name = newTagName.trim();

    if (!name || isCreatingTag) return;

    setIsCreatingTag(true);
    setError(null);
    setNotice(null);

    try {
      const tag = await ensureTag(name);
      setNewTagName("");
      setActiveTagId(tag.id);
      setNotice(`已创建标签“#${tag.name}”。`);
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建标签失败");
    } finally {
      setIsCreatingTag(false);
    }
  };

  const assignTagToNote = async (noteId: string) => {
    const rawName = noteTagInputs[noteId]?.trim();

    if (!rawName || noteActionId) return;

    setNoteActionId(noteId);
    setError(null);
    setNotice(null);

    try {
      await applyTagsToNote(noteId, [rawName]);
      setNoteTagInputs((current) => ({ ...current, [noteId]: "" }));
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "添加标签失败");
    } finally {
      setNoteActionId(null);
    }
  };

  const moveNoteToFolder = async (noteId: string) => {
    if (noteActionId) return;

    const folderId = noteFolderSelections[noteId] || null;

    setNoteActionId(noteId);
    setError(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const { error } = await supabase
        .from("notes")
        .update({ folder_id: folderId })
        .eq("id", noteId);

      if (error) throw error;

      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "移动文件夹失败");
    } finally {
      setNoteActionId(null);
    }
  };

  const deleteNote = async (note: Note) => {
    if (!supportsSoftDelete || noteActionId) return;

    const confirmed = window.confirm("确定删除这条消息吗？你之后可以基于软删除继续扩展撤销或回收站。");

    if (!confirmed) return;

    setNoteActionId(note.id);
    setError(null);
    setNotice(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const { error } = await supabase
        .from("notes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", note.id);

      if (error) throw error;

      if (editingNoteId === note.id) {
        setEditingNoteId(null);
        setEditingContent("");
      }

      setNoteTagInputs((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      setNoteFolderSelections((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      setNotice("消息已删除。");
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除消息失败");
    } finally {
      setNoteActionId(null);
    }
  };

  const deleteFolder = async (folder: FolderItem) => {
    if (isCreatingFolder) return;

    const confirmed = window.confirm(
      `删除文件夹“${folder.name}”后，里面的消息不会删除，但会变成未分类。确定继续吗？`,
    );

    if (!confirmed) return;

    setIsCreatingFolder(true);
    setError(null);
    setNotice(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const { error } = await supabase.from("folders").delete().eq("id", folder.id);

      if (error) throw error;

      if (selectedFolderId === folder.id) {
        setSelectedFolderId("");
      }

      if (activeFolderId === folder.id) {
        setActiveFolderId("all");
      }

      setNotice(`已删除文件夹“${folder.name}”。`);
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除文件夹失败");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const deleteTag = async (tag: TagItem) => {
    if (isCreatingTag) return;

    const confirmed = window.confirm(`确定删除标签“#${tag.name}”吗？相关绑定会一起移除。`);

    if (!confirmed) return;

    setIsCreatingTag(true);
    setError(null);
    setNotice(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const { error } = await supabase.from("tags").delete().eq("id", tag.id);

      if (error) throw error;

      if (activeTagId === tag.id) {
        setActiveTagId("all");
      }

      setNotice(`已删除标签“#${tag.name}”。`);
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除标签失败");
    } finally {
      setIsCreatingTag(false);
    }
  };

  const startEditingNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingContent(note.content);
    setError(null);
    setNotice(null);
  };

  const cancelEditingNote = () => {
    setEditingNoteId(null);
    setEditingContent("");
  };

  const saveEditedNote = async (noteId: string) => {
    const content = editingContent.trim();

    if (!content || noteActionId) return;

    setNoteActionId(noteId);
    setError(null);
    setNotice(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const { error } = await supabase
        .from("notes")
        .update({ content })
        .eq("id", noteId);

      if (error) throw error;

      await syncAutoTagsForNote(noteId, content);
      setEditingNoteId(null);
      setEditingContent("");
      setNotice("已更新消息内容，并同步刷新自动标签。");
      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "编辑消息失败");
    } finally {
      setNoteActionId(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    setIsSending(true);
    setError(null);
    setNotice(null);
    shouldScrollToBottomRef.current = true;

    const content = input.trim();
    const payload: { content: string; folder_id?: string | null } = { content };

    if (supportsFolders) {
      payload.folder_id = selectedFolderId || null;
    }

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const { data, error } = await supabase
        .from("notes")
        .insert([payload])
        .select("id")
        .single();

      if (error) throw error;

      setInput("");

      if (supportsTags && data?.id) {
        const autoTags = inferAutoTags(content);
        await applyTagsToNote(data.id as string, autoTags);
      }

      await fetchAppData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "发送失败，请稍后重试");
    } finally {
      setIsSending(false);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCreateInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    action: () => Promise<void>,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void action();
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.10),_transparent_35%),linear-gradient(to_bottom,_#f8fafc,_#eef2ff)]">
      <header className="sticky top-0 z-20 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-2xl font-bold text-transparent">
              Echo
            </h1>
            <p className="mt-1 text-sm text-gray-500">极简跨端云端剪贴板</p>
          </div>
          <div className="text-right text-xs text-gray-400">
            <div>{currentSyncMode}</div>
            <div className="mt-1">
              {supportsFolders ? "文件夹 / 标签结构已启用" : "兼容旧表结构"}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5 lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:overflow-auto">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          <section className="rounded-3xl border border-white/70 bg-white/85 p-4 shadow-[0_10px_40px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
              <Folder size={16} />
              文件夹
            </div>

            <div className="space-y-2">
              <button
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                  activeFolderId === "all"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-blue-50"
                }`}
                type="button"
                onClick={() => setActiveFolderId("all")}
              >
                全部文件夹
              </button>
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className={`flex items-center gap-2 rounded-2xl px-3 py-2 transition ${
                    activeFolderId === folder.id
                      ? "bg-blue-600 text-white"
                      : "bg-gray-50 text-gray-600 hover:bg-blue-50"
                  }`}
                >
                  <button
                    className="min-w-0 flex-1 px-1 py-1 text-left text-sm"
                    type="button"
                    onClick={() => setActiveFolderId(folder.id)}
                  >
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <button
                    className="rounded-full p-1 opacity-70 transition hover:bg-black/10 hover:opacity-100"
                    type="button"
                    onClick={() => {
                      void deleteFolder(folder);
                    }}
                    aria-label={`删除文件夹 ${folder.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {supportsFolders ? (
              <div className="mt-4 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none ring-0 focus:border-blue-400"
                  placeholder="新建文件夹"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => handleCreateInputKeyDown(e, createFolder)}
                />
                <button
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm text-white disabled:opacity-50"
                  type="button"
                  onClick={() => {
                    void createFolder();
                  }}
                  disabled={!newFolderName.trim() || isCreatingFolder}
                >
                  <Plus size={16} />
                  {isCreatingFolder ? "创建中" : "新建"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/70 bg-white/85 p-4 shadow-[0_10px_40px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
              <Tag size={16} />
              标签
            </div>

            <div className="space-y-2">
              <button
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                  activeTagId === "all"
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-emerald-50"
                }`}
                type="button"
                onClick={() => setActiveTagId("all")}
              >
                全部标签
              </button>
              {allTags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 rounded-2xl px-3 py-2 text-white transition"
                  style={{ backgroundColor: tag.color ?? "#2563eb" }}
                >
                  <button
                    className="min-w-0 flex-1 px-1 py-1 text-left text-sm"
                    type="button"
                    onClick={() => setActiveTagId(tag.id)}
                  >
                    <span className="truncate">#{tag.name}</span>
                  </button>
                  <button
                    className="rounded-full p-1 opacity-80 transition hover:bg-white/15 hover:opacity-100"
                    type="button"
                    onClick={() => {
                      void deleteTag(tag);
                    }}
                    aria-label={`删除标签 ${tag.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {supportsTags ? (
              <div className="mt-4 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none ring-0 focus:border-emerald-400"
                  placeholder="新建标签"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => handleCreateInputKeyDown(e, createTag)}
                />
                <button
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm text-white disabled:opacity-50"
                  type="button"
                  onClick={() => {
                    void createTag();
                  }}
                  disabled={!newTagName.trim() || isCreatingTag}
                >
                  <Plus size={16} />
                  {isCreatingTag ? "创建中" : "新建"}
                </button>
              </div>
            ) : null}
          </section>
        </aside>

        <section className="min-w-0 rounded-[2rem] border border-white/70 bg-white/70 shadow-[0_15px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm text-gray-500">
                {activeFolderId === "all"
                  ? "全部消息"
                  : `当前文件夹：${folders.find((folder) => folder.id === activeFolderId)?.name ?? "未命名"}`}
                {activeTagId !== "all"
                  ? ` · 标签：#${allTags.find((tag) => tag.id === activeTagId)?.name ?? ""}`
                  : ""}
                {debouncedSearchQuery
                  ? ` · 搜索：${debouncedSearchQuery}`
                  : ""}
              </p>

              <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                <Search size={16} />
                <input
                  className="min-w-0 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400 sm:w-56"
                  placeholder={supportsServerSearch ? "搜索消息内容" : "搜索消息内容（本地匹配）"}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery ? (
                  <button
                    className="rounded-full p-1 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="清空搜索"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </label>
            </div>
          </div>

          <div
            className="h-[calc(100vh-19rem)] overflow-y-auto px-5 py-6 sm:px-6"
            onScroll={(e) => {
              const target = e.currentTarget;
              const distanceToBottom =
                target.scrollHeight - target.scrollTop - target.clientHeight;
              shouldScrollToBottomRef.current = distanceToBottom < 80;
            }}
          >
            <div className="space-y-6">
              {isLoading ? (
                <div className="py-16 text-center">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                  <p className="mt-4 text-gray-500">加载中...</p>
                </div>
              ) : filteredNotes.length === 0 ? (
                <div className="py-16 text-center text-gray-500">
                  这个视图里还没有消息，发一条试试看。
                </div>
              ) : (
                filteredNotes.map((note) => (
                  <article key={note.id} className="group">
                    <div className="flex gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500">
                        <span className="text-xs font-medium text-white">E</span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="rounded-[1.5rem] rounded-tl-sm border border-gray-100 bg-white px-4 py-3 shadow-sm transition-shadow group-hover:shadow-md">
                          {editingNoteId === note.id ? (
                            <div className="space-y-3">
                              <textarea
                                className="min-h-[110px] w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] leading-7 text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-xs text-white disabled:opacity-50"
                                  type="button"
                                  onClick={() => {
                                    void saveEditedNote(note.id);
                                  }}
                                  disabled={!editingContent.trim() || noteActionId === note.id}
                                >
                                  <Pencil size={14} />
                                  保存修改
                                </button>
                                <button
                                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-xs text-gray-600"
                                  type="button"
                                  onClick={cancelEditingNote}
                                >
                                  <X size={14} />
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-gray-800">
                                {note.content}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition hover:border-blue-300 hover:text-blue-600"
                                  type="button"
                                  onClick={() => startEditingNote(note)}
                                >
                                  <Pencil size={14} />
                                  编辑内容
                                </button>
                                {supportsSoftDelete ? (
                                  <button
                                    className="inline-flex items-center gap-2 rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                                    type="button"
                                    onClick={() => {
                                      void deleteNote(note);
                                    }}
                                    disabled={noteActionId === note.id}
                                  >
                                    <Trash2 size={14} />
                                    删除消息
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )}

                          {(note.folderName || note.tags.length > 0) && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {note.folderName ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                                  <Folder size={12} />
                                  {note.folderName}
                                </span>
                              ) : null}

                              {note.tags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="rounded-full px-2.5 py-1 text-xs"
                                  style={{
                                    backgroundColor: `${tag.color ?? "#60a5fa"}20`,
                                    color: tag.color ?? "#2563eb",
                                  }}
                                >
                                  #{tag.name}
                                </span>
                              ))}
                            </div>
                          )}

                          {(supportsFolders || supportsTags) && (
                            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3">
                              {supportsFolders && folders.length > 0 ? (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                  <span className="text-xs text-gray-400">移动到文件夹</span>
                                  <div className="flex gap-2">
                                    <select
                                      className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      value={noteFolderSelections[note.id] ?? note.folderId ?? ""}
                                      onChange={(e) =>
                                        setNoteFolderSelections((current) => ({
                                          ...current,
                                          [note.id]: e.target.value,
                                        }))
                                      }
                                    >
                                      <option value="">未分类</option>
                                      {folders.map((folder) => (
                                        <option key={folder.id} value={folder.id}>
                                          {folder.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      className="rounded-full border border-blue-200 px-3 py-1.5 text-xs text-blue-600 disabled:opacity-50"
                                      type="button"
                                      onClick={() => {
                                        void moveNoteToFolder(note.id);
                                      }}
                                      disabled={noteActionId === note.id}
                                    >
                                      保存
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {supportsTags ? (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                  <span className="text-xs text-gray-400">添加标签</span>
                                  <div className="flex gap-2">
                                    <input
                                      className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                      placeholder="输入标签名"
                                      value={noteTagInputs[note.id] ?? ""}
                                      onChange={(e) =>
                                        setNoteTagInputs((current) => ({
                                          ...current,
                                          [note.id]: e.target.value,
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void assignTagToNote(note.id);
                                        }
                                      }}
                                    />
                                    <button
                                      className="rounded-full border border-emerald-200 px-3 py-1.5 text-xs text-emerald-600 disabled:opacity-50"
                                      type="button"
                                      onClick={() => {
                                        void assignTagToNote(note.id);
                                      }}
                                      disabled={
                                        noteActionId === note.id ||
                                        !(noteTagInputs[note.id] ?? "").trim()
                                      }
                                    >
                                      绑定
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>

                        <div className="mt-2 px-1 text-xs text-gray-400">
                          {format(new Date(note.createdAt), "MM-dd HH:mm", { locale: zhCN })}
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-gray-100 bg-white/90 px-5 py-4 sm:px-6">
            <div className="space-y-3">
              {supportsFolders && folders.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                  <Folder size={16} />
                  <span>发送到</span>
                  <select
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                  >
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex gap-3">
                <div className="flex-1">
                  <textarea
                    className="min-h-[48px] max-h-40 w-full resize-none rounded-[1.5rem] border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="输入文本内容..."
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = "auto";
                      target.style.height = `${target.scrollHeight}px`;
                    }}
                  />
                  <p className="mt-2 px-1 text-xs text-gray-400">
                    现在会自动识别部分内容并打标签，比如链接、待办、代码、清单。
                  </p>
                </div>

                <div className="flex items-end">
                  <button
                    className="inline-flex h-12 items-center gap-2 rounded-[1.25rem] bg-gradient-to-r from-blue-600 to-cyan-500 px-5 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => {
                      void handleSend();
                    }}
                    disabled={!input.trim() || isSending}
                  >
                    <Send size={18} />
                    <span className="hidden sm:inline">
                      {isSending ? "发送中..." : "发送"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
