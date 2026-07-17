import { Archive, Inbox, Menu, Search, Star, X } from "lucide-react";

export type EchoView = "inbox" | "starred" | "archived";

type EchoHeaderProps = {
  view: EchoView;
  searchQuery: string;
  noteCount: number;
  onChangeView: (view: EchoView) => void;
  onChangeSearch: (value: string) => void;
  onOpenSidebar: () => void;
};

const views = [
  { id: "inbox" as const, label: "收件箱", icon: Inbox },
  { id: "starred" as const, label: "收藏", icon: Star },
  { id: "archived" as const, label: "归档", icon: Archive },
];

export function EchoHeader({
  view,
  searchQuery,
  noteCount,
  onChangeView,
  onChangeSearch,
  onOpenSidebar,
}: EchoHeaderProps) {
  return (
    <header className="shrink-0 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 backdrop-blur-xl sm:px-6 sm:pt-5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="echo-mark" aria-hidden="true">E</div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">Echo</h1>
            <p className="text-xs text-[var(--muted)]">{noteCount} 条内容</p>
          </div>
        </div>

        <label className="group hidden h-10 w-[min(34vw,22rem)] items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 focus-within:border-[var(--ink)] md:flex">
          <Search size={16} className="shrink-0 text-[var(--muted)]" />
          <span className="sr-only">搜索内容</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
            type="search"
            value={searchQuery}
            onChange={(event) => onChangeSearch(event.target.value)}
            placeholder="搜索内容"
          />
          {searchQuery ? (
            <button type="button" onClick={() => onChangeSearch("")} aria-label="清除搜索" className="text-[var(--muted)] hover:text-[var(--ink)]">
              <X size={15} />
            </button>
          ) : <kbd className="text-[10px] text-[var(--muted)]">⌘K</kbd>}
        </label>

        <button className="icon-button" type="button" onClick={onOpenSidebar} aria-label="打开整理面板">
          <Menu size={18} />
        </button>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="内容视图">
        {views.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              className={`view-tab ${active ? "view-tab-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChangeView(item.id)}
            >
              <Icon size={15} className={item.id === "starred" && active ? "fill-current" : ""} />
              {item.label}
            </button>
          );
        })}
      </div>

      <label className="mt-3 flex h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 focus-within:border-[var(--ink)] md:hidden">
        <Search size={16} className="text-[var(--muted)]" />
        <span className="sr-only">搜索内容</span>
        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" type="search" value={searchQuery} onChange={(event) => onChangeSearch(event.target.value)} placeholder="搜索内容" />
        {searchQuery ? <button type="button" onClick={() => onChangeSearch("")} aria-label="清除搜索"><X size={15} /></button> : null}
      </label>
    </header>
  );
}
