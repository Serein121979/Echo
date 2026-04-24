import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import type {
  AutoTagMatchType,
  AutoTagRule,
  BeforeInstallPromptEvent,
  FolderItem,
  Note,
  TagItem,
} from "./types";
import {
  MAX_FILE_SIZE_BYTES,
  STORAGE_BUCKET,
  getErrorMessage,
  getTagColor,
  inferAutoTags,
  normalizeName,
  parseRuleNumber,
  requiresMatchValue,
} from "./echoLogic";

type EditingRuleDraft = {
  tagId: string;
  matchType: AutoTagMatchType;
  matchValue: string;
  priority: string;
} | null;

export type EchoActionsContext = {
  notes: Note[];
  folders: FolderItem[];
  allTags: TagItem[];
  effectiveAutoTagRules: AutoTagRule[];
  autoTagNameSet: Set<string>;
  supportsTags: boolean;
  supportsFolders: boolean;
  supportsAutoTagRules: boolean;
  supportsSoftDelete: boolean;
  selectedFolderId: string;
  activeFolderId: string;
  activeTagId: string;
  newFolderName: string;
  newTagName: string;
  newRuleTagId: string;
  newRuleMatchType: AutoTagMatchType;
  newRuleMatchValue: string;
  newRulePriority: string;
  noteTagInputs: Record<string, string>;
  noteFolderSelections: Record<string, string>;
  editingRuleId: string | null;
  editingRuleDraft: EditingRuleDraft;
  editingNoteId: string | null;
  editingContent: string;
  noteActionId: string | null;
  input: string;
  pendingFiles: File[];
  isCreatingFolder: boolean;
  isCreatingTag: boolean;
  isSavingRule: boolean;
  isSending: boolean;
  installPromptEvent: BeforeInstallPromptEvent | null;
  setInput: (value: string) => void;
  setNotes: (value: Note[]) => void;
  setFolders: (value: FolderItem[]) => void;
  setAllTags: (value: TagItem[]) => void;
  setNewFolderName: (value: string) => void;
  setNewTagName: (value: string) => void;
  setNewRuleTagId: (value: string) => void;
  setNewRuleMatchType: (value: AutoTagMatchType) => void;
  setNewRuleMatchValue: (value: string) => void;
  setNewRulePriority: (value: string) => void;
  setSelectedFolderId: (value: string) => void;
  setActiveFolderId: (value: string) => void;
  setActiveTagId: (value: string) => void;
  setNoteTagInputs: (value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  setNoteFolderSelections: (value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  setEditingRuleId: (value: string | null) => void;
  setEditingRuleDraft: (value: EditingRuleDraft | ((current: EditingRuleDraft) => EditingRuleDraft)) => void;
  setEditingNoteId: (value: string | null) => void;
  setEditingContent: (value: string) => void;
  setIsSending: (value: boolean) => void;
  setIsCreatingFolder: (value: boolean) => void;
  setIsCreatingTag: (value: boolean) => void;
  setIsSavingRule: (value: boolean) => void;
  setNoteActionId: (value: string | null) => void;
  setPendingFiles: (value: File[] | ((current: File[]) => File[])) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  setIsSidebarOpen: (value: boolean) => void;
  setInstallPromptEvent: (value: BeforeInstallPromptEvent | null) => void;
  requestScrollToBottom: () => void;
  refreshAppData: (showLoading?: boolean) => Promise<void>;
};

export function createEchoActions(ctx: EchoActionsContext) {
  const ensureTag = async (name: string) => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
    }

    const normalized = normalizeName(name);
    const existing = ctx.allTags.find((tag) => normalizeName(tag.name) === normalized);

    if (existing) {
      return existing;
    }

    const { data, error } = await supabase
      .from("tags")
      .insert([{ name, color: getTagColor(name, ctx.allTags.length) }])
      .select("id, name, color")
      .single();

    if (error) throw error;

    return data as TagItem;
  };

  const queuePendingFiles = (files: File[]) => {
    const acceptedFiles: File[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        ctx.setError(`文件“${file.name}”不能超过 50MB。`);
        return false;
      }

      acceptedFiles.push(file);
    }

    if (acceptedFiles.length === 0) {
      return false;
    }

    ctx.setPendingFiles((current) => [...current, ...acceptedFiles]);
    ctx.setError(null);
    ctx.setNotice(
      acceptedFiles.length === 1
        ? `已选择附件：${acceptedFiles[0].name}`
        : `已加入 ${acceptedFiles.length} 个附件。`,
    );
    return true;
  };

  const applyTagsToNote = async (noteId: string, tagNames: string[]) => {
    if (!ctx.supportsTags || tagNames.length === 0) {
      return;
    }

    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
    }

    const note = ctx.notes.find((item) => item.id === noteId);
    const existingNames = new Set(note?.tags.map((tag) => normalizeName(tag.name)) ?? []);

    for (const rawName of tagNames) {
      const name = rawName.trim();

      if (!name || existingNames.has(normalizeName(name))) {
        continue;
      }

      const tag = await ensureTag(name);
      const { error } = await supabase.from("note_tags").insert([{ note_id: noteId, tag_id: tag.id }]);

      if (error && error.code !== "23505") {
        throw error;
      }
    }
  };

  const syncAutoTagsForNote = async (noteId: string, content: string) => {
    if (!ctx.supportsTags) {
      return;
    }

    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
    }

    const note = ctx.notes.find((item) => item.id === noteId);
    const desiredNames = inferAutoTags(content, ctx.effectiveAutoTagRules).map(normalizeName);
    const desiredSet = new Set(desiredNames);
    const currentAutoTags = (note?.tags ?? []).filter((tag) => ctx.autoTagNameSet.has(normalizeName(tag.name)));

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
  };

  const uploadPendingFile = async (file: File) => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
    }

    const extension = file.name.includes(".") ? file.name.split(".").pop() : "";
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
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
  };

  const createFolder = async () => {
    const name = ctx.newFolderName.trim();
    if (!name || ctx.isCreatingFolder) return;

    ctx.setIsCreatingFolder(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");
      }

      const existing = ctx.folders.find((folder) => normalizeName(folder.name) === normalizeName(name));
      if (existing) {
        ctx.setSelectedFolderId(existing.id);
        ctx.setActiveFolderId(existing.id);
        ctx.setNewFolderName("");
        ctx.setNotice(`文件夹“${existing.name}”已存在，已帮你切换到它。`);
        return;
      }

      const { data, error } = await supabase.from("folders").insert([{ name }]).select("id, name").single();
      if (error) throw error;

      const folder = data as FolderItem;
      ctx.setNewFolderName("");
      ctx.setSelectedFolderId(folder.id);
      ctx.setActiveFolderId(folder.id);
      ctx.setNotice(`已创建文件夹“${folder.name}”。`);
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "创建文件夹失败"));
    } finally {
      ctx.setIsCreatingFolder(false);
    }
  };

  const createTag = async () => {
    const name = ctx.newTagName.trim();
    if (!name || ctx.isCreatingTag) return;

    ctx.setIsCreatingTag(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const tag = await ensureTag(name);
      ctx.setNewTagName("");
      ctx.setActiveTagId(tag.id);
      ctx.setNotice(`已创建标签“#${tag.name}”。`);
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "创建标签失败"));
    } finally {
      ctx.setIsCreatingTag(false);
    }
  };

  const assignTagToNote = async (noteId: string) => {
    const rawName = ctx.noteTagInputs[noteId]?.trim();
    if (!rawName || ctx.noteActionId) return;

    ctx.setNoteActionId(noteId);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      await applyTagsToNote(noteId, [rawName]);
      ctx.setNoteTagInputs((current) => ({ ...current, [noteId]: "" }));
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "添加标签失败"));
    } finally {
      ctx.setNoteActionId(null);
    }
  };

  const moveNoteToFolder = async (noteId: string) => {
    if (ctx.noteActionId) return;

    const folderId = ctx.noteFolderSelections[noteId] || null;
    ctx.setNoteActionId(noteId);
    ctx.setError(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("notes").update({ folder_id: folderId }).eq("id", noteId);
      if (error) throw error;

      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "移动文件夹失败"));
    } finally {
      ctx.setNoteActionId(null);
    }
  };

  const toggleNoteStar = async (note: Note) => {
    if (ctx.noteActionId) return;

    ctx.setNoteActionId(note.id);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("notes").update({ is_starred: !note.isStarred }).eq("id", note.id);
      if (error) throw error;

      ctx.setNotice(note.isStarred ? "已取消收藏。" : "已加入收藏。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "更新收藏状态失败"));
    } finally {
      ctx.setNoteActionId(null);
    }
  };

  const toggleNoteArchived = async (note: Note) => {
    if (ctx.noteActionId) return;

    ctx.setNoteActionId(note.id);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("notes").update({ is_archived: !note.isArchived }).eq("id", note.id);
      if (error) throw error;

      ctx.setNotice(note.isArchived ? "已恢复到主列表。" : "已归档消息。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "更新归档状态失败"));
    } finally {
      ctx.setNoteActionId(null);
    }
  };

  const deleteNote = async (note: Note) => {
    if (!ctx.supportsSoftDelete || ctx.noteActionId) return;

    if (!window.confirm("确定删除这条消息吗？你之后可以基于软删除继续扩展撤销或回收站。")) return;

    ctx.setNoteActionId(note.id);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase
        .from("notes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", note.id);
      if (error) throw error;

      if (ctx.editingNoteId === note.id) {
        ctx.setEditingNoteId(null);
        ctx.setEditingContent("");
      }

      ctx.setNoteTagInputs((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      ctx.setNoteFolderSelections((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      ctx.setNotice("消息已删除。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "删除消息失败"));
    } finally {
      ctx.setNoteActionId(null);
    }
  };

  const deleteFolder = async (folder: FolderItem) => {
    if (ctx.isCreatingFolder) return;
    if (!window.confirm(`删除文件夹“${folder.name}”后，里面的消息不会删除，但会变成未分类。确定继续吗？`)) return;

    ctx.setIsCreatingFolder(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("folders").delete().eq("id", folder.id);
      if (error) throw error;

      if (ctx.selectedFolderId === folder.id) ctx.setSelectedFolderId("");
      if (ctx.activeFolderId === folder.id) ctx.setActiveFolderId("all");

      ctx.setNotice(`已删除文件夹“${folder.name}”。`);
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "删除文件夹失败"));
    } finally {
      ctx.setIsCreatingFolder(false);
    }
  };

  const deleteTag = async (tag: TagItem) => {
    if (ctx.isCreatingTag) return;
    if (!window.confirm(`确定删除标签“#${tag.name}”吗？相关绑定会一起移除。`)) return;

    ctx.setIsCreatingTag(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("tags").delete().eq("id", tag.id);
      if (error) throw error;

      if (ctx.activeTagId === tag.id) ctx.setActiveTagId("all");

      ctx.setNotice(`已删除标签“#${tag.name}”。`);
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "删除标签失败"));
    } finally {
      ctx.setIsCreatingTag(false);
    }
  };

  const createAutoTagRule = async () => {
    if (!ctx.supportsAutoTagRules || ctx.isSavingRule) return;

    const tagId = ctx.newRuleTagId;
    const priority = parseRuleNumber(ctx.newRulePriority);
    const matchValue = ctx.newRuleMatchValue.trim();

    if (!tagId) return ctx.setError("请先选择规则对应的标签。");
    if (priority === null) return ctx.setError("优先级需要是整数。");
    if (requiresMatchValue(ctx.newRuleMatchType) && !matchValue) return ctx.setError("这个规则类型需要填写匹配值。");

    ctx.setIsSavingRule(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("auto_tag_rules").insert([
        {
          tag_id: tagId,
          match_type: ctx.newRuleMatchType,
          match_value: requiresMatchValue(ctx.newRuleMatchType) ? matchValue : null,
          priority,
        },
      ]);
      if (error) throw error;

      ctx.setNewRuleMatchValue("");
      ctx.setNewRulePriority("100");
      ctx.setNotice("自动标签规则已创建。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "创建自动标签规则失败"));
    } finally {
      ctx.setIsSavingRule(false);
    }
  };

  const startEditingRule = (rule: AutoTagRule) => {
    ctx.setEditingRuleId(rule.id);
    ctx.setEditingRuleDraft({
      tagId: rule.tagId,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
      priority: String(rule.priority),
    });
    ctx.setError(null);
    ctx.setNotice(null);
  };

  const cancelEditingRule = () => {
    ctx.setEditingRuleId(null);
    ctx.setEditingRuleDraft(null);
  };

  const saveEditedRule = async (ruleId: string) => {
    if (!ctx.supportsAutoTagRules || ctx.isSavingRule || !ctx.editingRuleDraft) return;

    const priority = parseRuleNumber(ctx.editingRuleDraft.priority);
    const matchValue = ctx.editingRuleDraft.matchValue.trim();

    if (!ctx.editingRuleDraft.tagId) return ctx.setError("请先选择规则对应的标签。");
    if (priority === null) return ctx.setError("优先级需要是整数。");
    if (requiresMatchValue(ctx.editingRuleDraft.matchType) && !matchValue) {
      return ctx.setError("这个规则类型需要填写匹配值。");
    }

    ctx.setIsSavingRule(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase
        .from("auto_tag_rules")
        .update({
          tag_id: ctx.editingRuleDraft.tagId,
          match_type: ctx.editingRuleDraft.matchType,
          match_value: requiresMatchValue(ctx.editingRuleDraft.matchType) ? matchValue : null,
          priority,
        })
        .eq("id", ruleId);
      if (error) throw error;

      cancelEditingRule();
      ctx.setNotice("自动标签规则已更新。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "更新自动标签规则失败"));
    } finally {
      ctx.setIsSavingRule(false);
    }
  };

  const deleteAutoTagRule = async (rule: AutoTagRule) => {
    if (!ctx.supportsAutoTagRules || ctx.isSavingRule) return;
    if (!window.confirm(`确定删除规则“${rule.tag.name} · ${rule.matchType}”吗？`)) return;

    ctx.setIsSavingRule(true);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("auto_tag_rules").delete().eq("id", rule.id);
      if (error) throw error;

      if (ctx.editingRuleId === rule.id) cancelEditingRule();
      ctx.setNotice("自动标签规则已删除。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "删除自动标签规则失败"));
    } finally {
      ctx.setIsSavingRule(false);
    }
  };

  const startEditingNote = (note: Note) => {
    ctx.setEditingNoteId(note.id);
    ctx.setEditingContent(note.content);
    ctx.setError(null);
    ctx.setNotice(null);
  };

  const cancelEditingNote = () => {
    ctx.setEditingNoteId(null);
    ctx.setEditingContent("");
  };

  const saveEditedNote = async (noteId: string) => {
    const content = ctx.editingContent.trim();
    if (!content || ctx.noteActionId) return;

    ctx.setNoteActionId(noteId);
    ctx.setError(null);
    ctx.setNotice(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const { error } = await supabase.from("notes").update({ content }).eq("id", noteId);
      if (error) throw error;

      await syncAutoTagsForNote(noteId, content);
      ctx.setEditingNoteId(null);
      ctx.setEditingContent("");
      ctx.setNotice("已更新消息内容，并同步刷新自动标签。");
      await ctx.refreshAppData();
    } catch (error) {
      ctx.setError(getErrorMessage(error, "编辑消息失败"));
    } finally {
      ctx.setNoteActionId(null);
    }
  };

  const handleSend = async () => {
    if ((!ctx.input.trim() && ctx.pendingFiles.length === 0) || ctx.isSending) return;

    ctx.setIsSending(true);
    ctx.setError(null);
    ctx.setNotice(null);

    const content = ctx.input.trim();

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(supabaseConfigError ?? "Supabase 客户端初始化失败");

      const createdIds: string[] = [];

      if (ctx.pendingFiles.length === 0) {
        const payload: {
          content: string;
          folder_id?: string | null;
        } = { content };

        if (ctx.supportsFolders) {
          payload.folder_id = ctx.selectedFolderId || null;
        }

        const { data, error } = await supabase.from("notes").insert([payload]).select("id").single();
        if (error) throw error;
        if (data?.id) {
          createdIds.push(data.id as string);
        }
      } else {
        for (const [index, file] of ctx.pendingFiles.entries()) {
          const payload: {
            content: string;
            folder_id?: string | null;
            file_path?: string;
            file_url?: string;
            file_name?: string;
            file_type?: string;
            file_size?: number;
          } = {
            content: index === 0 ? content : "",
          };

          if (ctx.supportsFolders) {
            payload.folder_id = ctx.selectedFolderId || null;
          }

          Object.assign(payload, await uploadPendingFile(file));

          const { data, error } = await supabase.from("notes").insert([payload]).select("id").single();
          if (error) throw error;
          if (data?.id) {
            createdIds.push(data.id as string);
          }
        }
      }

      ctx.setInput("");
      ctx.setPendingFiles([]);

      if (ctx.supportsTags && createdIds.length > 0) {
        const autoTags = inferAutoTags(content, ctx.effectiveAutoTagRules);
        for (const noteId of createdIds) {
          await applyTagsToNote(noteId, autoTags);
        }
      }

      ctx.requestScrollToBottom();
      await ctx.refreshAppData();
    } catch (error) {
      console.error("handleSend failed", error);
      ctx.setError(getErrorMessage(error, "发送失败，请稍后重试"));
    } finally {
      ctx.setIsSending(false);
    }
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleComposerPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items)
      .map((item) => item.getAsFile())
      .filter((candidate): candidate is File => Boolean(candidate && candidate.type.startsWith("image/")));
    if (files.length === 0) return;

    e.preventDefault();
    queuePendingFiles(files);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    queuePendingFiles(files);
    e.target.value = "";
  };

  const installApp = async () => {
    if (!ctx.installPromptEvent) return;

    await ctx.installPromptEvent.prompt();
    await ctx.installPromptEvent.userChoice;
    ctx.setInstallPromptEvent(null);
  };

  const handleChangeFolderSelection = (noteId: string, folderId: string) => {
    ctx.setNoteFolderSelections((current) => ({ ...current, [noteId]: folderId }));
  };

  const handleChangeTagInput = (noteId: string, value: string) => {
    ctx.setNoteTagInputs((current) => ({ ...current, [noteId]: value }));
  };

  const handleEditRuleDraftChange = (patch: Partial<NonNullable<EditingRuleDraft>>) => {
    ctx.setEditingRuleDraft((current) => (current ? { ...current, ...patch } : current));
  };

  return {
    ensureTag,
    queuePendingFiles,
    applyTagsToNote,
    syncAutoTagsForNote,
    uploadPendingFile,
    createFolder,
    createTag,
    assignTagToNote,
    moveNoteToFolder,
    toggleNoteStar,
    toggleNoteArchived,
    deleteNote,
    deleteFolder,
    deleteTag,
    createAutoTagRule,
    startEditingRule,
    cancelEditingRule,
    saveEditedRule,
    deleteAutoTagRule,
    startEditingNote,
    cancelEditingNote,
    saveEditedNote,
    handleSend,
    handleComposerKeyDown,
    handleComposerPaste,
    handleFileInputChange,
    installApp,
    handleChangeFolderSelection,
    handleChangeTagInput,
    handleEditRuleDraftChange,
  };
}
