import { EchoNoteCard } from "./EchoNoteCard";
import type { FolderItem, Note } from "./types";
import type { RefObject, UIEvent } from "react";

type EchoMainPanelProps = {
  folders: FolderItem[];
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
        <div className="space-y-5 px-4 py-5 sm:px-6">
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
