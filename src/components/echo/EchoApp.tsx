"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { getSupabaseClient, supabaseConfigError } from "@/utils/supabase/client";
import { EchoComposer } from "@/components/echo/EchoComposer";
import { EchoInstallBanner } from "@/components/echo/EchoInstallBanner";
import { EchoMainPanel } from "@/components/echo/EchoMainPanel";
import { EchoSidebar } from "@/components/echo/EchoSidebar";
import { createEchoActions } from "@/components/echo/echoActions";
import type {
  AutoTagMatchType,
  AutoTagRule,
  BeforeInstallPromptEvent,
  FolderItem,
  Note,
  TagItem,
} from "@/components/echo/types";
import {
  DEFAULT_AUTO_TAG_RULES,
  FALLBACK_AUTO_TAG_NAMES,
  FALLBACK_POLL_MS,
  fetchAutoTagRules,
  fetchFolders,
  fetchNoteTags,
  fetchNotes,
  fetchTags,
  formatFileSize,
  getErrorMessage,
  getRuleHelperText,
  getRuleInputPlaceholder,
  normalizeName,
  requiresMatchValue,
  buildDownloadUrl,
  TAG_COLORS,
} from "@/components/echo/echoLogic";

export function EchoApp() {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [autoTagRules, setAutoTagRules] = useState<AutoTagRule[]>([]);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [activeTagId, setActiveTagId] = useState("all");
  const [activeView, setActiveView] = useState<"all" | "starred" | "archived">("all");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newRuleTagId, setNewRuleTagId] = useState("");
  const [newRuleMatchType, setNewRuleMatchType] = useState<AutoTagMatchType>("contains");
  const [newRuleMatchValue, setNewRuleMatchValue] = useState("");
  const [newRulePriority, setNewRulePriority] = useState("100");
  const [noteTagInputs, setNoteTagInputs] = useState<Record<string, string>>({});
  const [noteFolderSelections, setNoteFolderSelections] = useState<Record<string, string>>({});
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleDraft, setEditingRuleDraft] = useState<{
    tagId: string;
    matchType: AutoTagMatchType;
    matchValue: string;
    priority: string;
  } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [noteActionId, setNoteActionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState("轮询兜底中");
  const [supportsFolders, setSupportsFolders] = useState(false);
  const [supportsTags, setSupportsTags] = useState(false);
  const [supportsAutoTagRules, setSupportsAutoTagRules] = useState(false);
  const [supportsSoftDelete, setSupportsSoftDelete] = useState(false);
  const [supportsServerSearch, setSupportsServerSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showIosInstallHint] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    return isIos && !isStandalone;
  });

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevNoteCountRef = useRef(0);
  const shouldScrollToBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveAutoTagRules = useMemo<AutoTagRule[]>(
    () =>
      supportsAutoTagRules
        ? autoTagRules
        : DEFAULT_AUTO_TAG_RULES.map((rule, index) => ({
            id: `fallback-${index}`,
            matchType: rule.matchType,
            matchValue: rule.matchValue,
            priority: rule.priority,
            tagId: rule.tagName,
            tag: {
              id: rule.tagName,
              name: rule.tagName,
              color: TAG_COLORS[rule.tagName],
            },
          })),
    [autoTagRules, supportsAutoTagRules],
  );

  const autoTagNameSet = useMemo(
    () => new Set(effectiveAutoTagRules.map((rule) => normalizeName(rule.tag.name))),
    [effectiveAutoTagRules],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const removePendingFile = useCallback(() => {
    setPendingFile(null);
  }, []);

  const handleMainPanelScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    shouldScrollToBottomRef.current = distanceToBottom < 80;
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const fetchAppData = useCallback(
    async (showLoading = false) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      try {
        if (showLoading) {
          setIsLoading(true);
        }

        setError(null);
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error("加载超时，请检查网络或 Supabase 配置"));
          }, 8000);
        });

        const request = Promise.all([fetchNotes(debouncedSearchQuery), fetchFolders(), fetchNoteTags(), fetchTags(), fetchAutoTagRules()]);
        const [notesResult, foldersResult, noteTagsResult, tagsResult, autoTagRulesResult] = await Promise.race([request, timeout]);

        if (notesResult.error) throw notesResult.error;
        if (foldersResult.error) throw foldersResult.error;
        if (noteTagsResult.error) throw noteTagsResult.error;
        if (tagsResult.error) throw tagsResult.error;
        if (autoTagRulesResult.error) throw autoTagRulesResult.error;

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
          isStarred: note.is_starred ?? false,
          isArchived: note.is_archived ?? false,
          filePath: note.file_path ?? null,
          fileUrl: note.file_url ?? null,
          fileName: note.file_name ?? null,
          fileType: note.file_type ?? null,
          fileSize: note.file_size ?? null,
        }));

        const nextAutoTagRules = autoTagRulesResult.data.flatMap((rule) => {
          const rawTag = Array.isArray(rule.tag) ? rule.tag[0] : rule.tag;
          if (!rawTag) return [];
          return [
            {
              id: rule.id,
              matchType: rule.match_type,
              matchValue: rule.match_value ?? "",
              priority: rule.priority,
              tagId: rule.tag_id,
              tag: rawTag,
            },
          ];
        });

        setFolders(nextFolders);
        setAllTags(tagsResult.data);
        setAutoTagRules(nextAutoTagRules);
        setSupportsFolders(foldersResult.enabled);
        setSupportsTags(noteTagsResult.enabled && tagsResult.enabled);
        setSupportsAutoTagRules(autoTagRulesResult.enabled);
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

        setNewRuleTagId((current) => {
          if (!autoTagRulesResult.enabled || tagsResult.data.length === 0) return "";
          if (current && tagsResult.data.some((tag) => tag.id === current)) return current;
          return tagsResult.data[0].id;
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
        setAutoTagRules([]);
        setSupportsFolders(false);
        setSupportsTags(false);
        setSupportsAutoTagRules(false);
        setSupportsSoftDelete(false);
        setSupportsServerSearch(false);
        setError(getErrorMessage(error, "加载失败，请稍后重试"));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        setIsLoading(false);
      }
    },
    [debouncedSearchQuery],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchAppData(true);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchAppData]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

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
      .on("postgres_changes", { event: "*", schema: "public", table: "auto_tag_rules" }, () => {
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
      const matchesView =
        activeView === "archived"
          ? note.isArchived
          : activeView === "starred"
            ? note.isStarred && !note.isArchived
            : !note.isArchived;
      const matchesFolder = activeFolderId === "all" || note.folderId === activeFolderId;
      const matchesTag = activeTagId === "all" || note.tags.some((tag) => tag.id === activeTagId);
      const matchesSearch = !normalizedSearch || supportsServerSearch || note.content.toLowerCase().includes(normalizedSearch);
      return matchesView && matchesFolder && matchesTag && matchesSearch;
    });
  }, [activeFolderId, activeTagId, activeView, debouncedSearchQuery, notes, supportsServerSearch]);

  const actions = createEchoActions({
    notes,
    folders,
    allTags,
    effectiveAutoTagRules,
    autoTagNameSet,
    supportsTags,
    supportsFolders,
    supportsAutoTagRules,
    supportsSoftDelete,
    selectedFolderId,
    activeFolderId,
    activeTagId,
    newFolderName,
    newTagName,
    newRuleTagId,
    newRuleMatchType,
    newRuleMatchValue,
    newRulePriority,
    noteTagInputs,
    noteFolderSelections,
    editingRuleId,
    editingRuleDraft,
    editingNoteId,
    editingContent,
    noteActionId,
    input,
    pendingFile,
    isCreatingFolder,
    isCreatingTag,
    isSavingRule,
    isSending,
    installPromptEvent,
    setInput,
    setNotes,
    setFolders,
    setAllTags,
    setNewFolderName,
    setNewTagName,
    setNewRuleTagId,
    setNewRuleMatchType,
    setNewRuleMatchValue,
    setNewRulePriority,
    setSelectedFolderId,
    setActiveFolderId,
    setActiveTagId,
    setNoteTagInputs,
    setNoteFolderSelections,
    setEditingRuleId,
    setEditingRuleDraft,
    setEditingNoteId,
    setEditingContent,
    setIsSending,
    setIsCreatingFolder,
    setIsCreatingTag,
    setIsSavingRule,
    setNoteActionId,
    setPendingFile,
    setError,
    setNotice,
    setIsSidebarOpen,
    setInstallPromptEvent,
    setSyncMode,
    refreshAppData: fetchAppData,
  });

  const {
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
  } = actions;

  return (
    <div className="min-h-[100dvh] bg-[#f5f5f5] text-neutral-950">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/92 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">Echo</h1>
            <p className="mt-1 text-sm text-neutral-500">黑白极简的跨设备自发消息箱</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700"
              type="button"
              onClick={() => setIsSidebarOpen(true)}
            >
              打开侧边栏
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6">
        <p className="px-1 text-xs text-neutral-400">
          {supabaseConfigError ? "Supabase 未配置" : syncMode}
          {" · "}
          {supportsAutoTagRules
            ? "文件夹 / 标签 / 自动规则已启用"
            : supportsFolders
              ? "文件夹 / 标签结构已启用"
              : "兼容旧表结构"}
        </p>

        <EchoSidebar
          isOpen={isSidebarOpen}
          error={error}
          notice={notice}
          folders={folders}
          allTags={allTags}
          supportsFolders={supportsFolders}
          supportsTags={supportsTags}
          supportsAutoTagRules={supportsAutoTagRules}
          isCreatingFolder={isCreatingFolder}
          isCreatingTag={isCreatingTag}
          isSavingRule={isSavingRule}
          activeFolderId={activeFolderId}
          activeTagId={activeTagId}
          newFolderName={newFolderName}
          newTagName={newTagName}
          autoTagRules={effectiveAutoTagRules}
          editingRuleId={editingRuleId}
          editingRuleDraft={editingRuleDraft}
          newRuleTagId={newRuleTagId}
          newRuleMatchType={newRuleMatchType}
          newRuleMatchValue={newRuleMatchValue}
          newRulePriority={newRulePriority}
          matchTypeOptions={[
            { value: "contains", label: "关键词", hint: "包含指定文本时命中" },
            { value: "regex", label: "正则", hint: "使用正则表达式匹配" },
            { value: "url", label: "链接", hint: "内容里出现 URL 时命中" },
            { value: "phone", label: "电话", hint: "内容里出现手机号时命中" },
            { value: "min_length", label: "最短字数", hint: "内容长度达到阈值时命中" },
            { value: "line_breaks", label: "换行数", hint: "换行数达到阈值时命中" },
          ]}
          getRuleHelperText={getRuleHelperText}
          getRuleInputPlaceholder={getRuleInputPlaceholder}
          requiresMatchValue={requiresMatchValue}
          onClose={closeSidebar}
          onSelectFolder={setActiveFolderId}
          onDeleteFolder={deleteFolder}
          onNewFolderNameChange={setNewFolderName}
          onCreateFolder={createFolder}
          onSelectTag={setActiveTagId}
          onDeleteTag={deleteTag}
          onNewTagNameChange={setNewTagName}
          onCreateTag={createTag}
          onStartEditRule={startEditingRule}
          onCancelEditRule={cancelEditingRule}
          onSaveRule={saveEditedRule}
          onDeleteRule={deleteAutoTagRule}
          onNewRuleTagIdChange={setNewRuleTagId}
          onNewRuleMatchTypeChange={setNewRuleMatchType}
          onNewRuleMatchValueChange={setNewRuleMatchValue}
          onNewRulePriorityChange={setNewRulePriority}
          onCreateRule={createAutoTagRule}
          onEditRuleDraftChange={handleEditRuleDraftChange}
        />

        <EchoInstallBanner
          installPromptEvent={installPromptEvent}
          showIosInstallHint={showIosInstallHint}
          isSidebarOpen={isSidebarOpen}
          onInstall={installApp}
        />

        {error ? (
          <div className="rounded-[1.75rem] border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-[1.75rem] border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
            {notice}
          </div>
        ) : null}

        <EchoMainPanel
          activeView={activeView}
          activeFolderId={activeFolderId}
          activeTagId={activeTagId}
          searchQuery={searchQuery}
          debouncedSearchQuery={debouncedSearchQuery}
          folders={folders}
          allTags={allTags}
          supportsServerSearch={supportsServerSearch}
          isLoading={isLoading}
          filteredNotes={filteredNotes}
          noteActionId={noteActionId}
          editingNoteId={editingNoteId}
          editingContent={editingContent}
          noteFolderSelections={noteFolderSelections}
          noteTagInputs={noteTagInputs}
          supportsFolders={supportsFolders}
          supportsTags={supportsTags}
          supportsSoftDelete={supportsSoftDelete}
          onSetActiveView={setActiveView}
          onSetSearchQuery={setSearchQuery}
          onStartEditNote={startEditingNote}
          onCancelEditNote={cancelEditingNote}
          onChangeEditingContent={setEditingContent}
          onSaveEditedNote={saveEditedNote}
          onToggleStar={toggleNoteStar}
          onToggleArchive={toggleNoteArchived}
          onDeleteNote={deleteNote}
          onMoveToFolder={moveNoteToFolder}
          onChangeFolderSelection={handleChangeFolderSelection}
          onChangeTagInput={handleChangeTagInput}
          onAssignTag={assignTagToNote}
          bottomRef={bottomRef}
          onScroll={handleMainPanelScroll}
          formatFileSize={formatFileSize}
          buildDownloadUrl={buildDownloadUrl}
        />

        <EchoComposer
          folders={folders}
          supportsFolders={supportsFolders}
          selectedFolderId={selectedFolderId}
          pendingFile={pendingFile}
          input={input}
          isSending={isSending}
          supportsAutoTagRules={supportsAutoTagRules}
          fallbackAutoTagNames={FALLBACK_AUTO_TAG_NAMES}
          onChangeInput={setInput}
          onChangeSelectedFolderId={setSelectedFolderId}
          onOpenFilePicker={openFilePicker}
          onRemovePendingFile={removePendingFile}
          onSend={handleSend}
          onComposerKeyDown={handleComposerKeyDown}
          onComposerPaste={handleComposerPaste}
          onFileInputChange={handleFileInputChange}
          fileInputRef={fileInputRef}
          formatFileSize={formatFileSize}
        />
      </div>
    </div>
  );
}
