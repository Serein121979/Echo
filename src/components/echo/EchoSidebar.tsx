import { Folder, Pencil, Plus, Star, Tag, Trash2, X } from "lucide-react";
import type { AutoTagMatchType, AutoTagRule, FolderItem, TagItem } from "./types";

type MatchTypeOption = { value: AutoTagMatchType; label: string; hint: string };

type EchoSidebarProps = {
  isOpen: boolean;
  error: string | null;
  notice: string | null;
  folders: FolderItem[];
  allTags: TagItem[];
  supportsFolders: boolean;
  supportsTags: boolean;
  supportsAutoTagRules: boolean;
  isCreatingFolder: boolean;
  isCreatingTag: boolean;
  isSavingRule: boolean;
  activeFolderId: string;
  activeTagId: string;
  newFolderName: string;
  newTagName: string;
  autoTagRules: AutoTagRule[];
  editingRuleId: string | null;
  editingRuleDraft:
    | {
        tagId: string;
        matchType: AutoTagMatchType;
        matchValue: string;
        priority: string;
      }
    | null;
  newRuleTagId: string;
  newRuleMatchType: AutoTagMatchType;
  newRuleMatchValue: string;
  newRulePriority: string;
  matchTypeOptions: MatchTypeOption[];
  getRuleHelperText: (matchType: AutoTagMatchType) => string;
  getRuleInputPlaceholder: (matchType: AutoTagMatchType) => string;
  requiresMatchValue: (matchType: AutoTagMatchType) => boolean;
  onClose: () => void;
  onSelectFolder: (folderId: string) => void;
  onDeleteFolder: (folder: FolderItem) => void;
  onNewFolderNameChange: (value: string) => void;
  onCreateFolder: () => void;
  onSelectTag: (tagId: string) => void;
  onDeleteTag: (tag: TagItem) => void;
  onNewTagNameChange: (value: string) => void;
  onCreateTag: () => void;
  onStartEditRule: (rule: AutoTagRule) => void;
  onCancelEditRule: () => void;
  onSaveRule: (ruleId: string) => void;
  onDeleteRule: (rule: AutoTagRule) => void;
  onNewRuleTagIdChange: (value: string) => void;
  onNewRuleMatchTypeChange: (value: AutoTagMatchType) => void;
  onNewRuleMatchValueChange: (value: string) => void;
  onNewRulePriorityChange: (value: string) => void;
  onCreateRule: () => void;
  onEditRuleDraftChange: (
    patch: Partial<{
      tagId: string;
      matchType: AutoTagMatchType;
      matchValue: string;
      priority: string;
    }>,
  ) => void;
};

