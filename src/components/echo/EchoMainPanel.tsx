import { Archive, Search, Star, X } from "lucide-react";
import { EchoNoteCard } from "./EchoNoteCard";
import type { FolderItem, Note, TagItem } from "./types";
import type { RefObject, UIEvent } from "react";

type EchoMainPanelProps = {
  activeView: "all" | "starred" | "archived";
  activeFolderId: string;
  activeTagId: string;
  searchQuery: string;
  debouncedSearchQuery: string;
  folders: FolderItem[];
  allTags: TagItem[];
  supportsServerSearch: boolean;
  isLoading: boolean;
  filteredNotes: Note[];
  noteActionId: string | null;
  editingNoteId: string | null;
  editingContent: string;
  noteFolderSelections: Record<string, string>;
  noteTagInputs: Record<string, string>;
  supportsFolders: boolean;
  supportsTags: boolean;
  supportsSoftDelete: boolean;
  onSetActiveView: (view: "all" | "starred" | "archived") => void;
  onSetSearchQuery: (value: string) => void;
  onStartEditNote: (note: Note) => void;
  onCancelEditNote: () => void;
  onChangeEditingContent: (value: string) => void;
  onSaveEditedNote: (noteId: string) => void;
  onToggleStar: (note: Note) => void;
  onToggleArchive: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onMoveToFolder: (noteId: string) => void;
  onChangeFolderSelection: (noteId: string, folderId: string) => void;
  onChangeTagInput: (noteId: string, value: string) => void;
  onAssignTag: (noteId: string) => void;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  formatFileSize: (size: number | null) => string | null;
  buildDownloadUrl: (url: string, fileName: string | null) => string;
};

export function EchoMainPanel({
  activeView,
  activeFolderId,
  activeTagId,
  searchQuery,
  debouncedSearchQuery,
  folders,
  allTags,
  supportsServerSearch,
  isLoading,
  filteredNotes,
  noteActionId,
  editingNoteId,
  editingContent,
  noteFolderSelections,
  noteTagInputs,
  supportsFolders,
  supportsTags,
  supportsSoftDelete,
  onSetActiveView,
  onSetSearchQuery,
  onStartEditNote,
  onCancelEditNote,
  onChangeEditingContent,
  onSaveEditedNote,
  onToggleStar,
  onToggleArchive,
  onDeleteNote,
  onMoveToFolder,
  onChangeFolderSelection,
  onChangeTagInput,
  onAssignTag,
  bottomRef,
  onScroll,
  formatFileSize,
  buildDownloadUrl,
}: EchoMainPanelProps) {
  return (
    <section className="flex min-h-[calc(100dvh-8.5rem)] flex-col overflow-hidden rounded-[2rem] border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">
              {activeView === "all" ? "主列表" : activeView === "starred" ? "收藏" : "归档"}
              {" · "}
              {activeFolderId === "all"
                ? "全部消息"
                : `当前文件夹：${folders.find((folder) => folder.id === activeFolderId)?.name ?? "未命名"}`}
              {activeTagId !== "all"
                ? ` · 标签：#${allTags.find((tag) => tag.id === activeTagId)?.name ?? ""}`
                : ""}
              {debouncedSearchQuery ? ` · 搜索：${debouncedSearchQuery}` : ""}
            </p>
            <p className="text-xs text-neutral-400">
              {supportsServerSearch ? "搜索已启用数据库全文检索" : "搜索当前降级为前端内容匹配"}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded-full px-4 py-2 text-xs ${
                  activeView === "all"
                    ? "bg-neutral-950 text-white"
                    : "border border-neutral-200 bg-white text-neutral-600"
                }`}
                type="button"
                onClick={() => onSetActiveView("all")}
              >
                全部
              </button>
              <button
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs ${
                  activeView === "starred"
                    ? "bg-neutral-950 text-white"
                    : "border border-neutral-200 bg-white text-neutral-600"
                }`}
                type="button"
                onClick={() => onSetActiveView("starred")}
              >
                <Star size={14} className={activeView === "starred" ? "fill-current" : ""} />
                收藏
              </button>
              <button
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs ${
                  activeView === "archived"
                    ? "bg-neutral-950 text-white"
                    : "border border-neutral-200 bg-white text-neutral-600"
                }`}
                type="button"
                onClick={() => onSetActiveView("archived")}
              >
                <Archive size={14} />
                归档
              </button>
            </div>

            <label className="flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-500">
              <Search size={16} />
              <input
                className="min-w-0 bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400 sm:w-56"
                placeholder={supportsServerSearch ? "搜索消息内容" : "搜索消息内容（本地匹配）"}
                value={searchQuery}
                onChange={(e) => onSetSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <button
                  className="rounded-full p-1 text-neutral-400"
                  type="button"
                  onClick={() => onSetSearchQuery("")}
                  aria-label="清空搜索"
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
          </div>
        </div>
      </div>

      <div className="border-b border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-700 sm:px-6">
        {activeView === "all" ? "主列表" : activeView === "starred" ? "收藏" : "归档"}
      </div>

      <div
        className="h-[calc(100dvh-21rem)] min-h-[16rem] overflow-y-auto px-4 py-5 sm:px-6"
        onScroll={onScroll}
      >
        <div className="space-y-5">
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-950" />
              <p className="mt-4 text-neutral-500">加载中...</p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="py-16 text-center text-neutral-500">
              这个视图里还没有消息，发一条试试看。
            </div>
          ) : (
            filteredNotes.map((note) => (
              <EchoNoteCard
                key={note.id}
                note={note}
                folderSelection={noteFolderSelections[note.id] ?? note.folderId ?? ""}
                tagInput={noteTagInputs[note.id] ?? ""}
                folders={folders}
                supportsFolders={supportsFolders}
                supportsTags={supportsTags}
                supportsSoftDelete={supportsSoftDelete}
                noteActionId={noteActionId}
                editingNoteId={editingNoteId}
                editingContent={editingContent}
                onStartEdit={onStartEditNote}
                onCancelEdit={onCancelEditNote}
                onChangeEditingContent={onChangeEditingContent}
                onSaveEdit={onSaveEditedNote}
                onToggleStar={onToggleStar}
                onToggleArchive={onToggleArchive}
                onDeleteNote={onDeleteNote}
                onMoveToFolder={onMoveToFolder}
                onChangeFolderSelection={onChangeFolderSelection}
                onChangeTagInput={onChangeTagInput}
                onAssignTag={onAssignTag}
                formatFileSize={formatFileSize}
                buildDownloadUrl={buildDownloadUrl}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </section>
  );
}
