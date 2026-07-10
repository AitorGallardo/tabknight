import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Music, Pause, Play, Search, Volume2, VolumeX, X } from "lucide-react";
import { activateTab, getAllTabs, setTabMuted } from "../lib/chrome-api";
import { getAllCards, getThumbnail } from "../lib/preview/db";
import { hashUrl } from "../lib/preview/hash";
import type { AudibleStateChangedMessage, ContentCard, MediaControlResult } from "../lib/preview/types";
import { AudioEq } from "../components/AudioEq";

interface TabPreviewViewProps {
  returnToTabId?: number | null;
  /** When true, the view is embedded in an in-page iframe overlay. Dismissal
   *  closes the overlay via postMessage instead of closing a standalone tab. */
  overlay?: boolean;
}

function postToParent(type: "ready" | "close"): void {
  try {
    window.parent.postMessage({ source: "tabknight-preview", type }, "*");
  } catch {
    // No parent / cross-origin restriction — safe to ignore.
  }
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
  audible?: boolean;
  muted?: boolean;
}

/** Per-tab UI playback state for the Audio Playground (audio mode). */
interface PlaybackState {
  playing: boolean;
  /** Media elements last reported by MEDIA_CONTROL_REQUEST; 0 = uncontrollable. */
  mediaCount?: number;
}

const PAUSE_DEBOUNCE_MS = 800;
const AUTOPLAY_HINT_MS = 2500;

const DAY = 24 * 60 * 60 * 1000;

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

/** Group label for the left rail, à la Grok's "Today / Last 7 days / ...". */
function bucketLabel(lastAccessed: number, now: number): string {
  if (!lastAccessed) return "Unknown";
  const age = now - lastAccessed;
  if (age < DAY && new Date(lastAccessed).getDate() === new Date(now).getDate()) return "Today";
  if (age < 2 * DAY) return "Yesterday";
  if (age < 7 * DAY) return "Last 7 days";
  if (age < 30 * DAY) return "Last 30 days";
  return "Older";
}

