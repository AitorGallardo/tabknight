import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Music, Pause, Play, Search, Volume2, VolumeX, X } from "lucide-react";
import { activateTab, getAllTabs, setTabMuted } from "../lib/chrome-api";
import { getAllCards, getThumbnail } from "../lib/preview/db";
import { hashUrl } from "../lib/preview/hash";
import type { AudibleStateChangedMessage, ContentCard, MediaControlResult } from "../lib/preview/types";
import { AudioEq } from "../components/AudioEq";
import { scoreTab } from "../lib/rank";
import { useListNavigation } from "../hooks/useListNavigation";

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

interface PreviewSessionState {
  mode: "tabs" | "audio";
  selectedTabId: number | null;
}

const PREVIEW_SESSION_KEY = "previewSession";

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
const HINT_MS = 2500;
const THUMB_DEBOUNCE_MS = 70;

const DAY = 24 * 60 * 60 * 1000;

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
  const now = useMemo(() => Date.now(), [tabs]);

  // Audio Playground (Cmd+K "audio" mode): tabs mode is the default, primary
  // surface; audio mode is entered via the ♪ pill or Tab key.
  const [mode, setMode] = useState<"tabs" | "audio">("tabs");
  // Tabs-mode selection to restore when coming back from audio mode.
  const rememberedTabId = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Session-sticky membership — once a tab is audible/muted while the overlay
  // is open, its row stays until the overlay closes (it just flips to paused).
  const [audioTabIds, setAudioTabIds] = useState<Set<number>>(new Set());
  const [playback, setPlayback] = useState<Map<number, PlaybackState>>(new Map());
  const [rowHints, setRowHints] = useState<Record<number, string>>({});
  const pauseTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const hintTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Session-restored { mode, selectedTabId } read once on mount; applied after
  // tabs finish loading. undefined = read still pending, null = nothing saved.
  // Kept as state (not a ref) so the restore effect re-runs if the async read
  // resolves after tabs have already loaded.
  const [savedSession, setSavedSession] = useState<PreviewSessionState | null | undefined>(undefined);
  const restoredSelectionRef = useRef(false);
  // Gates the write-through effect until the one-time restore has applied, so
  // it can't persist a stale pre-restore selection in the same commit.
  const [persistReady, setPersistReady] = useState(false);

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
    (async () => {
      try {
        const result = await chrome.storage.session.get(PREVIEW_SESSION_KEY);
        const saved = (result[PREVIEW_SESSION_KEY] as PreviewSessionState | undefined) ?? null;
        setSavedSession(saved);
        if (saved?.mode === "audio") setMode("audio");
      } catch {
        // No session storage access — start fresh.
        setSavedSession(null);
      }
    })();
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

  // Rows sharing a title (e.g. several GitHub PRs, several Google Docs) get a
  // domain hint appended so they stay distinguishable at a glance.
  const duplicateTitleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of orderedTabs) counts.set(tab.title, (counts.get(tab.title) ?? 0) + 1);
    return counts;
  }, [orderedTabs]);

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

  const activeTabItem = displayList[activeIndex];
  const activeCard = activeTabItem ? cards.get(hashUrl(activeTabItem.url)) : undefined;

  // One-time restore of the remembered selection once tabs are loaded. Falls
  // back "audio" -> "tabs" if the restored audio list would be empty, and
  // falls back to the existing default ranking if the remembered tab is gone.
  useEffect(() => {
    if (loading || savedSession === undefined || restoredSelectionRef.current) return;
    restoredSelectionRef.current = true;
    const saved = savedSession;
    if (!saved) {
      setPersistReady(true);
      return;
    }

    let effectiveMode = saved.mode;
    if (effectiveMode === "audio" && !tabs.some((tab) => tab.audible || tab.muted)) {
      effectiveMode = "tabs";
      setMode("tabs");
    }

    if (saved.selectedTabId !== null) {
      if (effectiveMode === "audio") {
        const list = tabs
          .filter((tab) => tab.audible || tab.muted)
          .sort((a, b) => b.lastAccessed - a.lastAccessed);
        const idx = list.findIndex((tab) => tab.id === saved.selectedTabId);
        if (idx >= 0) setActiveIndex(idx);
      } else {
        const idx = orderedTabs.findIndex((tab) => tab.id === saved.selectedTabId);
        if (idx >= 0) setActiveIndex(idx);
      }
    }
    setPersistReady(true);
  }, [loading, tabs, orderedTabs, savedSession]);

  // Write-through: persist { mode, selectedTabId } so the next Cmd+K open
  // (fresh iframe) can restore where the user left off. Gated until the
  // one-time restore above has applied, so it never overwrites the saved
  // session with a stale pre-restore selection.
  useEffect(() => {
    if (loading || !persistReady) return;
    const selectedTabId = activeTabItem?.id ?? null;
    chrome.storage.session.set({ [PREVIEW_SESSION_KEY]: { mode, selectedTabId } }).catch(() => {});
  }, [mode, activeTabItem?.id, loading, persistReady]);

  // Lazily load the pixel thumbnail for the focused tab (Tier 2). Debounced by
  // a dwell period so arrow-key mashing doesn't fire an IndexedDB read per
  // keypress; the previously-displayed thumbnail stays put (never blank)
  // while the user rests on a new row and the fetch resolves.
  const [thumb, setThumb] = useState<{ url: string; capturedAt: number } | null>(null);
  const thumbRef = useRef<{ url: string; capturedAt: number } | null>(null);
  const thumbRequestRef = useRef(0);
  useEffect(() => {
    thumbRef.current = thumb;
  }, [thumb]);
  useEffect(() => {
    return () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current.url);
    };
  }, []);

  const activeUrl = activeTabItem?.url;
  useEffect(() => {
    // Clear synchronously on selection change so the tiered fallback
    // (og:image -> favicon) shows for the new tab instead of the previous
    // tab's stale screenshot while the debounced fetch is pending.
    setThumb((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });

    if (!activeUrl) {
      return;
    }

    const requestId = ++thumbRequestRef.current;
    const timer = setTimeout(() => {
      getThumbnail(hashUrl(activeUrl))
        .then((record) => {
          if (thumbRequestRef.current !== requestId) return; // superseded by a newer selection
          setThumb((prev) => {
            if (prev) URL.revokeObjectURL(prev.url);
            return record ? { url: URL.createObjectURL(record.blob), capturedAt: record.capturedAt } : null;
          });
        })
        .catch(() => {});
    }, THUMB_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [activeUrl]);

  const focusInputAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }, []);

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

  const showRowHint = useCallback((tabId: number, message: string) => {
    setRowHints((prev) => ({ ...prev, [tabId]: message }));
    const existingTimer = hintTimers.current.get(tabId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      hintTimers.current.delete(tabId);
      setRowHints((prev) => {
        if (!prev[tabId]) return prev;
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    }, HINT_MS);
    hintTimers.current.set(tabId, timer);
  }, []);

  const sendPlayToggle = useCallback(
    async (tab: NavigatorTab) => {
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
          setAnnouncement("Playback blocked — click the tab to resume");
          showRowHint(tab.id, "click the tab to resume");
        } else if (result.ok === false) {
          setAnnouncement(`Couldn't reach ${tab.title}`);
          showRowHint(tab.id, "couldn't reach tab");
        } else {
          setAnnouncement(result.playing ? `Playing ${tab.title}` : `Paused ${tab.title}`);
        }
      } catch {
        setAnnouncement(`Couldn't reach ${tab.title}`);
        showRowHint(tab.id, "couldn't reach tab");
      }
    },
    [showRowHint]
  );

  const toggleMute = useCallback(
    (tab: NavigatorTab) => {
      const nextMuted = !tab.muted;
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, muted: nextMuted } : t)));
      setAnnouncement(nextMuted ? `Muted ${tab.title}` : `Unmuted ${tab.title}`);
      void setTabMuted(tab.id, nextMuted).catch(() => {
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, muted: !nextMuted } : t)));
        setAnnouncement(`Couldn't reach ${tab.title}`);
        showRowHint(tab.id, "couldn't reach tab");
      });
    },
    [showRowHint]
  );

  const toggleSelectedPlay = useCallback(() => {
    const tab = audioList[activeIndex];
    if (tab) void sendPlayToggle(tab);
  }, [audioList, activeIndex, sendPlayToggle]);

  const toggleSelectedMute = useCallback(() => {
    const tab = audioList[activeIndex];
    if (tab) toggleMute(tab);
  }, [audioList, activeIndex, toggleMute]);

  const enterAudioMode = useCallback(() => {
    rememberedTabId.current = orderedTabs[activeIndex]?.id ?? null;
    setMode("audio");
    setActiveIndex(0);
    setAnnouncement(`Audio panel, ${playingCount} playing`);
  }, [orderedTabs, activeIndex, playingCount]);

  const enterTabsMode = useCallback(() => {
    setMode("tabs");
    const targetId = rememberedTabId.current;
    const idx = targetId !== null ? orderedTabs.findIndex((tab) => tab.id === targetId) : -1;
    setActiveIndex(idx >= 0 ? idx : 0);
    setAnnouncement("All tabs");
  }, [orderedTabs]);

  const onActivate = useCallback(
    (index: number) => {
      void activate(displayList[index]);
    },
    [displayList, activate]
  );

  const onEscape = useCallback(() => {
    if (query !== "") {
      setQuery("");
      focusInputAtEnd();
    } else if (mode === "audio") {
      enterTabsMode();
    } else {
      void dismiss(true);
    }
  }, [query, mode, enterTabsMode, dismiss, focusInputAtEnd]);

  // Tab mode-cycle, Space play/pause, ArrowLeft/Right mute, and audio-mode
  // Backspace-to-back all live outside the generic list-navigation machinery.
  const preKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.key === "Tab") {
        event.preventDefault();
        if (mode === "tabs") enterAudioMode();
        else enterTabsMode();
        return true;
      }
      if (mode === "audio" && query === "" && event.key === " ") {
        event.preventDefault();
        toggleSelectedPlay();
        return true;
      }
      if (mode === "audio" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        toggleSelectedMute();
        return true;
      }
      if (mode === "audio" && query === "" && event.key === "Backspace") {
        event.preventDefault();
        enterTabsMode();
        return true;
      }
      return false;
    },
    [mode, query, enterAudioMode, enterTabsMode, toggleSelectedPlay, toggleSelectedMute]
  );

  const { listRef, registerItem } = useListNavigation({
    itemCount: displayList.length,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    focusInputAtEnd,
    onActivate,
    onEscape,
    preKeyDown,
  });

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
          <kbd className={kbdClass}>↵</kbd> Switch to tab
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>tab</kbd> tabs
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>esc</kbd> {query !== "" ? "clear" : "back"}
        </span>
      </div>
    ) : (
      <div className="flex items-center justify-end gap-4 border-t border-white/[0.07] px-6 py-3 text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>↵</kbd> Switch to tab
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className={kbdClass}>esc</kbd> {query !== "" ? "Clear" : "Close"}
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
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
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
              onClick={() => (mode === "audio" ? enterTabsMode() : enterAudioMode())}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                mode === "audio"
                  ? "bg-[#0a84ff]/20 text-[#5eaeff] ring-1 ring-[#0a84ff]/40"
                  : "bg-white/[0.08] text-white/70 hover:bg-white/[0.12]"
              }`}
              aria-label={`${playingCount} tab${playingCount === 1 ? "" : "s"} playing audio — toggle audio panel`}
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

        <div
          ref={listRef}
          role="listbox"
          aria-label={mode === "audio" ? "Tabs playing audio" : "Open tabs"}
          aria-activedescendant={activeTabItem ? `tk-row-${activeTabItem.id}` : undefined}
          className="min-h-0 flex-1 overflow-auto px-2 py-2"
        >
          <div key={mode} className="tk-mode-fade space-y-0.5">
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
                const hint = rowHints[tab.id];

                return (
                  <div
                    key={tab.id}
                    id={`tk-row-${tab.id}`}
                    role="option"
                    aria-selected={active}
                    ref={registerItem(index)}
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
                          {hint ?? domainOf(tab.url)}
                        </span>
                      </span>
                    </button>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={
                        uncontrollable
                          ? `Playback unavailable for ${tab.title}`
                          : playing
                            ? `Pause ${tab.title}`
                            : `Play ${tab.title}`
                      }
                      aria-disabled={uncontrollable}
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
                      aria-label={tab.muted ? `Unmute ${tab.title}` : `Mute ${tab.title}`}
                      aria-pressed={tab.muted}
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
                <div className="px-3 py-2 text-xs text-white/55">
                  {query.trim() ? "No matching tabs" : "No other tabs open"}
                </div>
              )}

              {!loading &&
                orderedTabs.map((tab, index) => {
                  const bucket = bucketLabel(tab.lastAccessed, now);
                  const header = showBuckets && bucket !== lastBucket ? bucket : null;
                  if (header) lastBucket = bucket;
                  const active = index === activeIndex;
                  const isDuplicateTitle = (duplicateTitleCounts.get(tab.title) ?? 0) > 1;

                  return (
                    <div key={tab.id}>
                      {header && (
                        <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
                          {header}
                        </div>
                      )}
                      <button
                        ref={registerItem(index)}
                        id={`tk-row-${tab.id}`}
                        role="option"
                        aria-selected={active}
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
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{tab.title}</span>
                          {isDuplicateTitle && (
                            <span className={`block truncate text-[11px] ${active ? "text-white/70" : "text-white/45"}`}>
                              {domainOf(tab.url)}
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                  );
                })}
            </>
          )}
          </div>
        </div>
      </div>

      {/* Right pane: preview of the focused tab */}
      <div className="flex min-h-0 flex-col">
        <div key={mode} className="tk-mode-fade flex min-h-0 flex-1 flex-col">
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
                Takes 60% of the pane height; the description below gets 40%.
                Keyed by tab + resolved tier so an upgrade or a selection
                change cross-fades in rather than hard-swapping. */}
            <div
              className="relative min-h-0 flex-[3] overflow-hidden border-b border-white/[0.07]"
              style={{ background: activeCard?.themeColor ? `${activeCard.themeColor}22` : "rgba(255,255,255,0.03)" }}
            >
              <div
                key={`${activeTabItem.id}:${thumb?.url ?? activeCard?.ogImage ?? "icon"}`}
                className="tk-hero-fade h-full w-full"
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
    </div>
  );
}
