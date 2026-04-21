import { Archive, Folder, Pencil, Star, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Note, FolderItem, TagItem } from "./types";

type EchoNoteCardProps = {
  note: Note;
  folderSelection: string;
  tagInput: string;
  folders: FolderItem[];
  supportsFolders: boolean;
  supportsTags: boolean;
  supportsSoftDelete: boolean;
  noteActionId: string | null;
  editingNoteId: string | null;
  editingContent: string;
  onStartEdit: (note: Note) => void;
  onCancelEdit: () => void;
  onChangeEditingContent: (value: string) => void;
  onSaveEdit: (noteId: string) => void;
  onToggleStar: (note: Note) => void;
  onToggleArchive: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onMoveToFolder: (noteId: string) => void;
  onChangeFolderSelection: (noteId: string, folderId: string) => void;
  onChangeTagInput: (noteId: string, value: string) => void;
  onAssignTag: (noteId: string) => void;
  formatFileSize: (size: number | null) => string | null;
  buildDownloadUrl: (url: string, fileName: string | null) => string;
};

export function EchoNoteCard({
  note,
  folderSelection,
  tagInput,
  folders,
  supportsFolders,
  supportsTags,
  supportsSoftDelete,
  noteActionId,
  editingNoteId,
  editingContent,
  onStartEdit,
  onCancelEdit,
  onChangeEditingContent,
  onSaveEdit,
  onToggleStar,
  onToggleArchive,
  onDeleteNote,
  onMoveToFolder,
  onChangeFolderSelection,
  onChangeTagInput,
  onAssignTag,
  formatFileSize,
  buildDownloadUrl,
}: EchoNoteCardProps) {
  return (
    <article className="group">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-neutral-950">
          <span className="text-xs font-medium text-white">E</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="rounded-[1.5rem] rounded-tl-sm border border-neutral-200 bg-neutral-50 px-4 py-3">
            {editingNoteId === note.id ? (
              <div className="space-y-3">
                <textarea
                  className="min-h-[110px] w-full resize-y rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-[15px] leading-7 text-neutral-800 outline-none"
                  value={editingContent}
                  onChange={(e) => onChangeEditingContent(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs text-white disabled:opacity-50"
                    type="button"
                    onClick={() => {
                      onSaveEdit(note.id);
                    }}
                    disabled={!editingContent.trim() || noteActionId === note.id}
                  >
                    <Pencil size={14} />
                    保存修改
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 text-xs text-neutral-600"
                    type="button"
                    onClick={onCancelEdit}
                  >
                    <X size={14} />
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {note.content ? (
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-neutral-800">
                    {note.content}
                  </p>
                ) : null}
                {note.fileUrl && note.fileName ? (
                  <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-3">
                    {note.fileType?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="max-h-72 w-full rounded-2xl object-cover"
                        src={note.fileUrl}
                        alt={note.fileName}
                      />
                    ) : null}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-900">{note.fileName}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {note.fileType || "文件"}
                          {formatFileSize(note.fileSize) ? ` · ${formatFileSize(note.fileSize)}` : ""}
                        </p>
                      </div>
                      <a
                        className="inline-flex items-center justify-center rounded-full bg-neutral-950 px-4 py-2 text-xs text-white"
                        href={buildDownloadUrl(note.fileUrl, note.fileName)}
                        download={note.fileName}
                        target="_blank"
                        rel="noreferrer"
                      >
                        下载文件
                      </a>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                      note.isStarred
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 text-neutral-600"
                    }`}
                    type="button"
                    onClick={() => onToggleStar(note)}
                    disabled={noteActionId === note.id}
                  >
                    <Star size={14} className={note.isStarred ? "fill-current" : ""} />
                    {note.isStarred ? "取消收藏" : "加入收藏"}
                  </button>
                  <button
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                      note.isArchived
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 text-neutral-600"
                    }`}
                    type="button"
                    onClick={() => onToggleArchive(note)}
                    disabled={noteActionId === note.id}
                  >
                    <Archive size={14} />
                    {note.isArchived ? "取消归档" : "归档"}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600"
                    type="button"
                    onClick={() => onStartEdit(note)}
                  >
                    <Pencil size={14} />
                    编辑内容
                  </button>
                  {supportsSoftDelete ? (
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 disabled:opacity-50"
                      type="button"
                      onClick={() => onDeleteNote(note)}
                      disabled={noteActionId === note.id}
                    >
                      <Trash2 size={14} />
                      删除消息
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {(note.folderName || note.tags.length > 0 || note.isStarred || note.isArchived) ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {note.isStarred ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-2.5 py-1 text-xs text-white">
                    <Star size={12} className="fill-current" />
                    收藏
                  </span>
                ) : null}
                {note.isArchived ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2.5 py-1 text-xs text-neutral-700">
                    <Archive size={12} />
                    已归档
                  </span>
                ) : null}
                {note.folderName ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2.5 py-1 text-xs text-neutral-700">
                    <Folder size={12} />
                    {note.folderName}
                  </span>
                ) : null}
                {note.tags.map((tag: TagItem) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700"
                  >
                    #{tag.name}
                  </span>
                ))}
              </div>
            ) : null}

            {(supportsFolders || supportsTags) ? (
              <div className="mt-4 flex flex-col gap-3 border-t border-neutral-200 pt-3">
                {supportsFolders && folders.length > 0 ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-xs text-neutral-400">移动到文件夹</span>
                    <div className="flex gap-2">
                      <select
                        className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 outline-none"
                        value={folderSelection}
                        onChange={(e) => onChangeFolderSelection(note.id, e.target.value)}
                      >
                        <option value="">未分类</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
                        type="button"
                        onClick={() => onMoveToFolder(note.id)}
                        disabled={noteActionId === note.id}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : null}
                {supportsTags ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-xs text-neutral-400">添加标签</span>
                    <div className="flex gap-2">
                      <input
                        className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 outline-none"
                        placeholder="输入标签名"
                        value={tagInput}
                        onChange={(e) => onChangeTagInput(note.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            onAssignTag(note.id);
                          }
                        }}
                      />
                      <button
                        className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
                        type="button"
                        onClick={() => onAssignTag(note.id)}
                        disabled={noteActionId === note.id || !tagInput.trim()}
                      >
                        绑定
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-2 px-1 text-xs text-neutral-400">
            {format(new Date(note.createdAt), "MM-dd HH:mm", { locale: zhCN })}
          </div>
        </div>
      </div>
    </article>
  );
}
