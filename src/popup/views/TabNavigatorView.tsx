import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe, Search, X } from "lucide-react";
import { activateTab, getAllTabs, openTabFromQuery } from "../lib/chrome-api";

interface TabNavigatorViewProps {
  onOpenSaveFlow?: () => void;
  showSaveButton?: boolean;
  temporary?: boolean;
  returnToTabId?: number | null;
}

interface NavigatorTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  index: number;
  lastAccessed: number;
}

type NavigatorItem =
  | { type: "open"; id: "open"; title: string; subtitle: string }
  | { type: "tab"; id: string; tab: NavigatorTab; score: number };

function scoreTab(tab: NavigatorTab, query: string): number {
  const q = query.toLowerCase();

  if (!q) {
    return (tab.active ? 300 : 0) + (tab.pinned ? 30 : 0) + tab.lastAccessed / 1_000_000;
  }

  const title = tab.title.toLowerCase();
  const url = tab.url.toLowerCase();

  let score = 0;
  if (title === q) score += 520;
  if (title.startsWith(q)) score += 280;
  if (title.includes(q)) score += 190;
  if (url.includes(q)) score += 130;
  if (tab.active) score += 20;
  if (tab.pinned) score += 12;
  return score;
}

export function TabNavigatorView({
  onOpenSaveFlow,
  showSaveButton = true,
  temporary = false,
  returnToTabId = null,
}: TabNavigatorViewProps) {
  const [tabs, setTabs] = useState<NavigatorTab[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const loadTabs = async () => {
      try {
        setLoading(true);
        setError(null);

        const [allTabs, currentWindow, currentTab] = await Promise.all([
          getAllTabs(),
          chrome.windows.getCurrent(),
          chrome.tabs.getCurrent().catch(() => undefined),
        ]);

        setCurrentWindowId(currentWindow.id ?? null);

        const normalized = allTabs
          .filter((tab): tab is chrome.tabs.Tab & { id: number; windowId: number; url: string } => {
            return (
              tab.id !== undefined &&
              tab.windowId !== undefined &&
              !!tab.url &&
              tab.id !== currentTab?.id
            );
          })
          .map((tab) => ({
            id: tab.id,
            windowId: tab.windowId,
            title: tab.title || tab.url,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            pinned: tab.pinned || false,
            active: tab.active || false,
            index: tab.index || 0,
            lastAccessed: (tab as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0,
          }));

        setTabs(normalized);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load tabs");
      } finally {
        setLoading(false);
      }
    };

    void loadTabs();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<NavigatorItem[]>(() => {
    const q = query.trim();

    const ranked = tabs
      .map((tab) => ({ tab, score: scoreTab(tab, q) }))
      .filter(({ score }) => q.length === 0 || score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.tab.windowId === currentWindowId && b.tab.windowId !== currentWindowId) return -1;
        if (b.tab.windowId === currentWindowId && a.tab.windowId !== currentWindowId) return 1;
        if (a.tab.windowId !== b.tab.windowId) return a.tab.windowId - b.tab.windowId;
        return a.tab.index - b.tab.index;
      })
      .map(({ tab, score }) => ({ type: "tab" as const, id: `tab-${tab.id}`, tab, score }));

    if (!q) return ranked;

    return [
      {
        type: "open",
        id: "open",
        title: `Open \"${q}\"`,
        subtitle: "Search or enter URL",
      },
      ...ranked,
    ];
  }, [tabs, query, currentWindowId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex > items.length - 1) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, activeIndex]);

  const focusInputAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();
    const nextCaret = input.value.length;
    input.setSelectionRange(nextCaret, nextCaret);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const activeItem = itemRefs.current[activeIndex];
    if (!list || !activeItem) return;

    const topInset = 10;
    const bottomInset = 26;
    const itemTop = activeItem.offsetTop;
    const itemBottom = itemTop + activeItem.offsetHeight;
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;

    if (itemTop < viewportTop + topInset) {
      list.scrollTop = Math.max(0, itemTop - topInset);
      return;
    }

    if (itemBottom > viewportBottom - bottomInset) {
      list.scrollTop = Math.min(
        list.scrollHeight - list.clientHeight,
        itemBottom - list.clientHeight + bottomInset
      );
    }
  }, [activeIndex, items.length]);

  const closeCurrentNavigatorTab = useCallback(async () => {
    try {
      const currentTab = await chrome.tabs.getCurrent();
      if (currentTab?.id !== undefined) {
        await chrome.tabs.remove(currentTab.id);
        return;
      }
    } catch {
      // Fall back to window.close below.
    }

    window.close();
  }, []);

  const returnToOriginTab = useCallback(async () => {
    if (returnToTabId === null) return;

    try {
      const tab = await chrome.tabs.get(returnToTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id!, { active: true });

      if (typeof tab.index === "number") {
        await chrome.tabs.highlight({ windowId: tab.windowId, tabs: tab.index });
      }
    } catch {
      // The source tab may have been closed. Ignore and just close the navigator.
    }
  }, [returnToTabId]);

  const dismissNavigator = useCallback(async (restoreOrigin: boolean) => {
    if (temporary) {
      if (restoreOrigin) {
        await returnToOriginTab();
      }
      await closeCurrentNavigatorTab();
      return;
    }

    window.close();
  }, [closeCurrentNavigatorTab, returnToOriginTab, temporary]);

  const executeItem = useCallback(async (item: NavigatorItem | undefined) => {
    if (!item) return;

    if (item.type === "open") {
      await openTabFromQuery(query);
      await dismissNavigator(false);
      return;
    }

    await activateTab(item.tab.id, item.tab.windowId);
    await dismissNavigator(false);
  }, [dismissNavigator, query]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const targetIsInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
        focusInputAtEnd();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        focusInputAtEnd();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void executeItem(items[activeIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void dismissNavigator(true);
        return;
      }

      if (!targetIsInput && event.key === "Backspace") {
        event.preventDefault();
        setQuery((prev) => prev.slice(0, -1));
        focusInputAtEnd();
        return;
      }

      if (!targetIsInput && event.key.length === 1 && !event.repeat) {
        event.preventDefault();
        setQuery((prev) => prev + event.key);
        focusInputAtEnd();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [activeIndex, dismissNavigator, executeItem, focusInputAtEnd, items]);

  return (
    <div
      className="h-full w-full text-[#f4f5f8]"
      onMouseDownCapture={(event) => {
        const target = event.target as HTMLElement | null;
        if (!target || target.closest("button") || target.tagName === "INPUT") return;

        requestAnimationFrame(() => {
          focusInputAtEnd();
        });
      }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-white/15 bg-[linear-gradient(180deg,rgba(16,18,25,0.74),rgba(10,12,18,0.72))] shadow-[0_32px_90px_rgba(0,0,0,0.48)] backdrop-blur-[22px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(62%_85%_at_74%_82%,rgba(104,54,18,0.17),transparent_66%),radial-gradient(58%_80%_at_28%_22%,rgba(38,56,122,0.14),transparent_70%)]" />
        <div className="relative flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
            <Search className="h-4 w-4 shrink-0 text-white/90" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or Enter URL..."
              className="h-10 w-full border-none bg-transparent text-[clamp(1.05rem,1.35vw,1.85rem)] font-semibold tracking-[-0.02em] text-white/92 outline-none placeholder:text-[0.82em] placeholder:font-medium placeholder:tracking-[-0.01em] placeholder:text-white/28"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search tabs"
            />
            {showSaveButton && onOpenSaveFlow && (
              <button
                type="button"
                onClick={onOpenSaveFlow}
                className="rounded-md border border-white/16 bg-black/10 px-2 py-1 text-[11px] text-white/78 hover:bg-white/10"
              >
                Save
              </button>
            )}
            {temporary && (
              <button
                type="button"
                onClick={() => {
                  void dismissNavigator(true);
                }}
                className="grid h-7 w-7 place-items-center rounded-full border border-white/14 bg-black/20 text-white/78 hover:bg-white/10"
                aria-label="Close navigator"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div ref={listRef} className="max-h-[420px] space-y-1 overflow-auto px-2 pb-6 pt-2">
            {loading && <div className="px-3 py-2 text-xs text-white/65">Loading tabs...</div>}

            {!loading && error && (
              <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="px-3 py-2 text-xs text-white/60">No matching tabs</div>
            )}

            {!loading &&
              !error &&
              items.map((item, index) => {
                const active = index === activeIndex;
                const itemClass = active
                  ? "border-white/12 bg-white/14"
                  : "border-transparent bg-transparent hover:bg-white/8";

                if (item.type === "open") {
                  return (
                    <button
                      key={item.id}
                      ref={(element) => {
                        itemRefs.current[index] = element;
                      }}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        void executeItem(item);
                      }}
                      className={`grid w-full scroll-mt-2 scroll-mb-4 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${itemClass}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white/94">{item.title}</div>
                        <div className="truncate text-[11px] text-white/56">{item.subtitle}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/72">Open</span>
                        <span className="grid h-8 w-8 place-items-center rounded-md bg-white/12">
                          <ArrowRight className="h-4 w-4 text-white/88" />
                        </span>
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    key={item.id}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      void executeItem(item);
                    }}
                    className={`grid w-full scroll-mt-2 scroll-mb-4 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${itemClass}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white/8 text-white/80">
                        {item.tab.favIconUrl ? (
                          <img
                            src={item.tab.favIconUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Globe className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white/94">{item.tab.title}</div>
                        <div className="truncate text-[11px] text-white/52">{item.tab.url}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white/72">Switch to Tab</span>
                      <span className="grid h-8 w-8 place-items-center rounded-md bg-white/12">
                        <ArrowRight className="h-4 w-4 text-white/88" />
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
