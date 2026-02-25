import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe, Search } from "lucide-react";
import { activateTab, getAllTabs, openTabFromQuery } from "../lib/chrome-api";

interface TabNavigatorViewProps {
  onOpenSaveFlow: () => void;
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

export function TabNavigatorView({ onOpenSaveFlow }: TabNavigatorViewProps) {
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

        const [allTabs, currentWindow] = await Promise.all([getAllTabs(), chrome.windows.getCurrent()]);

        setCurrentWindowId(currentWindow.id ?? null);

        const normalized = allTabs
          .filter((tab): tab is chrome.tabs.Tab & { id: number; windowId: number; url: string } => {
            return tab.id !== undefined && tab.windowId !== undefined && !!tab.url;
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
      .slice(0, 6)
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

  const executeItem = async (item: NavigatorItem | undefined) => {
    if (!item) return;

    if (item.type === "open") {
      await openTabFromQuery(query);
      window.close();
      return;
    }

    await activateTab(item.tab.id, item.tab.windowId);
    window.close();
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      await executeItem(items[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      window.close();
    }
  };

  return (
    <div
      className="h-full w-full bg-[#07080c] text-[#f3f4f7]"
      onKeyDown={(event) => {
        void handleKeyDown(event);
      }}
    >
      <div className="h-full w-full bg-[radial-gradient(120%_120%_at_60%_0%,rgba(66,47,29,0.35),transparent_65%)] p-2">
        <div className="h-full rounded-2xl border border-white/15 bg-[linear-gradient(180deg,rgba(15,16,22,0.95),rgba(10,11,16,0.94))] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
            <Search className="h-4 w-4 shrink-0 text-white/90" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or Enter URL..."
              className="h-10 w-full border-none bg-transparent text-xl font-semibold tracking-[-0.02em] text-white outline-none placeholder:text-white/35"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search tabs"
            />
            <button
              type="button"
              onClick={onOpenSaveFlow}
              className="rounded-md border border-white/20 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
            >
              Save
            </button>
          </div>

          <div className="max-h-[420px] space-y-1 overflow-auto p-2">
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
                  ? "bg-white/14 border-white/10"
                  : "bg-transparent border-transparent hover:bg-white/8";

                if (item.type === "open") {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        void executeItem(item);
                      }}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${itemClass}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white/95">{item.title}</div>
                        <div className="truncate text-[11px] text-white/60">{item.subtitle}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/80">Open</span>
                        <span className="grid h-7 w-7 place-items-center rounded-md bg-white/15">
                          <ArrowRight className="h-4 w-4 text-white/85" />
                        </span>
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      void executeItem(item);
                    }}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${itemClass}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white/10 text-white/80">
                        {item.tab.favIconUrl ? (
                          <img src={item.tab.favIconUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white/95">{item.tab.title}</div>
                        <div className="truncate text-[11px] text-white/55">{item.tab.url}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white/80">Switch to Tab</span>
                      <span className="grid h-7 w-7 place-items-center rounded-md bg-white/15">
                        <ArrowRight className="h-4 w-4 text-white/85" />
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
