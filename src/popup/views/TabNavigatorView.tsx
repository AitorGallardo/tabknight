import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Search, X } from "lucide-react";
import { activateTab, getAllTabs, openTabFromQuery } from "../lib/chrome-api";
import { scoreTab } from "../lib/rank";
import { useListNavigation } from "../hooks/useListNavigation";

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

const SCROLL_INSETS = { top: 10, bottom: 26 };

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

  const focusInputAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();
    const nextCaret = input.value.length;
    input.setSelectionRange(nextCaret, nextCaret);
  }, []);

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

  const onActivate = useCallback(
    (index: number) => {
      void executeItem(items[index]);
    },
    [items, executeItem]
  );

  const onEscape = useCallback(() => {
    if (query !== "") {
      setQuery("");
      focusInputAtEnd();
      return;
    }
    void dismissNavigator(true);
  }, [query, setQuery, focusInputAtEnd, dismissNavigator]);

  const { listRef, registerItem } = useListNavigation({
    itemCount: items.length,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    focusInputAtEnd,
    onActivate,
    onEscape,
    scrollInsets: SCROLL_INSETS,
  });

  const kbdClass = "rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-white/70";

  return (
    <div
      className="flex h-full w-full flex-col text-[#f4f5f8]"
      onMouseDownCapture={(event) => {
        const target = event.target as HTMLElement | null;
        if (!target || target.closest("button") || target.tagName === "INPUT") return;

        requestAnimationFrame(() => {
          focusInputAtEnd();
        });
      }}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-3">
        <Search className="h-4 w-4 shrink-0 text-white/55" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search or enter URL…"
          className="h-8 w-full border-none bg-transparent text-base font-medium tracking-[-0.01em] text-white/92 outline-none placeholder:text-white/30"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search tabs"
        />
        {showSaveButton && onOpenSaveFlow && (
          <button
            type="button"
            onClick={onOpenSaveFlow}
            className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/[0.12]"
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
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12]"
            aria-label="Close navigator"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 py-2">
        {loading && <div className="px-2.5 py-1.5 text-xs text-white/60">Loading tabs…</div>}

        {!loading && error && (
          <div className="rounded-[10px] border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="px-2.5 py-1.5 text-xs text-white/55">No matching tabs</div>
        )}

        {!loading &&
          !error &&
          items.map((item, index) => {
            const active = index === activeIndex;
            const rowClass = active ? "bg-[#0a84ff] text-white" : "text-white/80 hover:bg-white/[0.06]";
            const tileClass = active ? "bg-white/20" : "bg-white/[0.08] text-white/80";
            const subClass = active ? "text-white/70" : "text-white/45";

            if (item.type === "open") {
              return (
                <button
                  key={item.id}
                  ref={registerItem(index)}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    void executeItem(item);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-100 ${rowClass}`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md ${tileClass}`}>
                    <Search className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{item.title}</span>
                    <span className={`block truncate text-[11px] ${subClass}`}>{item.subtitle}</span>
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                ref={registerItem(index)}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  void executeItem(item);
                }}
                className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-100 ${rowClass}`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md ${tileClass}`}>
                  {item.tab.favIconUrl ? (
                    <img
                      src={item.tab.favIconUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Globe className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{item.tab.title}</span>
                  <span className={`block truncate text-[11px] ${subClass}`}>{item.tab.url}</span>
                </span>
              </button>
            );
          })}
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-white/[0.07] px-4 py-3 text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>↵</kbd> Switch to tab
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>esc</kbd> {query !== "" ? "Clear" : "Close"}
        </span>
      </div>
    </div>
  );
}