export function EchoSidebar({
  isOpen,
  error,
  notice,
  folders,
  allTags,
  supportsFolders,
  supportsTags,
  supportsAutoTagRules,
  isCreatingFolder,
  isCreatingTag,
  isSavingRule,
  activeFolderId,
  activeTagId,
  newFolderName,
  newTagName,
  autoTagRules,
  editingRuleId,
  editingRuleDraft,
  newRuleTagId,
  newRuleMatchType,
  newRuleMatchValue,
  newRulePriority,
  matchTypeOptions,
  getRuleHelperText,
  getRuleInputPlaceholder,
  requiresMatchValue,
  onClose,
  onSelectFolder,
  onDeleteFolder,
  onNewFolderNameChange,
  onCreateFolder,
  onSelectTag,
  onDeleteTag,
  onNewTagNameChange,
  onCreateTag,
  onStartEditRule,
  onCancelEditRule,
  onSaveRule,
  onDeleteRule,
  onNewRuleTagIdChange,
  onNewRuleMatchTypeChange,
  onNewRuleMatchValueChange,
  onNewRulePriorityChange,
  onCreateRule,
  onEditRuleDraftChange,
}: EchoSidebarProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/55" onClick={onClose}>
      <aside
        className="h-[100dvh] w-[min(88vw,360px)] overflow-y-auto border-r border-neutral-200 bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-neutral-950">侧边栏</p>
            <p className="text-xs text-neutral-500">筛选、分类和规则管理</p>
          </div>
          <button
            className="rounded-full border border-neutral-200 p-2 text-neutral-500"
            type="button"
            onClick={onClose}
            aria-label="关闭侧边栏"
          >
            <X size={16} />
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="mb-4 rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-700">
            {notice}
          </div>
        ) : null}

        <div className="space-y-4">
          <section className="rounded-3xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-800">
              <Folder size={16} />
              文件夹
            </div>
            <div className="space-y-2">
              <button
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${
                  activeFolderId === "all"
                    ? "bg-neutral-950 text-white"
                    : "bg-neutral-100 text-neutral-600"
                }`}
                type="button"
                onClick={() => onSelectFolder("all")}
              >
                全部文件夹
              </button>
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${
                    activeFolderId === folder.id
                      ? "bg-neutral-950 text-white"
                      : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  <button
                    className="min-w-0 flex-1 px-1 py-1 text-left text-sm"
                    type="button"
                    onClick={() => onSelectFolder(folder.id)}
                  >
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <button
                    className="rounded-full p-1 opacity-70"
                    type="button"
                    onClick={() => onDeleteFolder(folder)}
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
                  className="min-w-0 flex-1 rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-800 outline-none"
                  placeholder="新建文件夹"
                  value={newFolderName}
                  onChange={(e) => onNewFolderNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCreateFolder();
                    }
                  }}
                />
                <button
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm text-white disabled:opacity-50"
                  type="button"
                  onClick={onCreateFolder}
                  disabled={!newFolderName.trim() || isCreatingFolder}
                >
                  <Plus size={16} />
                  {isCreatingFolder ? "创建中" : "新建"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-800">
              <Tag size={16} />
              标签
            </div>
            <div className="space-y-2">
              <button
                className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${
                  activeTagId === "all"
                    ? "bg-neutral-950 text-white"
                    : "bg-neutral-100 text-neutral-600"
                }`}
                type="button"
                onClick={() => onSelectTag("all")}
              >
                全部标签
              </button>
              {allTags.map((tag) => (
                <div
                  key={tag.id}
                  className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${
                    activeTagId === tag.id
                      ? "bg-neutral-950 text-white"
                      : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  <button
                    className="min-w-0 flex-1 px-1 py-1 text-left text-sm"
                    type="button"
                    onClick={() => onSelectTag(tag.id)}
                  >
                    <span className="truncate">#{tag.name}</span>
                  </button>
                  <button
                    className="rounded-full p-1 opacity-80"
                    type="button"
                    onClick={() => onDeleteTag(tag)}
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
                  className="min-w-0 flex-1 rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-800 outline-none"
                  placeholder="新建标签"
                  value={newTagName}
                  onChange={(e) => onNewTagNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCreateTag();
                    }
                  }}
                />
                <button
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm text-white disabled:opacity-50"
                  type="button"
                  onClick={onCreateTag}
                  disabled={!newTagName.trim() || isCreatingTag}
                >
                  <Plus size={16} />
                  {isCreatingTag ? "创建中" : "新建"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-800">
              <Star size={16} />
              自动标签规则
            </div>
            <p className="text-xs leading-6 text-neutral-500">
              {supportsAutoTagRules
                ? "发送和编辑消息时会按规则自动打标签。"
                : "当前还是兼容旧版内置规则。执行最新 schema 后，这里就能直接配置。"}
            </p>
            <div className="mt-4 space-y-3">
              {autoTagRules.map((rule) => {
                const isEditing = editingRuleId === rule.id && editingRuleDraft;

                return (
                  <div key={rule.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <select
                            className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 outline-none"
                            value={editingRuleDraft.tagId}
                            onChange={(e) =>
                              onEditRuleDraftChange({ tagId: e.target.value })
                            }
                          >
                            {allTags.map((tag) => (
                              <option key={tag.id} value={tag.id}>
                                #{tag.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 outline-none"
                            value={editingRuleDraft.matchType}
                            onChange={(e) => {
                              const nextMatchType = e.target.value as AutoTagMatchType;
                              onEditRuleDraftChange({
                                matchType: nextMatchType,
                                matchValue: requiresMatchValue(nextMatchType) ? editingRuleDraft.matchValue : "",
                              });
                            }}
                          >
                            {matchTypeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px]">
                          <input
                            className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 outline-none"
                            placeholder={getRuleInputPlaceholder(editingRuleDraft.matchType)}
                            value={editingRuleDraft.matchValue}
                            onChange={(e) => onEditRuleDraftChange({ matchValue: e.target.value })}
                            disabled={!requiresMatchValue(editingRuleDraft.matchType)}
                          />
                          <input
                            className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 outline-none"
                            placeholder="优先级"
                            value={editingRuleDraft.priority}
                            onChange={(e) => onEditRuleDraftChange({ priority: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-full bg-neutral-950 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                            type="button"
                            onClick={() => onSaveRule(rule.id)}
                            disabled={isSavingRule}
                          >
                            保存
                          </button>
                          <button
                            className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600"
                            type="button"
                            onClick={onCancelEditRule}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-full bg-neutral-900 px-2.5 py-1 font-medium text-white">
                                #{rule.tag.name}
                              </span>
                              <span className="rounded-full bg-white px-2.5 py-1 text-neutral-600">
                                {matchTypeOptions.find((option) => option.value === rule.matchType)?.label}
                              </span>
                              <span className="rounded-full bg-white px-2.5 py-1 text-neutral-500">
                                P{rule.priority}
                              </span>
                            </div>
                            <p className="mt-2 break-words text-xs leading-5 text-neutral-500">
                              {requiresMatchValue(rule.matchType)
                                ? rule.matchValue
                                : getRuleHelperText(rule.matchType)}
                            </p>
                          </div>
                          {supportsAutoTagRules ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                className="rounded-full p-2 text-neutral-500"
                                type="button"
                                onClick={() => onStartEditRule(rule)}
                                aria-label="编辑规则"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                className="rounded-full p-2 text-neutral-500 disabled:opacity-50"
                                type="button"
                                onClick={() => onDeleteRule(rule)}
                                disabled={isSavingRule}
                                aria-label="删除规则"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {supportsAutoTagRules && supportsTags ? (
              <div className="mt-4 space-y-2 rounded-2xl border border-dashed border-neutral-200 bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    className="rounded-2xl border border-neutral-200 bg-neutral-100 px-3 py-2 text-xs text-neutral-700 outline-none"
                    value={newRuleTagId}
                    onChange={(e) => onNewRuleTagIdChange(e.target.value)}
                  >
                    {allTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        #{tag.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-2xl border border-neutral-200 bg-neutral-100 px-3 py-2 text-xs text-neutral-700 outline-none"
                    value={newRuleMatchType}
                    onChange={(e) => onNewRuleMatchTypeChange(e.target.value as AutoTagMatchType)}
                  >
                    {matchTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px]">
                  <input
                    className="rounded-2xl border border-neutral-200 bg-neutral-100 px-3 py-2 text-xs text-neutral-700 outline-none"
                    placeholder={getRuleInputPlaceholder(newRuleMatchType)}
                    value={newRuleMatchValue}
                    onChange={(e) => onNewRuleMatchValueChange(e.target.value)}
                    disabled={!requiresMatchValue(newRuleMatchType)}
                  />
                  <input
                    className="rounded-2xl border border-neutral-200 bg-neutral-100 px-3 py-2 text-xs text-neutral-700 outline-none"
                    placeholder="优先级"
                    value={newRulePriority}
                    onChange={(e) => onNewRulePriorityChange(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] leading-5 text-neutral-400">
                    {getRuleHelperText(newRuleMatchType)}
                  </p>
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs text-white disabled:opacity-50"
                    type="button"
                    onClick={onCreateRule}
                    disabled={isSavingRule || !newRuleTagId}
                  >
                    <Plus size={14} />
                    新建规则
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}
