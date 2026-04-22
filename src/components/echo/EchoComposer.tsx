import { Folder, Menu, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from "react";
import type { FolderItem } from "./types";

type EchoComposerProps = {
  folders: FolderItem[];
  supportsFolders: boolean;
  selectedFolderId: string;
  pendingFile: File | null;
  input: string;
  isSending: boolean;
  onChangeInput: (value: string) => void;
  onChangeSelectedFolderId: (value: string) => void;
  onOpenFilePicker: () => void;
  onOpenSidebar: () => void;
  onRemovePendingFile: () => void;
  onSend: () => void;
  onComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export function EchoComposer({
  folders,
  supportsFolders,
  selectedFolderId,
  pendingFile,
  input,
  isSending,
  onChangeInput,
  onChangeSelectedFolderId,
  onOpenFilePicker,
  onOpenSidebar,
  onRemovePendingFile,
  onSend,
  onComposerKeyDown,
  onComposerPaste,
  onFileInputChange,
  fileInputRef,
}: EchoComposerProps) {
  const [isFolderMenuOpen, setIsFolderMenuOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const canShowFolderMenu = supportsFolders && folders.length > 0;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!composerRef.current) return;
      if (!composerRef.current.contains(event.target as Node)) {
        setIsFolderMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className="shrink-0 border-t border-neutral-200 bg-transparent px-3 pt-3 pb-[env(safe-area-inset-bottom)] sm:px-4">
      <div ref={composerRef} className="relative">
        {isFolderMenuOpen && canShowFolderMenu ? (
          <div className="absolute bottom-full left-3 right-3 z-20 mb-2 rounded-[1.5rem] border border-neutral-200 bg-white p-2 shadow-lg">
            <div className="max-h-56 overflow-y-auto">
              <div className="space-y-1">
                {folders.map((folder) => {
                  const isSelected = folder.id === selectedFolderId;
                  return (
                    <button
                      key={folder.id}
                      className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm ${
                        isSelected ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-700"
                      }`}
                      type="button"
                      onClick={() => {
                        onChangeSelectedFolderId(folder.id);
                        setIsFolderMenuOpen(false);
                      }}
                    >
                      <span className="truncate">{folder.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              className={`flex h-10 w-10 items-center justify-center rounded-full border text-neutral-700 ${
                isFolderMenuOpen ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white"
              }`}
              type="button"
              onClick={() => {
                if (!canShowFolderMenu) return;
                setIsFolderMenuOpen((current) => !current);
              }}
              aria-label="选择发送文件夹"
              aria-expanded={isFolderMenuOpen}
            >
              <Folder size={18} />
            </button>

            <div className="min-w-0 flex-1">
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                onChange={onFileInputChange}
              />
              <textarea
                className="min-h-[44px] max-h-36 w-full resize-none rounded-[1.25rem] border border-neutral-200 bg-white px-4 py-2.5 text-neutral-800 outline-none"
                placeholder="输入..."
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
            </div>

            <button
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700"
              type="button"
              onClick={onOpenFilePicker}
              aria-label="添加文件"
            >
              <Paperclip size={18} />
            </button>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700"
              type="button"
              onClick={onOpenSidebar}
              aria-label="功能菜单"
            >
              <Menu size={18} />
            </button>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-950 text-white disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={onSend}
              disabled={(!input.trim() && !pendingFile) || isSending}
              aria-label={isSending ? "发送中" : "发送"}
            >
              <Send size={18} />
            </button>
          </div>

          {pendingFile ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{pendingFile.name}</p>
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
        </div>
      </div>
    </div>
  );
}
