import { EchoNoteCard } from "./EchoNoteCard";
import type { FolderItem, Note } from "./types";
import type { RefObject, UIEvent } from "react";
import type { EchoView } from "./EchoHeader";

type EchoMainPanelProps = {
  folders: FolderItem[];
  isLoading: boolean;
  filteredNotes: Note[];
  view: EchoView;
  searchQuery: string;
  noteActionId: string | null;
  editingNoteId: string | null;
  editingContent: string;
  noteFolderSelections: Record<string, string>;
  noteTagInputs: Record<string, string>;
  supportsFolders: boolean;
  supportsTags: boolean;
  supportsSoftDelete: boolean;
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
  openActionMenuNoteId: string | null;
  onToggleActionMenu: (noteId: string) => void;
  onCloseActionMenu: () => void;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  formatFileSize: (size: number | null) => string | null;
  buildDownloadUrl: (url: string, fileName: string | null) => string;
};

export function EchoMainPanel({
  folders,
  isLoading,
  filteredNotes,
  view,
  searchQuery,
  noteActionId,
  editingNoteId,
  editingContent,
  noteFolderSelections,
  noteTagInputs,
  supportsFolders,
  supportsTags,
  supportsSoftDelete,
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
  openActionMenuNoteId,
  onToggleActionMenu,
  onCloseActionMenu,
  bottomRef,
  onScroll,
  formatFileSize,
  buildDownloadUrl,
}: EchoMainPanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-0 py-0" onScroll={onScroll}>
        <div className="space-y-4 px-4 py-5 sm:px-6 sm:py-7">
          {isLoading ? (
            <div className="space-y-4 py-3" aria-label="正在加载">
              {["72%", "48%", "63%"].map((width) => (
                <div key={width} className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
                  <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-muted)]" style={{ width }} />
                </div>
              ))}
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="mx-auto flex max-w-sm flex-col items-center py-20 text-center">
              <div className="echo-empty-mark" aria-hidden="true">E</div>
              <h2 className="mt-5 text-base font-semibold text-[var(--ink)]">
                {searchQuery ? "没有找到匹配内容" : view === "starred" ? "还没有收藏" : view === "archived" ? "归档还是空的" : "从第一条 Echo 开始"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {searchQuery ? "换个关键词试试，搜索会匹配正文、文件名和标签。" : view === "inbox" ? "粘贴一段文字、链接或文件，它会立即出现在你的其他设备。" : "你整理过的内容会出现在这里。"}
              </p>
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
                isActionsOpen={openActionMenuNoteId === note.id}
                onToggleActions={onToggleActionMenu}
                onCloseActions={onCloseActionMenu}
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