function relativeTime(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function TabPreviewView({ returnToTabId = null, overlay = false }: TabPreviewViewProps) {
  const [tabs, setTabs] = useState<NavigatorTab[]>([]);
  const [cards, setCards] = useState<Map<string, ContentCard>>(new Map());
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const now = useMemo(() => Date.now(), [tabs]);

  // Audio Playground (Cmd+K "audio" mode): tabs mode is the default, primary
  // surface; audio mode is entered via the ♪ pill or Tab key.
  const [mode, setMode] = useState<"tabs" | "audio">("tabs");
  // Session-sticky membership — once a tab is audible/muted while the overlay
  // is open, its row stays until the overlay closes (it just flips to paused).
  const [audioTabIds, setAudioTabIds] = useState<Set<number>>(new Set());
  const [playback, setPlayback] = useState<Map<number, PlaybackState>>(new Map());
  const [autoplayHint, setAutoplayHint] = useState<Record<number, boolean>>({});
  const pauseTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const hintTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [allTabs, currentWindow, allCards] = await Promise.all([
        getAllTabs(),
        chrome.windows.getCurrent(),
        getAllCards().catch(() => [] as ContentCard[]),
      ]);

      setCurrentWindowId(currentWindow.id ?? null);
      setCards(new Map(allCards.map((card) => [card.urlHash, card])));

      // Hide TabKnight's own preview page and the tab the user is currently on,
      // so the previously-visited tab (sorted by lastAccessed) ranks first.
      const selfUrl = chrome.runtime.getURL("popup/index.html");
      const currentWindowId = currentWindow.id;

      const normalized = allTabs
        .filter(
          (tab): tab is chrome.tabs.Tab & { id: number; windowId: number; url: string } =>
            tab.id !== undefined &&
            tab.windowId !== undefined &&
            !!tab.url &&
            !tab.url.startsWith(selfUrl) &&
            !(tab.active && tab.windowId === currentWindowId)
        )
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
          audible: tab.audible || false,
          muted: tab.mutedInfo?.muted || false,
        }));

      setTabs(normalized);
      setLoading(false);
    };

    void load();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    // Tell the host content script the iframe rendered (cancels its CSP fallback).
    if (overlay) postToParent("ready");
  }, [overlay]);

  // Grow the sticky audio set / seed playback state whenever a tab becomes
  // audible or muted (initial load, or the live-update effect below).
  useEffect(() => {
    let idsChanged = false;
    const nextIds = new Set(audioTabIds);
    let stateChanged = false;
    const nextPlayback = new Map(playback);
    for (const tab of tabs) {
      if (!tab.audible && !tab.muted) continue;
      if (!nextIds.has(tab.id)) {
        nextIds.add(tab.id);
        idsChanged = true;
      }
      if (!nextPlayback.has(tab.id)) {
        nextPlayback.set(tab.id, { playing: !!tab.audible });
        stateChanged = true;
      }
    }
    if (idsChanged) setAudioTabIds(nextIds);
    if (stateChanged) setPlayback(nextPlayback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  // Live updates from the background: keep tab audible/muted flags fresh and
  // debounce audible->false so transient flaps don't flicker a row to paused.
  useEffect(() => {
    const onMessage = (message: unknown) => {
      const msg = message as Partial<AudibleStateChangedMessage>;
      if (!msg || msg.type !== "AUDIBLE_STATE_CHANGED" || typeof msg.tabId !== "number") return;
      const { tabId, audible, muted } = msg;

      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev; // Unknown tab (e.g. created after load) — ignore.
        const current = prev[idx];
        const nextAudible = audible ?? current.audible;
        const nextMuted = muted ?? current.muted;
        if (current.audible === nextAudible && current.muted === nextMuted) return prev;
        const next = prev.slice();
        next[idx] = { ...current, audible: nextAudible, muted: nextMuted };
        return next;
      });

      if (audible === true) {
        const timer = pauseTimers.current.get(tabId);
        if (timer) {
          clearTimeout(timer);
          pauseTimers.current.delete(tabId);
        }
        setPlayback((prev) => {
          const existing = prev.get(tabId);
          if (existing?.playing) return prev;
          const next = new Map(prev);
          next.set(tabId, { ...existing, playing: true });
          return next;
        });
      } else if (audible === false && !pauseTimers.current.has(tabId)) {
        const timer = setTimeout(() => {
          pauseTimers.current.delete(tabId);
          setPlayback((prev) => {
            const existing = prev.get(tabId);
            if (!existing || existing.playing === false) return prev;
            const next = new Map(prev);
            next.set(tabId, { ...existing, playing: false });
            return next;
          });
        }, PAUSE_DEBOUNCE_MS);
        pauseTimers.current.set(tabId, timer);
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      for (const timer of pauseTimers.current.values()) clearTimeout(timer);
      pauseTimers.current.clear();
      for (const timer of hintTimers.current.values()) clearTimeout(timer);
      hintTimers.current.clear();
    };
  }, []);

  // Flat, ranked list of selectable tabs (keyboard navigation indexes into this).
  const orderedTabs = useMemo(() => {
    const q = query.trim();
    return tabs
      .map((tab) => ({ tab, score: scoreTab(tab, q) }))
      .filter(({ score }) => q.length === 0 || score > 0)
      .sort((a, b) => {
        if (q) {
          if (b.score !== a.score) return b.score - a.score;
        } else if (b.tab.lastAccessed !== a.tab.lastAccessed) {
          return b.tab.lastAccessed - a.tab.lastAccessed;
        }
        if (a.tab.windowId === currentWindowId && b.tab.windowId !== currentWindowId) return -1;
        if (b.tab.windowId === currentWindowId && a.tab.windowId !== currentWindowId) return 1;
        return a.tab.index - b.tab.index;
      })
      .map(({ tab }) => tab);
  }, [tabs, query, currentWindowId]);

  // Audio Playground rail — sticky-audio tabs, filtered by the same search query.
  const audioList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabs
      .filter((tab) => audioTabIds.has(tab.id))
      .filter((tab) => !q || tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q))
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
  }, [tabs, audioTabIds, query]);

  const playingCount = useMemo(
    () =>
      tabs.reduce(
        (count, tab) => count + (audioTabIds.has(tab.id) && !!playback.get(tab.id)?.playing && !tab.muted ? 1 : 0),
        0
      ),
    [tabs, audioTabIds, playback]
  );

  // Keyboard navigation indexes into whichever list is on screen.
  const displayList = mode === "audio" ? audioList : orderedTabs;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, mode]);

  useEffect(() => {
    if (activeIndex > displayList.length - 1) {
      setActiveIndex(Math.max(0, displayList.length - 1));
    }
  }, [displayList.length, activeIndex]);

  const activeTabItem = displayList[activeIndex];
  const activeCard = activeTabItem ? cards.get(hashUrl(activeTabItem.url)) : undefined;

  // Lazily load the pixel thumbnail for the focused tab (Tier 2). We fetch one
  // blob at a time and revoke its object URL when the selection changes.
  const [thumb, setThumb] = useState<{ url: string; capturedAt: number } | null>(null);
  const activeUrl = activeTabItem?.url;
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setThumb(null);
    if (!activeUrl) return;

    getThumbnail(hashUrl(activeUrl))
      .then((record) => {
        if (cancelled || !record) return;
        objectUrl = URL.createObjectURL(record.blob);
        setThumb({ url: objectUrl, capturedAt: record.capturedAt });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeUrl]);

  const focusInputAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const item = itemRefs.current[activeIndex];
    if (!list || !item) return;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < list.scrollTop + 8) {
      list.scrollTop = Math.max(0, itemTop - 8);
    } else if (itemBottom > list.scrollTop + list.clientHeight - 8) {
      list.scrollTop = Math.min(list.scrollHeight - list.clientHeight, itemBottom - list.clientHeight + 8);
    }
  }, [activeIndex, displayList.length]);

  const dismiss = useCallback(
    async (restoreOrigin: boolean) => {
      if (overlay) {
        // We never left the page — just dismiss the floating panel.
        postToParent("close");
        return;
      }
      if (restoreOrigin && returnToTabId !== null) {
        try {
          const tab = await chrome.tabs.get(returnToTabId);
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tab.id!, { active: true });
        } catch {
          // Origin tab may be gone; ignore.
        }
      }
      try {
        const current = await chrome.tabs.getCurrent();
        if (current?.id !== undefined) {
          await chrome.tabs.remove(current.id);
          return;
        }
      } catch {
        // Fall through to window.close.
      }
      window.close();
    },
    [overlay, returnToTabId]
  );

  const activate = useCallback(
    async (tab: NavigatorTab | undefined) => {
      if (!tab) return;
      await activateTab(tab.id, tab.windowId);
      await dismiss(false);
    },
    [dismiss]
  );

  const sendPlayToggle = useCallback(async (tab: NavigatorTab) => {
    try {
      const result = (await chrome.runtime.sendMessage({
        type: "MEDIA_CONTROL_REQUEST",
        tabId: tab.id,
        action: "toggle-play",
      })) as MediaControlResult;

      setPlayback((prev) => {
        const existing = prev.get(tab.id);
        const next = new Map(prev);
        next.set(tab.id, { playing: result.playing ?? existing?.playing ?? false, mediaCount: result.mediaCount });
        return next;
      });

      if (result.error === "autoplay-blocked") {
        setAutoplayHint((prev) => ({ ...prev, [tab.id]: true }));
        const existingTimer = hintTimers.current.get(tab.id);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          hintTimers.current.delete(tab.id);
          setAutoplayHint((prev) => {
            if (!prev[tab.id]) return prev;
            const next = { ...prev };
            delete next[tab.id];
            return next;
          });
        }, AUTOPLAY_HINT_MS);
        hintTimers.current.set(tab.id, timer);
      }
    } catch {
      // Tab gone, or no content-script listener — leave UI state as-is.
    }
  }, []);

  const toggleMute = useCallback((tab: NavigatorTab) => {
    const nextMuted = !tab.muted;
    setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, muted: nextMuted } : t)));
    void setTabMuted(tab.id, nextMuted).catch(() => {
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, muted: !nextMuted } : t)));
    });
  }, []);

  const toggleSelectedPlay = useCallback(() => {
    const tab = audioList[activeIndex];
    if (tab) void sendPlayToggle(tab);
  }, [audioList, activeIndex, sendPlayToggle]);

  const toggleSelectedMute = useCallback(() => {
    const tab = audioList[activeIndex];
    if (tab) toggleMute(tab);
  }, [audioList, activeIndex, toggleMute]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const targetIsInput =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, displayList.length - 1)));
        focusInputAtEnd();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        focusInputAtEnd();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void activate(displayList[activeIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void dismiss(true);
      } else if (event.key === "Tab") {
        event.preventDefault();
        setMode((prev) => (prev === "tabs" ? "audio" : "tabs"));
      } else if (mode === "audio" && query === "" && event.key === " ") {
        event.preventDefault();
        toggleSelectedPlay();
      } else if (mode === "audio" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        toggleSelectedMute();
      } else if (!targetIsInput && event.key === "Backspace") {
        event.preventDefault();
        setQuery((prev) => prev.slice(0, -1));
        focusInputAtEnd();
      } else if (!targetIsInput && event.key.length === 1 && !event.repeat) {
        event.preventDefault();
        setQuery((prev) => prev + event.key);
        focusInputAtEnd();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activate, activeIndex, dismiss, displayList, focusInputAtEnd, mode, query, toggleSelectedMute, toggleSelectedPlay]);

  // Render the left rail with bucket headers (only when not searching).
  const showBuckets = query.trim().length === 0;
  let lastBucket = "";

  const kbdClass = "rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-white/70";
  const footer =
    mode === "audio" ? (
      <div className="flex items-center justify-end gap-4 border-t border-white/[0.07] px-6 py-3 text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>space</kbd> play/pause
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>←/→</kbd> mute
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>↵</kbd> go to tab
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>tab</kbd> tabs
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>esc</kbd> close
        </span>
      </div>
    ) : (
      <div className="flex items-center justify-end gap-4 border-t border-white/[0.07] px-6 py-3 text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>↵</kbd> Switch to tab
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>esc</kbd> Close
        </span>
        {playingCount > 0 && (
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>tab</kbd> ♪
          </span>
        )}
      </div>
    );

  return (
    <div
      className="grid h-full w-full grid-cols-[340px_1fr] overflow-hidden rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(28,28,30,0.86),rgba(20,20,22,0.84))] text-[#f5f5f7] shadow-[0_32px_90px_rgba(0,0,0,0.55)] backdrop-blur-[30px]"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", system-ui, sans-serif',
      }}
    >
      {/* Left rail: search + grouped tab list */}
      <div className="flex min-h-0 flex-col border-r border-white/[0.07]">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-3">
          <Search className="h-4 w-4 shrink-0 text-white/55" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tabs…"
            className="h-8 w-full border-none bg-transparent text-base font-medium tracking-[-0.01em] text-white/92 outline-none placeholder:text-white/30"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search tabs"
          />
          {(playingCount > 0 || mode === "audio") && (
            <button
              type="button"
              onClick={() => setMode((prev) => (prev === "audio" ? "tabs" : "audio"))}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                mode === "audio"
                  ? "bg-[#0a84ff]/20 text-[#5eaeff] ring-1 ring-[#0a84ff]/40"
                  : "bg-white/[0.08] text-white/70 hover:bg-white/[0.12]"
              }`}
              aria-label="Toggle audio playground"
              aria-pressed={mode === "audio"}
            >
              <span aria-hidden="true">♪</span>
              {playingCount} playing
            </button>
          )}
          <button
            type="button"
            onClick={() => void dismiss(true)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white/80"
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 py-2">
          {mode === "audio" ? (
            <>
              <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
                Now Playing
              </div>
              {audioList.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <Music className="h-6 w-6 text-white/25" />
                  <div className="text-xs text-white/45">No tabs are playing audio</div>
                  <div className="text-[11px] text-white/30">press Tab to go back</div>
                </div>
              )}
              {audioList.map((tab, index) => {
                const active = index === activeIndex;
                const state = playback.get(tab.id);
                const playing = !!state?.playing && !tab.muted;
                const uncontrollable = state?.mediaCount === 0;
                const showHint = !!autoplayHint[tab.id];

                return (
                  <div
                    key={tab.id}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 transition-colors duration-100 ${
                      active ? "bg-[#0a84ff] text-white" : "text-white/80 hover:bg-white/[0.06]"
                    } ${tab.muted ? "opacity-60" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => void activate(tab)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md ${
                          active ? "bg-white/20" : "bg-white/[0.08] text-white/80"
                        }`}
                      >
                        {tab.favIconUrl ? (
                          <img src={tab.favIconUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <AudioEq playing={playing} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{tab.title}</span>
                        <span className={`block truncate text-[11px] ${active ? "text-white/70" : "text-white/45"}`}>
                          {showHint ? "click the tab to resume" : domainOf(tab.url)}
                        </span>
                      </span>
                    </button>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={playing ? "Pause" : "Play"}
                      title={uncontrollable ? "mute only" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!uncontrollable) void sendPlayToggle(tab);
                      }}
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12] ${
                        uncontrollable ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                      }`}
                    >
                      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={tab.muted ? "Unmute" : "Mute"}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleMute(tab);
                      }}
                      className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12]"
                    >
                      {tab.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {loading && <div className="px-3 py-2 text-xs text-white/60">Loading tabs…</div>}
              {!loading && orderedTabs.length === 0 && (
                <div className="px-3 py-2 text-xs text-white/55">No matching tabs</div>
              )}

              {!loading &&
                orderedTabs.map((tab, index) => {
                  const bucket = bucketLabel(tab.lastAccessed, now);
                  const header = showBuckets && bucket !== lastBucket ? bucket : null;
                  if (header) lastBucket = bucket;
                  const active = index === activeIndex;

                  return (
                    <div key={tab.id}>
                      {header && (
                        <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
                          {header}
                        </div>
                      )}
                      <button
                        ref={(el) => {
                          itemRefs.current[index] = el;
                        }}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => void activate(tab)}
                        className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-100 ${
                          active ? "bg-[#0a84ff] text-white" : "text-white/80 hover:bg-white/[0.06]"
                        }`}
                      >
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md ${
                            active ? "bg-white/20" : "bg-white/[0.08] text-white/80"
                          }`}
                        >
                          {tab.favIconUrl ? (
                            <img src={tab.favIconUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Globe className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em]">{tab.title}</span>
                      </button>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>

      {/* Right pane: preview of the focused tab */}
      <div className="flex min-h-0 flex-col">
        {!activeTabItem ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="grid flex-1 place-items-center text-sm text-white/40">
              {mode === "audio" && audioList.length === 0 ? "Nothing playing right now" : "Select a tab to preview"}
            </div>
            {footer}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Hero (Tier 2 screenshot → Tier 1 og:image → Tier 0 favicon).
                Takes 60% of the pane height; the description below gets 40%. */}
            <div
              className="relative min-h-0 flex-[3] overflow-hidden border-b border-white/[0.07]"
              style={{ background: activeCard?.themeColor ? `${activeCard.themeColor}22` : "rgba(255,255,255,0.03)" }}
            >
              {thumb ? (
                <img src={thumb.url} alt="" className="h-full w-full object-cover object-top" />
              ) : activeCard?.ogImage ? (
                <img src={activeCard.ogImage} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="grid h-full place-items-center">
                  <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-white/8">
                    {activeTabItem.favIconUrl ? (
                      <img src={activeTabItem.favIconUrl} alt="" className="h-7 w-7 object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Globe className="h-6 w-6 text-white/60" />
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-[2] overflow-auto px-6 py-5">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-white/45">
                <span className="truncate">{activeCard?.siteName || domainOf(activeTabItem.url)}</span>
                {(thumb?.capturedAt ?? activeCard?.capturedAt) && (
                  <>
                    <span className="text-white/25">·</span>
                    <span className="shrink-0">
                      captured {relativeTime(thumb?.capturedAt ?? activeCard!.capturedAt, now)}
                    </span>
                  </>
                )}
              </div>

              <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.02em] text-white/95">
                {activeTabItem.title}
              </h2>
              <div className="mt-1 truncate text-xs text-white/45">{activeTabItem.url}</div>

              {activeCard?.description && (
                <p className="mt-4 text-sm leading-relaxed text-white/75">{activeCard.description}</p>
              )}

              {activeCard?.excerpt && (
                <p className="mt-4 whitespace-pre-line text-[13px] leading-relaxed text-white/55">
                  {activeCard.excerpt}
                </p>
              )}

              {!activeCard && !thumb && (
                <p className="mt-6 text-xs text-white/40">
                  No snapshot yet — visit this tab once and TabKnight will capture a preview.
                </p>
              )}
            </div>

            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
