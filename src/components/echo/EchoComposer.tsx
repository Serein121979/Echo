import { Folder, Plus, Send, X } from "lucide-react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from "react";
import type { FolderItem } from "./types";

type EchoComposerProps = {
  folders: FolderItem[];
  supportsFolders: boolean;
  selectedFolderId: string;
  pendingFile: File | null;
  input: string;
  isSending: boolean;
  supportsAutoTagRules: boolean;
  fallbackAutoTagNames: string[];
  onChangeInput: (value: string) => void;
  onChangeSelectedFolderId: (value: string) => void;
  onOpenFilePicker: () => void;
  onRemovePendingFile: () => void;
  onSend: () => void;
  onComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  formatFileSize: (size: number | null) => string | null;
};

export function EchoComposer({
  folders,
  supportsFolders,
  selectedFolderId,
  pendingFile,
  input,
  isSending,
  supportsAutoTagRules,
  fallbackAutoTagNames,
  onChangeInput,
  onChangeSelectedFolderId,
  onOpenFilePicker,
  onRemovePendingFile,
  onSend,
  onComposerKeyDown,
  onComposerPaste,
  onFileInputChange,
  fileInputRef,
  formatFileSize,
}: EchoComposerProps) {
  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6">
      <div className="space-y-3">
        {supportsFolders && folders.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
            <Folder size={16} />
            <span>发送到</span>
            <select
              className="rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 outline-none"
              value={selectedFolderId}
              onChange={(e) => onChangeSelectedFolderId(e.target.value)}
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {pendingFile ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900">{pendingFile.name}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {pendingFile.type || "文件"}
                {formatFileSize(pendingFile.size) ? ` · ${formatFileSize(pendingFile.size)}` : ""}
              </p>
            </div>
            <button
              className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-500"
              type="button"
              onClick={onRemovePendingFile}
              aria-label="移除附件"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              onChange={onFileInputChange}
            />
            <textarea
              className="min-h-[52px] max-h-40 w-full resize-none rounded-[1.5rem] border border-neutral-200 bg-neutral-100 px-4 py-3 text-neutral-800 outline-none"
              placeholder="输入文本内容..."
              rows={1}
              value={input}
              onChange={(e) => onChangeInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              onPaste={onComposerPaste}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
            <p className="mt-2 px-1 text-xs text-neutral-400">
              {supportsAutoTagRules
                ? "支持粘贴图片、选择文件，并按你在侧边栏配置的规则自动打标签。"
                : `支持粘贴图片、选择文件，现在也会自动识别部分内容并打标签，比如${fallbackAutoTagNames.join("、")}。`}
            </p>
          </div>
          <div className="flex items-end">
            <div className="flex gap-2">
              <button
                className="inline-flex h-12 items-center gap-2 rounded-[1.25rem] border border-neutral-200 bg-white px-4 font-medium text-neutral-700"
                type="button"
                onClick={onOpenFilePicker}
              >
                <Plus size={18} />
                <span className="hidden sm:inline">文件</span>
              </button>
              <button
                className="inline-flex h-12 items-center gap-2 rounded-[1.25rem] bg-neutral-950 px-5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={onSend}
                disabled={(!input.trim() && !pendingFile) || isSending}
              >
                <Send size={18} />
                <span className="hidden sm:inline">{isSending ? "发送中..." : "发送"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
