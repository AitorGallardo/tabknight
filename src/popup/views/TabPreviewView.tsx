import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { AppWindow, Bookmark, Clock3, Command, EyeOff, Globe2, Moon, Music, Pause, Pin, Play, Search, Volume2, VolumeX, X } from "lucide-react";
import { activateTab, getAllTabs, openUrlAsTab, searchBookmarks, searchHistory, setTabMuted } from "../lib/chrome-api";
import { executeBrowserCommand } from "../lib/browser-command-executor";
import { findBrowserCommands, getBrowserCommand, listBrowserCommands } from "../lib/browser-commands";
import type { BrowserCommand, BrowserCommandId, BrowserCommandTab } from "../lib/browser-commands";
import { getAllCards, getThumbnail, redactAllCardText } from "../lib/preview/db";
import { hashUrl } from "../lib/preview/hash";
import type {
  AudibleStateChangedMessage,
  ContentCard,
  MediaControlResult,
  MediaStatusRequestMessage,
  MediaStatusResult,
  TabRemovedMessage,
  TabThumbnail,
} from "../lib/preview/types";
import { AudioEq } from "../components/AudioEq";
import { Favicon } from "../components/Favicon";
import { Kbd } from "../components/Kbd";
import { ResultLabels } from "../components/ResultLabels";
import { scoreTab } from "../lib/rank";
import { rankIntentResults } from "../lib/intent-search";
import type { IntentBookmark, IntentHistoryEntry, IntentResult } from "../lib/intent-search";
import { useListNavigation } from "../hooks/useListNavigation";
import {
  DEFAULT_PREVIEW_TEXT_PREFERENCE,
  PREVIEW_TEXT_PREFERENCE_KEY,
  ensurePreviewTextPrivacy,
  isPreviewTextPreference,
  shouldSuppressPreviewText,
  type PreviewTextPreference,
} from "../lib/preview/privacy";

interface TabPreviewViewProps {
  returnToTabId?: number | null;
  contextId?: string | null;
  /** When true, the view is embedded in an in-page iframe overlay. Dismissal
   *  closes the overlay via postMessage instead of closing a standalone tab. */
  overlay?: boolean;
  invocationId?: string | null;
}

function postToParent(type: "ready" | "close", invocationId?: string | null): void {
  try {
    window.parent.postMessage({ source: "tabknight-preview", type, invocationId }, "*");
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
  discarded?: boolean;
}

function commandTargetForTab(tab: NavigatorTab): BrowserCommandTab {
  return {
    id: tab.id,
    title: tab.title,
    pinned: tab.pinned,
    muted: tab.muted,
  };
}

type PreviewResult =
  | { kind: "command"; id: string; command: BrowserCommand }
  | { kind: "intent"; id: string; intent: IntentResult };

function resultDomId(result: PreviewResult): string {
  return `tk-result-${result.id.replace(":", "-")}`;
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

/* -------------------------- preview-fidelity spec -------------------------- */
const HERO_ASPECT = "16 / 10";
const OG_MIN_WIDTH_PX = 200;
const OG_SQUARE_LO = 0.8;
const OG_SQUARE_HI = 1.25;
const THUMB_UPSCALE_MAX = 1.15;
/** Tier-2 thumbnails are only "cover"-cropped when their captured aspect is
 *  close to the hero's 16/10 — otherwise a cover-crop reads as a zoomed-in
 *  fragment, so we fall back to the letterboxed contain treatment. */
const THUMB_ASPECT_TARGET = 1.6;
const THUMB_ASPECT_TOLERANCE = 0.12;
/** Thumbnails captured before width/height were recorded (or genuinely
 *  low-res legacy captures) defer to a fresher og:image when one exists. */
const LEGACY_THUMB_MIN_WIDTH = 900;
const FRESH_TICK_MS = 30_000;
const STALE_LABEL_MS = 3_600_000;
const PREFETCH_RADIUS = 2;
const MAX_ROW_GLYPHS = 2;
const THUMB_CACHE_MAX = 12;
const THUMB_PREFETCH_CONCURRENCY = 3;
/** Approximate box height reserved before a row mounts (content-visibility). */
const ROW_CONTAIN_SIZE = "0 36px";
/** Rows with a domain subtitle (duplicate titles) render a second line — reserve more height. */
const ROW_CONTAIN_SIZE_DUPLICATE = "0 44px";
/** Only pay the content-visibility bookkeeping cost once lists get long. */
const CONTENT_VISIBILITY_THRESHOLD = 60;

const QUICK_ACTION_CODE_TO_COMMAND: Readonly<Record<string, BrowserCommandId>> = {
  KeyW: "close-tab",
  KeyD: "duplicate-tab",
  KeyR: "reload-tab",
  KeyN: "new-tab",
};

/* --------------------------- featured rail spec ---------------------------- */
const FEATURED_RECENT_COUNT = 5;
const FEATURED_MOST_VISITED_COUNT = 5;
const FEATURED_MIN_VISITS = 2;

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

/**
 * Highlight the first case-insensitive substring match of `query` in `text`.
 * scoreTab (lib/rank.ts) only ever awards title points via `===`/`startsWith`/
 * `includes` — all substring checks, never a fuzzy subsequence — so a single
 * contiguous match is always the right span to highlight.
 */
function highlightTitle(text: string, query: string, active: boolean): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  const matchClass = active ? "rounded-[3px] bg-white/25 px-[1px] text-white" : "rounded-[3px] bg-white/15 px-[1px] text-white";
  return (
    <>
      {before}
      <span className={matchClass}>{match}</span>
      {after}
    </>
  );
}

type RowGlyph = "audible" | "muted" | "pinned" | "discarded" | "other-window";

/** Trailing status glyphs for a tabs-mode row, priority-ordered, capped. */
function rowGlyphs(tab: NavigatorTab, currentWindowId: number | null): RowGlyph[] {
  const candidates: RowGlyph[] = [];
  if (tab.audible) candidates.push("audible");
  if (tab.muted) candidates.push("muted");
  if (tab.pinned) candidates.push("pinned");
  if (tab.discarded) candidates.push("discarded");
  if (currentWindowId !== null && tab.windowId !== currentWindowId) candidates.push("other-window");
  return candidates.slice(0, MAX_ROW_GLYPHS);
}

function RowGlyphs({ tab, currentWindowId, active }: { tab: NavigatorTab; currentWindowId: number | null; active: boolean }) {
  const glyphs = rowGlyphs(tab, currentWindowId);
  if (glyphs.length === 0) return null;
  const iconClass = active ? "h-3 w-3 text-white/85" : "h-3 w-3 text-black/40 dark:text-white/35";
  return (
    <span className="flex shrink-0 items-center gap-1">
      {glyphs.map((glyph) => {
        switch (glyph) {
          case "audible":
            return (
              <span key="audible" className="scale-[0.85]">
                <AudioEq playing />
              </span>
            );
          case "muted":
            return <VolumeX key="muted" className={iconClass} />;
          case "pinned":
            return <Pin key="pinned" className={iconClass} />;
          case "discarded":
            return <Moon key="discarded" className={active ? "h-3 w-3 text-white/85" : "h-3 w-3 text-black/35 dark:text-white/30"} />;
          case "other-window":
            return (
              <span
                key="other-window"
                className={`grid place-items-center rounded-[3px] border px-1 text-[9px] leading-none ${
                  active ? "border-white/35 text-white/85" : "border-black/15 text-black/45 dark:border-white/15 dark:text-white/40"
                }`}
              >
                <AppWindow className="h-2.5 w-2.5" />
              </span>
            );
        }
      })}
    </span>
  );
}

/** Tier-2-only freshness chip: green dot + relative time while recent, dims after STALE_LABEL_MS. */
function FreshnessChip({ capturedAt, now }: { capturedAt: number; now: number }) {
  const fresh = now - capturedAt < STALE_LABEL_MS;
  const label = relativeTime(capturedAt, now);
  const justNow = label === "just now";
  return (
    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-md ring-1 ring-white/10">
      <span
        className={`h-1.5 w-1.5 rounded-full ${fresh ? "bg-[#30d158]" : "bg-white/40"} ${justNow ? "tk-pulse" : ""}`}
      />
      <span className={fresh ? undefined : "text-white/50"}>{label}</span>
    </span>
  );
}

/** mm:ss, or h:mm:ss past one hour. */
function formatMediaTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Audio-mode "now playing" block: elapsed/total + a thin progress bar, or an
 *  elapsed-only "Live" row for streams (Infinity/unknown duration). Renders
 *  nothing when the poll came back empty — no dead chrome. */
function MediaNowPlaying({ tab, status }: { tab: NavigatorTab; status: MediaStatusResult }) {
  if (!status.ok || !status.mediaCount) return null;
  const playing = !!status.playing;
  const currentTime = status.currentTime ?? 0;
  const live = status.duration === undefined || !Number.isFinite(status.duration);
  const pct = !live && status.duration ? Math.min(100, Math.max(0, (currentTime / status.duration) * 100)) : 0;
  const session = status.session;

  return (
    <div className="mt-3">
      {session?.title && (
        <div className="truncate text-[13px] font-medium text-white/90">
          {session.title}
          {session.artist && <span className="text-white/45"> · {session.artist}</span>}
        </div>
      )}
      <div className={`text-[11px] text-white/45 ${session?.title ? "mt-1" : ""}`}>
        {playing ? "Playing" : "Paused"}
        {tab.muted ? " · muted" : ""}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/45">
        <span className="tabular-nums">{formatMediaTime(currentTime)}</span>
        {live ? (
          <span className="shrink-0">Live</span>
        ) : (
          <>
            <div className="h-[3px] flex-1 rounded-full bg-white/15">
              <div className="h-full rounded-full bg-white/70" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums">{formatMediaTime(status.duration ?? 0)}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Top-edge scrim shared by every image-backed hero tier for text/chip contrast. */
function HeroTopScrim() {
  return <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/25 to-transparent" />;
}

/** Tier 0.5 — replaces the giant favicon fallback with a title/description card. */
function HeroTypographicCard({ tab, card }: { tab: NavigatorTab; card?: ContentCard }) {
  const themeColor = card?.themeColor;
  const siteName = card?.siteName || domainOf(tab.url);
  return (
    <div
      className="relative flex h-full flex-col justify-end overflow-hidden p-6"
      style={{ background: `linear-gradient(155deg, ${themeColor || "#1c1c1e"}33 0%, rgba(10,10,12,0.6) 70%)` }}
    >
      <div
        className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full blur-3xl"
        style={{ background: `${themeColor || "#0a84ff"}22` }}
      />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white/[0.08]">
            <Favicon pageUrl={tab.url} favIconUrl={tab.favIconUrl} size={24} className="h-full w-full" />
          </span>
          <span className="truncate text-[12px] font-medium tracking-[-0.01em] text-white/55">{siteName}</span>
        </div>
        <h2 className="line-clamp-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-white/95">
          {tab.title}
        </h2>
        {card?.description && (
          <p className="line-clamp-3 mt-2 text-[13px] leading-relaxed text-white/60">{card.description}</p>
        )}
      </div>
    </div>
  );
}

export function TabPreviewView({
  returnToTabId = null,
  contextId = null,
  overlay = false,
  invocationId = null,
}: TabPreviewViewProps) {
  const [tabs, setTabs] = useState<NavigatorTab[]>([]);
  const [cards, setCards] = useState<Map<string, ContentCard>>(new Map());
  // tabId -> times activated this session, maintained by the background;
  // powers the "Most visited" featured rail section (best-effort read).
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [commandTarget, setCommandTarget] = useState<BrowserCommandTab | null>(null);
  const commandInFlightRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [intentBookmarks, setIntentBookmarks] = useState<IntentBookmark[]>([]);
  const [intentHistory, setIntentHistory] = useState<IntentHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Live clock, ticked every FRESH_TICK_MS — drives the freshness chip's
  // "just now"/"Nm ago" label and the metadata pane's "captured …" text.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRESH_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Audio Playground (Cmd+K "audio" mode): tabs mode is the default, primary
  // surface; audio mode is entered via the ♪ pill or Tab key.
  const [mode, setMode] = useState<"tabs" | "audio">("tabs");
  // Tabs render synchronously from local state. Bookmark/history sources join
  // only after typing, and stale responses are discarded by request identity.
  const intentRequestRef = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const requestId = ++intentRequestRef.current;
    setIntentBookmarks([]);
    setIntentHistory([]);
    if (!q || q.startsWith(">") || mode !== "tabs") return;

    void searchBookmarks(q)
      .then((nodes) => {
        if (intentRequestRef.current !== requestId) return;
        setIntentBookmarks(
          nodes
            .filter((node): node is chrome.bookmarks.BookmarkTreeNode & { url: string } => !!node.url)
            .slice(0, 30)
            .map((node) => ({ id: node.id, title: node.title || node.url, url: node.url, dateAdded: node.dateAdded }))
        );
      })
      .catch(() => {});

    // Avoid broad history reads for accidental one-character input.
    if (q.length < 2) return;
    void searchHistory(q)
      .then((entries) => {
        if (intentRequestRef.current !== requestId) return;
        setIntentHistory(
          entries
            .filter((entry): entry is chrome.history.HistoryItem & { url: string } => !!entry.url)
            .map((entry) => ({
              id: entry.id,
              title: entry.title || entry.url,
              url: entry.url,
              lastVisitTime: entry.lastVisitTime,
              visitCount: entry.visitCount,
            }))
        );
      })
      .catch(() => {});
  }, [query, mode]);
  // Tabs-mode selection to restore when coming back from audio mode.
  const rememberedTabId = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [previewTextPreference, setPreviewTextPreference] = useState<PreviewTextPreference>(
    DEFAULT_PREVIEW_TEXT_PREFERENCE
  );
  const [revealedTextHash, setRevealedTextHash] = useState<string | null>(null);

  useEffect(() => {
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const value = changes[PREVIEW_TEXT_PREFERENCE_KEY]?.newValue;
      setPreviewTextPreference(isPreviewTextPreference(value) ? value : DEFAULT_PREVIEW_TEXT_PREFERENCE);
      setRevealedTextHash(null);
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);
  // Gates the featured-rail entrance stagger (tk-row-in) to the very first
  // paint that has real rows — flips false once loading finishes, so a later
  // re-rank (search, activation) never replays the stagger.
  const initialFeaturedMountRef = useRef(true);
  useEffect(() => {
    if (loading) return;
    initialFeaturedMountRef.current = false;
  }, [loading]);
  // Session-sticky membership — once a tab is audible/muted while the overlay
  // is open, its row stays until the overlay closes (it just flips to paused).
  const [audioTabIds, setAudioTabIds] = useState<Set<number>>(new Set());
  const [playback, setPlayback] = useState<Map<number, PlaybackState>>(new Map());
  const [rowHints, setRowHints] = useState<Record<number, string>>({});
  const pauseTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const hintTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const privacyReady = ensurePreviewTextPrivacy(redactAllCardText);
      const [allTabs, currentWindow, allCards, visitCountsResult, loadedTextPreference] = await Promise.all([
        getAllTabs(),
        chrome.windows.getCurrent(),
        privacyReady.then(() => getAllCards()).catch(() => [] as ContentCard[]),
        chrome.storage.session
          .get("visitCounts")
          .then((result) => (result as { visitCounts?: Record<string, number> }).visitCounts ?? {})
          .catch(() => ({}) as Record<string, number>),
        privacyReady,
      ]);

      setCurrentWindowId(currentWindow.id ?? null);
      setCards(new Map(allCards.map((card) => [card.urlHash, card])));
      setVisitCounts(visitCountsResult);
      setPreviewTextPreference(loadedTextPreference);

      // Hide TabKnight's own preview page and the tab the user is currently on,
      // so the previously-visited tab (sorted by lastAccessed) ranks first.
      const selfUrl = chrome.runtime.getURL("popup/index.html");
      const currentWindowId = currentWindow.id;
      // A standalone preview has an explicit origin. If it disappeared, do
      // not silently retarget whichever unrelated tab is active now.
      const originTab =
        returnToTabId !== null
          ? allTabs.find((tab) => tab.id === returnToTabId)
          : allTabs.find(
              (tab) => tab.active && tab.windowId === currentWindowId && !!tab.url && !tab.url.startsWith(selfUrl)
            );
      setCommandTarget(
        originTab?.id !== undefined
          ? {
              id: originTab.id,
              title: originTab.title || originTab.url || "Current tab",
              pinned: !!originTab.pinned,
              muted: !!originTab.mutedInfo?.muted,
            }
          : null
      );

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
          discarded: tab.discarded || false,
        }));

      setTabs(normalized);
      setLoading(false);
    };

    void load();
  }, [returnToTabId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [overlay]);

  // Tell the host content script the iframe rendered (cancels its CSP
  // fallback + kills the host-page shimmer). Gated on tabs actually being
  // ready so the shimmer hands off to real content, not a bare "Loading
  // tabs…" flash; a safety timeout fires anyway if loading gets stuck, well
  // before the host's own 4000ms teardown.
  const readySentRef = useRef(false);
  useEffect(() => {
    if (!overlay || readySentRef.current) return;
    if (!loading) {
      readySentRef.current = true;
      postToParent("ready", invocationId);
      return;
    }
    const timer = setTimeout(() => {
      readySentRef.current = true;
      postToParent("ready", invocationId);
    }, 1500);
    return () => clearTimeout(timer);
  }, [invocationId, overlay, loading]);

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
      const msg = message as Partial<AudibleStateChangedMessage> | Partial<TabRemovedMessage>;
      if (!msg || typeof msg.tabId !== "number") return;
      const { tabId } = msg;

      // Background best-effort broadcast when a tab closes elsewhere — prune
      // every piece of per-tab state so a closed tab can't linger in the
      // audio rail or leave a stale timer running.
      if (msg.type === "TAB_REMOVED") {
        setTabs((prev) => prev.filter((t) => t.id !== tabId));
        setAudioTabIds((prev) => {
          if (!prev.has(tabId)) return prev;
          const next = new Set(prev);
          next.delete(tabId);
          return next;
        });
        setPlayback((prev) => {
          if (!prev.has(tabId)) return prev;
          const next = new Map(prev);
          next.delete(tabId);
          return next;
        });
        setRowHints((prev) => {
          if (!(tabId in prev)) return prev;
          const next = { ...prev };
          delete next[tabId];
          return next;
        });
        const pauseTimer = pauseTimers.current.get(tabId);
        if (pauseTimer) {
          clearTimeout(pauseTimer);
          pauseTimers.current.delete(tabId);
        }
        const hintTimer = hintTimers.current.get(tabId);
        if (hintTimer) {
          clearTimeout(hintTimer);
          hintTimers.current.delete(tabId);
        }
        return;
      }

      if (msg.type !== "AUDIBLE_STATE_CHANGED") return;
      const { audible, muted } = msg;

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
          // A tab previously probed as having no controllable media (mediaCount
          // === 0) just went audible again — clear the stale "known empty" mark
          // so the play/pause button and the 1Hz status poll re-probe it.
          const reviveKnownEmpty = existing?.mediaCount === 0;
          if (existing?.playing && !reviveKnownEmpty) return prev;
          const next = new Map(prev);
          next.set(tabId, {
            ...existing,
            playing: true,
            ...(reviveKnownEmpty ? { mediaCount: undefined } : {}),
          });
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

  // Flat, base-ranked list (unfeatured). This is the whole list when
  // searching; when not searching it's the source the featured sections and
  // bucketed remainder below are carved out of.
  const rankedTabs = useMemo(() => {
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

  // Featured rail sections (tabs mode, no active search only): "Recent" is the
  // top N of rankedTabs (already lastAccessed-desc when unsearched); "Most
  // visited" is carved from what's left, ranked by session visit count, with
  // a floor so a single stray visit doesn't qualify. Both are disjoint from
  // each other and from the bucketed remainder below.
  const featured = useMemo(() => {
    if (query.trim() !== "") return null;
    const recent = rankedTabs.slice(0, FEATURED_RECENT_COUNT);
    const recentIds = new Set(recent.map((tab) => tab.id));
    const afterRecent = rankedTabs.filter((tab) => !recentIds.has(tab.id));
    const mostVisited = afterRecent
      .map((tab) => ({ tab, count: visitCounts[tab.id] ?? 0 }))
      .filter(({ count }) => count >= FEATURED_MIN_VISITS)
      .sort((a, b) => b.count - a.count)
      .slice(0, FEATURED_MOST_VISITED_COUNT)
      .map(({ tab }) => tab);
    const mostVisitedIds = new Set(mostVisited.map((tab) => tab.id));
    const remainder = afterRecent.filter((tab) => !mostVisitedIds.has(tab.id));
    return { recent, mostVisited, remainder };
  }, [rankedTabs, query, visitCounts]);

  // Single ordered array driving both rendering and keyboard nav: featured
  // Recent rows, then Most visited, then the bucketed remainder — exactly the
  // visual order. Falls back to the flat ranked list while searching.
  const orderedTabs = useMemo(
    () => (featured ? [...featured.recent, ...featured.mostVisited, ...featured.remainder] : rankedTabs),
    [featured, rankedTabs]
  );
  const intentResults = useMemo(
    () =>
      rankIntentResults({
        query,
        tabs,
        bookmarks: intentBookmarks,
        history: intentHistory,
        currentWindowId,
      }),
    [query, tabs, intentBookmarks, intentHistory, currentWindowId]
  );
  const featuredRecentCount = featured?.recent.length ?? 0;
  const featuredMostVisitedCount = featured?.mostVisited.length ?? 0;

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

  const commandResults = useMemo(
    () => (mode === "tabs" ? findBrowserCommands(query, { targetTab: commandTarget }) : []),
    [mode, query, commandTarget]
  );
  const commandMode = mode === "tabs" && query.trimStart().startsWith(">");
  // Keyboard navigation indexes one typed list so commands and all intent
  // sources preserve their visual order under Arrow keys and Enter.
  const displayList = useMemo<PreviewResult[]>(
    () => {
      const intents: IntentResult[] = mode === "audio"
        ? audioList.map((tab) => ({
            type: "tab",
            key: `tab:${tab.id}`,
            sourceLabel: "Open tab",
            actionLabel: "Switch to tab",
            score: 0,
            tab,
          }))
        : commandMode
          ? []
          : query.trim()
          ? intentResults
          : orderedTabs.map((tab) => ({
              type: "tab",
              key: `tab:${tab.id}`,
              sourceLabel: "Open tab",
              actionLabel: "Switch to tab",
              score: 0,
              tab,
            }));
      return [
        ...commandResults.map((command) => ({ kind: "command" as const, id: `command:${command.id}`, command })),
        ...intents.map((intent) => ({ kind: "intent" as const, id: intent.key, intent })),
      ];
    },
    [mode, audioList, query, intentResults, orderedTabs, commandResults, commandMode]
  );

  // Identity re-anchoring: `activeIndex` is a raw index into `displayItems`,
  // but the list can reshuffle out from under it — e.g. a tab newly going
  // audible is inserted at the front of audioList — silently pointing the
  // index at the wrong tab (Enter would activate/toggle the wrong row).
  // `selectedIdRef` tracks which tab id the index is *supposed* to mean;
  // this runs after every render (no dep array, same idiom as
  // useRovingCursor's prevKeysRef) so it both re-anchors on a pure identity
  // shift and stays synced when the index moves for any other reason.
  // Query changes and mode switches (Tab key) already pick
  // their own target index elsewhere — those are left alone here (skipped
  // via queryChanged/modeChanged) so this never fights that logic.
  const selectedIdRef = useRef<string | null>(displayList[activeIndex]?.id ?? null);
  const prevDisplayKeysRef = useRef<string[]>(displayList.map((item) => item.id));
  const prevModeRef = useRef(mode);
  const prevQueryRef = useRef(query);
  useEffect(() => {
    const currentKeys = displayList.map((item) => item.id);
    const modeChanged = prevModeRef.current !== mode;
    const queryChanged = prevQueryRef.current !== query;
    const keysChanged =
      prevDisplayKeysRef.current.length !== currentKeys.length ||
      prevDisplayKeysRef.current.some((key, i) => key !== currentKeys[i]);

    prevModeRef.current = mode;
    prevQueryRef.current = query;
    prevDisplayKeysRef.current = currentKeys;

    let nextIndex = activeIndex;
    if (!modeChanged && !queryChanged && keysChanged) {
      const id = selectedIdRef.current;
      const found = id !== null ? currentKeys.indexOf(id) : -1;
      nextIndex = found >= 0 ? found : Math.max(0, Math.min(activeIndex, currentKeys.length - 1));
    }

    selectedIdRef.current = currentKeys[nextIndex] ?? null;
    if (nextIndex !== activeIndex) setActiveIndex(nextIndex);
  });

  const activeResult = displayList[activeIndex];
  const activeIntent = activeResult?.kind === "intent" ? activeResult.intent : undefined;
  const activeTabItem = activeIntent?.type === "tab" ? activeIntent.tab : undefined;
  const activeCommand = activeResult?.kind === "command" ? activeResult.command : undefined;
  // Quick actions always operate on the highlighted tab. When command search
  // temporarily replaces tab rows, retain the last highlighted tab as the
  // command target instead of silently falling back to the page underneath.
  const selectedCommandTarget = activeTabItem ? commandTargetForTab(activeTabItem) : commandTarget;
  useEffect(() => {
    if (mode !== "tabs" || !activeTabItem) return;
    const next = commandTargetForTab(activeTabItem);
    setCommandTarget((current) =>
      current?.id === next.id && current.pinned === next.pinned && current.muted === next.muted
        ? current
        : next
    );
  }, [mode, activeTabItem?.id, activeTabItem?.pinned, activeTabItem?.muted]);
  const availableCommands = useMemo(
    () => (mode === "tabs" ? listBrowserCommands({ targetTab: selectedCommandTarget }) : []),
    [mode, selectedCommandTarget]
  );
  const quickActions = useMemo(
    () =>
      availableCommands.filter(({ id }) =>
        ["close-tab", "duplicate-tab", "pin-tab", "unpin-tab", "mute-tab", "unmute-tab"].includes(id)
      ),
    [availableCommands]
  );
  const activeCard = activeTabItem ? cards.get(hashUrl(activeTabItem.url)) : undefined;
  const activeCardHash = activeTabItem ? hashUrl(activeTabItem.url) : null;
  const previewTextSuppressed = !!activeTabItem && shouldSuppressPreviewText(activeTabItem.url, previewTextPreference);
  const previewTextVisible = !previewTextSuppressed || revealedTextHash === activeCardHash;
  const visibleCard =
    previewTextVisible || !activeCard
      ? activeCard
      : { ...activeCard, description: undefined, excerpt: undefined };

  useEffect(() => {
    if (loading) return;
    if (!activeTabItem) {
      setAnnouncement(mode === "audio" ? "No audio tabs" : "No matching tabs");
      return;
    }
    setAnnouncement(
      `${activeTabItem.title}, ${activeIndex + 1} of ${displayList.length}. ${mode === "audio" ? "Audio tab" : "Open tab"}. Enter to switch.`
    );
  }, [activeTabItem?.id, activeIndex, displayList.length, loading, mode, query]);

  // "Now playing" media block (audio mode only): 1Hz poll of the selected
  // row's playback position. Kept in its own state, separate from `playback`,
  // so the 1Hz tick only re-renders what actually needs it.
  const activeAudioTab = mode === "audio" ? activeTabItem : undefined;
  const [mediaStatus, setMediaStatus] = useState<{ tabId: number; result: MediaStatusResult } | null>(null);
  // A prior poll (or a play/pause attempt) already established this tab has
  // no controllable media — stop bothering it every second.
  const activeAudioKnownEmpty = activeAudioTab ? playback.get(activeAudioTab.id)?.mediaCount === 0 : false;

  useEffect(() => {
    if (!activeAudioTab || activeAudioKnownEmpty) {
      setMediaStatus(null);
      return;
    }
    const tabId = activeAudioTab.id;
    let cancelled = false;

    const poll = async () => {
      let result: MediaStatusResult;
      try {
        result = (await chrome.runtime.sendMessage({
          type: "MEDIA_STATUS_REQUEST",
          tabId,
        } as MediaStatusRequestMessage)) as MediaStatusResult;
      } catch {
        result = { ok: false, error: "unreachable" };
      }
      if (cancelled) return; // Selection moved on since this request was sent.
      setMediaStatus({ tabId, result });

      // Drift correction: the content script is the source of truth for
      // playback state; reconcile if it disagrees with our local guess.
      if (result.ok && typeof result.playing === "boolean") {
        setPlayback((prev) => {
          const existing = prev.get(tabId);
          if (existing?.playing === result.playing && existing?.mediaCount === result.mediaCount) return prev;
          const next = new Map(prev);
          next.set(tabId, { playing: result.playing as boolean, mediaCount: result.mediaCount ?? existing?.mediaCount });
          return next;
        });
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudioTab?.id, activeAudioKnownEmpty]);

  // Lazily load the pixel thumbnail for the focused tab (Tier 2). Debounced by
  // a dwell period so arrow-key mashing doesn't fire an IndexedDB read per
  // keypress; the previously-displayed thumbnail stays put (never blank)
  // while the user rests on a new row and the fetch resolves.
  const [thumb, setThumb] = useState<{ url: string; capturedAt: number; width?: number; height?: number } | null>(
    null
  );
  const thumbRef = useRef<{ url: string; capturedAt: number; width?: number; height?: number } | null>(null);
  const thumbRequestRef = useRef(0);
  useEffect(() => {
    thumbRef.current = thumb;
  }, [thumb]);
  useEffect(() => {
    return () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current.url);
    };
  }, []);

  // Neighbor-prefetch cache (perceived fluidity): holds raw TabThumbnail
  // records (never object URLs) keyed by urlHash, small LRU. Only the
  // currently-displayed thumbnail ever gets a live object URL — created on
  // demand and revoked exactly where `thumb` is replaced/unmounted above —
  // so eviction here never has to worry about revoking anything.
  const thumbCacheRef = useRef<Map<string, TabThumbnail>>(new Map());
  const thumbInFlightRef = useRef<Set<string>>(new Set());

  const cacheGetThumb = useCallback((urlHash: string): TabThumbnail | undefined => {
    const cache = thumbCacheRef.current;
    const rec = cache.get(urlHash);
    if (rec) {
      // Bump recency for LRU.
      cache.delete(urlHash);
      cache.set(urlHash, rec);
    }
    return rec;
  }, []);

  const cacheSetThumb = useCallback((urlHash: string, rec: TabThumbnail) => {
    const cache = thumbCacheRef.current;
    cache.delete(urlHash);
    cache.set(urlHash, rec);
    if (cache.size > THUMB_CACHE_MAX) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
  }, []);

  // True while the Tier-2 read for the current selection hasn't resolved
  // yet (cache miss + in-flight DB read). While pending, the hero renders a
  // plain color wash instead of committing to og:image/typographic, so a row
  // with a thumbnail never flashes a lower tier before the read comes back —
  // see thumbTier/heroTier below.
  const [thumbPending, setThumbPending] = useState(false);

  const activeUrl = activeTabItem?.url;
  useEffect(() => {
    // Clear synchronously on selection change so a stale screenshot never
    // lingers under the new tab's row; heroTier falls back to the neutral
    // "pending" wash (not og:image/typographic) until a record — or a
    // confirmed absence of one — comes back.
    setThumbPending(true);
    setThumb((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });

    if (!activeUrl) {
      setThumbPending(false);
      return;
    }

    const urlHash = hashUrl(activeUrl);
    const requestId = ++thumbRequestRef.current;

    const applyRecord = (record: TabThumbnail | undefined) => {
      if (thumbRequestRef.current !== requestId) return; // superseded by a newer selection
      setThumbPending(false);
      setThumb((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return record
          ? {
              url: URL.createObjectURL(record.blob),
              capturedAt: record.capturedAt,
              width: record.width,
              height: record.height,
            }
          : null;
      });
    };

    // Consult the neighbor-prefetch cache before ever hitting IndexedDB —
    // this is the fast path when the user arrows onto a row we already
    // warmed. Cache hits skip the debounce too, since there's no I/O to wait
    // out; only a real DB read needs the dwell period.
    const cached = cacheGetThumb(urlHash);
    if (cached) {
      applyRecord(cached);
      // The cache is a point-in-time LRU snapshot — a fresher capture may
      // already be sitting in IndexedDB (e.g. a scroll-settle screenshot
      // landed after this entry was warmed). Revalidate in the background;
      // applyRecord's requestId guard makes this a no-op if the selection
      // has moved on by the time it resolves.
      getThumbnail(urlHash)
        .then((fresh) => {
          if (!fresh || fresh.capturedAt <= cached.capturedAt) return;
          cacheSetThumb(urlHash, fresh);
          applyRecord(fresh);
        })
        .catch(() => {});
      return;
    }

    const timer = setTimeout(() => {
      getThumbnail(urlHash)
        .then((record) => {
          if (record) cacheSetThumb(urlHash, record);
          applyRecord(record);
        })
        .catch(() => {
          if (thumbRequestRef.current === requestId) setThumbPending(false);
        });
    }, THUMB_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [activeUrl, cacheGetThumb, cacheSetThumb]);

  // Neighbor prefetch: warm the thumbnail cache for the rows just off-screen
  // around the current selection so arrowing onto them is instant. Capped at
  // THUMB_PREFETCH_CONCURRENCY in-flight reads via a simple Set; skips
  // anything already cached or already being fetched.
  useEffect(() => {
    if (displayList.length === 0) return;
    const offsets: number[] = [];
    for (let d = 1; d <= PREFETCH_RADIUS; d++) offsets.push(-d, d);
    const queue: string[] = [];
    for (const offset of offsets) {
      const neighbor = displayList[activeIndex + offset];
      if (!neighbor || neighbor.kind !== "intent" || neighbor.intent.type !== "tab") continue;
      const neighborHash = hashUrl(neighbor.intent.tab.url);
      if (thumbCacheRef.current.has(neighborHash) || thumbInFlightRef.current.has(neighborHash)) continue;
      queue.push(neighborHash);
    }
    if (queue.length === 0) return;

    let cancelled = false;
    const runNext = () => {
      if (cancelled) return;
      if (thumbInFlightRef.current.size >= THUMB_PREFETCH_CONCURRENCY) return;
      const nextHash = queue.shift();
      if (!nextHash) return;
      thumbInFlightRef.current.add(nextHash);
      getThumbnail(nextHash)
        .then((record) => {
          if (record) cacheSetThumb(nextHash, record);
        })
        .catch(() => {})
        .finally(() => {
          thumbInFlightRef.current.delete(nextHash);
          runNext();
        });
    };
    for (let i = 0; i < THUMB_PREFETCH_CONCURRENCY; i++) runNext();

    return () => {
      cancelled = true;
    };
  }, [displayList, activeIndex, cacheSetThumb]);

  // Hero box width, measured live — used to decide whether a Tier-2
  // thumbnail would need to be upscaled to fill the pane (see THUMB_UPSCALE_MAX).
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroBoxWidth, setHeroBoxWidth] = useState(600);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setHeroBoxWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // og:image demotions persist across re-selection (keyed by urlHash) so a
  // rejected og:image doesn't flash back in if the user tabs away and back.
  const [ogDemoted, setOgDemoted] = useState<Set<string>>(new Set());
  const activeUrlHash = activeTabItem ? hashUrl(activeTabItem.url) : null;
  const ogRejected = activeUrlHash !== null && ogDemoted.has(activeUrlHash);
  const ogImage = !ogRejected ? activeCard?.ogImage : undefined;

  // Audio-mode-only top-priority hero: album art from the selected tab's
  // mediaSession metadata, when the 1Hz poll has resolved one for it. Failed
  // loads (hotlink protection) are tracked by URL so a rejected artwork
  // doesn't flash back in on re-selection, same idiom as ogDemoted.
  const [artworkFailed, setArtworkFailed] = useState<Set<string>>(new Set());
  const audioArtworkUrl =
    mode === "audio" && activeAudioTab && mediaStatus?.tabId === activeAudioTab.id
      ? mediaStatus.result.session?.artworkUrl
      : undefined;
  const artworkUrl = audioArtworkUrl && !artworkFailed.has(audioArtworkUrl) ? audioArtworkUrl : undefined;

  const handleArtworkError = useCallback(() => {
    if (!audioArtworkUrl) return;
    setArtworkFailed((prev) => {
      if (prev.has(audioArtworkUrl)) return prev;
      const next = new Set(prev);
      next.add(audioArtworkUrl);
      return next;
    });
  }, [audioArtworkUrl]);

  // Resolve the tier a Tier-2 thumbnail alone would render at (or null if
  // there's no thumbnail). Small captures still force "contain" outright
  // (upscaling a small image to cover the hero looks soft); otherwise "cover"
  // is only used when the capture's aspect is close to the hero's 16/10 —
  // a mismatched aspect crops a chunk out and reads as a zoomed-in fragment,
  // so it falls back to the letterboxed contain treatment instead. Missing
  // width/height (older records) keeps the pre-existing cover-by-default
  // behavior.
  const thumbTier: "thumb-cover" | "thumb-contain" | null = !thumb
    ? null
    : thumb.width === undefined
      ? "thumb-cover"
      : thumb.width < heroBoxWidth * THUMB_UPSCALE_MAX
        ? "thumb-contain"
        : thumb.height === undefined
          ? "thumb-cover"
          : Math.abs(thumb.width / thumb.height - THUMB_ASPECT_TARGET) / THUMB_ASPECT_TARGET <= THUMB_ASPECT_TOLERANCE
            ? "thumb-cover"
            : "thumb-contain";

  // Legacy/low-res thumbnails (captured before width/height were recorded
  // reliably, or genuinely small) defer to a fresher og:image when one is
  // available and hasn't been demoted; the thumbnail remains the fallback if
  // the og:image later fails its own quality check onLoad.
  const preferOgOverLegacyThumb =
    !!thumb && (thumb.width === undefined || thumb.width < LEGACY_THUMB_MIN_WIDTH) && !!ogImage;

  // While a Tier-2 read is still pending, hold at a neutral wash rather than
  // committing to og:image/typographic — those are only the right call once
  // we know for sure there's no thumbnail (see thumbPending above).
  const heroTier: "artwork" | "thumb-cover" | "thumb-contain" | "og-cover" | "typographic" | "pending" = artworkUrl
    ? "artwork"
    : thumbPending
      ? "pending"
      : preferOgOverLegacyThumb
        ? "og-cover"
        : thumbTier
          ? thumbTier
          : ogImage
            ? "og-cover"
            : "typographic";

  const handleOgImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (!activeUrlHash) return;
      const img = event.currentTarget;
      const ratio = img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      const shouldDemote = img.naturalWidth < OG_MIN_WIDTH_PX || (ratio >= OG_SQUARE_LO && ratio <= OG_SQUARE_HI);
      if (!shouldDemote) return;
      setOgDemoted((prev) => {
        if (prev.has(activeUrlHash)) return prev;
        const next = new Set(prev);
        next.add(activeUrlHash);
        return next;
      });
    },
    [activeUrlHash]
  );

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
        postToParent("close", invocationId);
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
          if (contextId?.startsWith("preview-")) {
            await chrome.storage.local.remove(contextId).catch(() => {});
          }
          await chrome.tabs.remove(current.id);
          return;
        }
      } catch {
        // Fall through to window.close.
      }
      window.close();
    },
    [contextId, invocationId, overlay, returnToTabId]
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

  const activate = useCallback(
    async (tab: NavigatorTab | undefined) => {
      if (!tab) return;
      try {
        await activateTab(tab.id, tab.windowId);
      } catch {
        // Tab likely closed between render and click — leave the overlay up
        // (an unhandled rejection here used to make the click a dead no-op).
        setAnnouncement(`Couldn't reach ${tab.title}`);
        showRowHint(tab.id, "Couldn't reach tab");
        return;
      }
      await dismiss(false);
    },
    [dismiss, showRowHint]
  );

  const runCommand = useCallback(
    async (command: BrowserCommand, targetOverride?: BrowserCommandTab | null) => {
      if (commandInFlightRef.current) return;
      commandInFlightRef.current = true;
      try {
        let freshTarget = targetOverride ?? commandTarget;
        if (command.id !== "new-tab") {
          if (!freshTarget) throw new Error("The selected tab is no longer available");
          let tab: chrome.tabs.Tab;
          try {
            tab = await chrome.tabs.get(freshTarget.id);
          } catch {
            setCommandTarget(null);
            throw new Error("The selected tab is no longer available");
          }
          freshTarget = {
            id: tab.id!,
            title: tab.title || tab.url || "Current tab",
            pinned: !!tab.pinned,
            muted: !!tab.mutedInfo?.muted,
          };
          setCommandTarget(freshTarget);
        }

        const result = await executeBrowserCommand(command.id, freshTarget, {
          remove: async (tabId) => chrome.tabs.remove(tabId),
          duplicate: async (tabId) => chrome.tabs.duplicate(tabId),
          update: async (tabId, properties) => chrome.tabs.update(tabId, properties),
          reload: async (tabId) => chrome.tabs.reload(tabId),
          create: async (properties) => chrome.tabs.create(properties),
        });

        setAnnouncement(result.announcement);
        const executedTargetId = freshTarget?.id;
        if (command.id === "pin-tab" || command.id === "unpin-tab") {
          setCommandTarget((current) =>
            current && current.id === executedTargetId ? { ...current, pinned: command.id === "pin-tab" } : current
          );
        } else if (command.id === "mute-tab" || command.id === "unmute-tab") {
          const muted = command.id === "mute-tab";
          setCommandTarget((current) =>
            current && current.id === executedTargetId ? { ...current, muted } : current
          );
          setTabs((current) => current.map((tab) => (tab.id === freshTarget?.id ? { ...tab, muted } : tab)));
        } else {
          await dismiss(false);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown browser error";
        // Clearing first makes repeated identical failures announce again.
        setAnnouncement("");
        queueMicrotask(() => setAnnouncement(`Command failed: ${detail}`));
      } finally {
        commandInFlightRef.current = false;
      }
    },
    [commandTarget, dismiss]
  );

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
          showRowHint(tab.id, "Click the tab to resume");
        } else if (result.ok === false) {
          setAnnouncement(`Couldn't reach ${tab.title}`);
          showRowHint(tab.id, "Couldn't reach tab");
        } else {
          setAnnouncement(result.playing ? `Playing ${tab.title}` : `Paused ${tab.title}`);
        }
      } catch {
        setAnnouncement(`Couldn't reach ${tab.title}`);
        showRowHint(tab.id, "Couldn't reach tab");
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
        showRowHint(tab.id, "Couldn't reach tab");
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

  const executeIntent = useCallback(
    async (item: IntentResult | undefined) => {
      if (!item) return;
      if (item.type === "tab") {
        await activate(item.tab);
        return;
      }
      try {
        await openUrlAsTab(item.url);
        await dismiss(false);
      } catch {
        setAnnouncement(`Couldn't ${item.actionLabel.toLowerCase()}`);
      }
    },
    [activate, dismiss]
  );

  const onActivate = useCallback(
    (index: number) => {
      const result = displayList[index];
      if (!result) return;
      if (result.kind === "command") void runCommand(result.command);
      else void executeIntent(result.intent);
    },
    [displayList, executeIntent, runCommand]
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

  // Search-focused audio shortcuts and audio-mode Backspace-to-back live
  // outside the generic list-navigation machinery.
  const preKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const fromSearch = event.target === inputRef.current;
      const fromNativeControl =
        !fromSearch &&
        event.target instanceof HTMLElement &&
        !!event.target.closest("button, a[href], [role='button']");

      // Once Tab has moved focus to a real control, Enter and Space belong to
      // that control. Letting the document-level list handler see them would
      // activate the selected tab or append a space to the search instead.
      if (fromNativeControl && (event.key === "Enter" || event.key === " ")) return true;

      // A held key firing repeat events would otherwise flap mode (remount
      // flicker on Tab) or race toggles (Space); consume without acting.
      if (event.repeat) return true;
      if (mode === "tabs" && fromSearch && event.altKey && !event.metaKey && !event.ctrlKey) {
        const commandId =
          event.code === "KeyP"
            ? selectedCommandTarget?.pinned ? "unpin-tab" : "pin-tab"
            : event.code === "KeyM"
              ? selectedCommandTarget?.muted ? "unmute-tab" : "mute-tab"
              : QUICK_ACTION_CODE_TO_COMMAND[event.code];
        const command = commandId
          ? getBrowserCommand(commandId, { targetTab: selectedCommandTarget })
          : undefined;
        if (command) {
          event.preventDefault();
          void runCommand(command, selectedCommandTarget);
          return true;
        }
      }
      if (mode === "audio" && fromSearch && query === "" && event.key === " ") {
        event.preventDefault();
        toggleSelectedPlay();
        return true;
      }
      if (mode === "audio" && fromSearch && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        toggleSelectedMute();
        return true;
      }
      if (mode === "audio" && fromSearch && query === "" && event.key === "Backspace") {
        event.preventDefault();
        enterTabsMode();
        return true;
      }
      return false;
    },
    [mode, query, selectedCommandTarget, runCommand, enterAudioMode, enterTabsMode, toggleSelectedPlay, toggleSelectedMute]
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

  // A palette open is a new navigation session: row one is the most recently
  // visited eligible tab and the rail must never inherit an old scroll offset.
  const initialPositionResetRef = useRef(false);
  useEffect(() => {
    if (loading || initialPositionResetRef.current) return;
    initialPositionResetRef.current = true;
    setActiveIndex(0);
    selectedIdRef.current = displayList[0]?.id ?? null;
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [loading, displayList, listRef]);

  // Render the left rail with bucket headers (only when not searching).
  const showBuckets = query.trim().length === 0;
  let lastBucket = "";
  const footer =
    mode === "audio" ? (
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-black/[0.07] px-4 py-2.5 text-[11px] text-black/55 dark:border-white/[0.07] dark:text-white/50">
        <span className="flex items-center gap-1.5">
          <Kbd>space</Kbd> Play/pause
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>←/→</Kbd> Mute
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> Switch to tab
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>backspace</Kbd> Tabs
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd> {query !== "" ? "Clear" : "Back"}
        </span>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-black/[0.07] px-4 py-2.5 text-[11px] text-black/55 dark:border-white/[0.07] dark:text-white/50">
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> {activeCommand?.actionLabel ?? activeIntent?.actionLabel ?? "Open"}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd> {query !== "" ? "Clear" : "Close"}
        </span>
        <span className="flex items-center gap-1.5"><Kbd>&gt;</Kbd> Commands</span>
        <span className="flex items-center gap-1.5"><Kbd>⌥</Kbd> Quick actions</span>
      </div>
    );

  return (
    <div
      className="tk-preview grid h-full w-full grid-cols-[clamp(260px,36%,360px)_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,244,246,0.92))] text-zinc-950 shadow-[0_32px_90px_rgba(0,0,0,0.28)] backdrop-blur-[30px] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,28,30,0.86),rgba(20,20,22,0.84))] dark:text-[#f5f5f7] dark:shadow-[0_32px_90px_rgba(0,0,0,0.55)]"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", system-ui, sans-serif',
      }}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {/* Left rail: search + grouped tab list */}
      <div className="flex min-h-0 flex-col border-r border-black/[0.07] dark:border-white/[0.07]">
        <div className="m-2 mb-0 flex items-center gap-2 rounded-xl border border-[#0068d9]/25 bg-white/75 px-3 py-2 shadow-sm ring-2 ring-[#0068d9]/15 focus-within:ring-[#0068d9]/45 dark:border-white/[0.07] dark:bg-white/[0.035] dark:ring-[#0a84ff]/20 dark:focus-within:ring-[#0a84ff]/50">
          <Search className="h-4 w-4 shrink-0 text-black/50 dark:text-white/55" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search anything… Type > for commands"
            className="h-8 w-full min-w-0 border-none bg-transparent text-lg font-semibold tracking-[-0.02em] text-black/90 outline-none placeholder:text-black/30 dark:text-white/95 dark:placeholder:text-white/30"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search tabs, bookmarks, history, or the web"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="tk-results"
            aria-expanded="true"
            aria-activedescendant={activeResult ? resultDomId(activeResult) : undefined}
          />
          <button
              type="button"
              onClick={() => (mode === "audio" ? enterTabsMode() : enterAudioMode())}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0068d9]/60 ${
                mode === "audio"
                  ? "bg-[#0057b8] text-white ring-1 ring-[#0057b8] dark:bg-[#0a84ff]/20 dark:text-[#5eaeff] dark:ring-[#0a84ff]/40"
                  : "bg-black/[0.06] text-black/70 hover:bg-black/[0.10] dark:bg-white/[0.08] dark:text-white/70 dark:hover:bg-white/[0.12]"
              }`}
              aria-label={`Audio tabs, ${audioList.length} available — ${mode === "audio" ? "show all tabs" : "show audio controls"}`}
              aria-pressed={mode === "audio"}
            >
              <span className="scale-[0.8]" aria-hidden="true">
                <AudioEq playing />
              </span>
              Audio {audioList.length > 0 ? audioList.length : ""}
            </button>
          <button
            type="button"
            onClick={() => void dismiss(true)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.06] text-black/55 transition-colors active:scale-[0.97] hover:bg-black/[0.12] hover:text-black/80 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0068d9]/60 dark:bg-white/[0.06] dark:text-white/55 dark:hover:bg-white/[0.12] dark:hover:text-white/80"
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {mode === "tabs" && query === "" && quickActions.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto px-2 py-1 text-[10px] text-black/50 dark:text-white/45">
            <span className="shrink-0 px-1 font-semibold uppercase tracking-[0.08em]">Quick</span>
            {quickActions.map((command) => (
              <button
                key={command.id}
                type="button"
                onClick={() => void runCommand(command, selectedCommandTarget)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-black/10 bg-black/[0.035] px-1.5 py-1 text-black/65 transition-colors hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0068d9]/50 dark:border-white/10 dark:bg-white/[0.035] dark:text-white/65 dark:hover:bg-white/[0.08]"
                aria-label={`${command.actionLabel}. Shortcut ${command.shortcut}`}
              >
                <span>{command.actionLabel.replace(" Tab", "")}</span>
                {command.shortcut && <Kbd>{command.shortcut.split(" / ")[0]}</Kbd>}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setQuery(">");
                setActiveIndex(0);
                queueMicrotask(focusInputAtEnd);
              }}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[#0057b8] hover:bg-[#0057b8]/10 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0068d9]/50 dark:text-[#5eaeff]"
            >
              All commands <Kbd>&gt;</Kbd>
            </button>
          </div>
        )}

        <div
          ref={listRef}
          id="tk-results"
          role="listbox"
          aria-label={mode === "audio" ? "Tabs playing audio" : "Destinations and browser commands"}
          aria-activedescendant={activeResult ? resultDomId(activeResult) : undefined}
          className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 py-1.5"
        >
          <div key={mode} className="tk-mode-fade space-y-0.5">
          {mode === "audio" ? (
            <>
              <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/40 dark:text-white/30">
                Now playing
              </div>
              {audioList.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <Music className="h-6 w-6 text-black/25 dark:text-white/25" />
                  <div className="text-xs text-black/55 dark:text-white/45">No tabs are playing audio</div>
                  <div className="text-[11px] text-black/40 dark:text-white/30">Use the Audio button to show all tabs</div>
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
                    onMouseEnter={() => setActiveIndex(index)}
                    style={audioList.length > CONTENT_VISIBILITY_THRESHOLD ? { contentVisibility: "auto", containIntrinsicSize: ROW_CONTAIN_SIZE } : undefined}
                    className={`flex w-full items-center gap-1.5 rounded-[9px] px-1.5 py-1 transition-colors duration-100 ${
                      active ? "bg-[#0057b8] text-white ring-2 ring-inset ring-white/55 dark:bg-[#0a84ff]" : "text-black/80 hover:bg-black/[0.05] dark:text-white/80 dark:hover:bg-white/[0.06]"
                    } ${tab.muted ? "opacity-60" : ""}`}
                  >
                    <button
                      id={`tk-row-${tab.id}`}
                      role="option"
                      aria-selected={active}
                      aria-label={`${tab.title}. Audio tab. Switch to tab.`}
                      ref={registerItem(index)}
                      type="button"
                      onClick={() => void activate(tab)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-white/70"
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-[5px] ${
                          active ? "bg-white/20" : "bg-white/[0.08] text-white/80"
                        }`}
                      >
                        <Favicon pageUrl={tab.url} favIconUrl={tab.favIconUrl} size={24} className="h-full w-full" />
                      </span>
                      <AudioEq playing={playing} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
                          {highlightTitle(tab.title, query, active)}
                        </span>
                        <span className={`block truncate text-[11px] ${active ? "text-white/85" : "text-black/50 dark:text-white/45"}`}>
                          {hint ?? domainOf(tab.url)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={
                        uncontrollable
                          ? `Playback unavailable for ${tab.title}`
                          : playing
                            ? `Pause ${tab.title}`
                            : `Play ${tab.title}`
                      }
                      aria-disabled={uncontrollable}
                      title={uncontrollable ? "Mute only" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!uncontrollable) void sendPlayToggle(tab);
                      }}
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.12] text-white/90 transition-colors active:scale-90 hover:bg-white/[0.2] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-white/75 ${
                        uncontrollable ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                      }`}
                    >
                      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      aria-label={tab.muted ? `Unmute ${tab.title}` : `Mute ${tab.title}`}
                      aria-pressed={tab.muted}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleMute(tab);
                      }}
                      className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full bg-white/[0.12] text-white/90 transition-colors active:scale-90 hover:bg-white/[0.2] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-white/75"
                    >
                      {tab.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {loading && (
                <div aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5">
                      <span className="tk-skeleton h-6 w-6 shrink-0 rounded-md" />
                      <span className="tk-skeleton h-3 flex-1 rounded" />
                    </div>
                  ))}
                </div>
              )}
              {!loading && displayList.length === 0 && (
                <div className="px-3 py-2 text-xs text-white/55">
                  {commandMode ? "No matching commands" : query.trim() ? "No matching destinations" : "No other tabs open"}
                </div>
              )}

              {commandResults.length > 0 && (
                <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
                  Commands
                </div>
              )}
              {commandResults.map((command, index) => {
                const active = index === activeIndex;
                const result: PreviewResult = { kind: "command", id: `command:${command.id}`, command };
                return (
                  <button
                    key={command.id}
                    ref={registerItem(index)}
                    id={resultDomId(result)}
                    role="option"
                    aria-selected={active}
                    aria-label={`${command.label}. ${command.actionLabel}${command.shortcut ? `. Shortcut ${command.shortcut}` : ""}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void runCommand(command)}
                    className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-100 ${
                      active ? "bg-[#0a84ff] text-white" : "text-white/80 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${active ? "bg-white/20" : "bg-white/[0.08]"}`}>
                      <Command className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{command.label}</span>
                      <span className={`block truncate text-[11px] ${active ? "text-white/70" : "text-white/45"}`}>
                        {command.actionLabel}
                      </span>
                    </span>
                    {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                  </button>
                );
              })}
              {!loading && !commandMode && query.trim() &&
                intentResults.map((item, index) => {
                  const resultIndex = commandResults.length + index;
                  const active = resultIndex === activeIndex;
                  const title = item.type === "tab" ? item.tab.title : item.title;
                  const url = item.type === "tab" ? item.tab.url : item.url;
                  const icon =
                    item.type === "tab" ? (
                      <Favicon pageUrl={item.tab.url} favIconUrl={item.tab.favIconUrl} size={24} className="h-full w-full" />
                    ) : item.type === "bookmark" ? (
                      <Bookmark className="h-3.5 w-3.5" />
                    ) : item.type === "history" ? (
                      <Clock3 className="h-3.5 w-3.5" />
                    ) : item.type === "search" ? (
                      <Search className="h-3.5 w-3.5" />
                    ) : (
                      <Globe2 className="h-3.5 w-3.5" />
                    );
                  return (
                    <button
                      key={item.key}
                      ref={registerItem(resultIndex)}
                      id={resultDomId({ kind: "intent", id: item.key, intent: item })}
                      role="option"
                      aria-selected={active}
                      type="button"
                      onMouseEnter={() => setActiveIndex(resultIndex)}
                      onClick={() => void executeIntent(item)}
                      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-100 ${
                        active ? "bg-[#0a84ff] text-white" : "text-white/80 hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className={`grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md ${active ? "bg-white/20" : "bg-white/[0.08]"}`}>
                        {icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
                          {highlightTitle(title, query, active)}
                        </span>
                        <span className={`block truncate text-[11px] ${active ? "text-white/70" : "text-white/45"}`}>
                          {domainOf(url)}
                        </span>
                      </span>
                      <span className={`shrink-0 text-[10px] font-medium ${active ? "text-white/80" : "text-white/40"}`}>
                        {item.sourceLabel}
                      </span>
                    </button>
                  );
                })}

              {!loading && !query.trim() &&
                orderedTabs.map((tab, index) => {
                  const resultIndex = commandResults.length + index;
                  const inRecentSection = index < featuredRecentCount;
                  const inMostVisitedSection =
                    !inRecentSection && index < featuredRecentCount + featuredMostVisitedCount;
                  const isFeatured = inRecentSection || inMostVisitedSection;

                  let header: string | null = null;
                  if (showBuckets && inRecentSection && index === 0) {
                    header = "Recent";
                  } else if (showBuckets && inMostVisitedSection && index === featuredRecentCount) {
                    header = "Most visited";
                  } else if (!isFeatured) {
                    const bucket = bucketLabel(tab.lastAccessed, now);
                    if (showBuckets && bucket !== lastBucket) header = bucket;
                    if (showBuckets) lastBucket = bucket;
                  }

                  const active = resultIndex === activeIndex;
                  const isDuplicateTitle = (duplicateTitleCounts.get(tab.title) ?? 0) > 1;
                  // Entrance stagger only on the featured rail's first-ever
                  // paint (never on re-rank) and only the first 8 rows, so a
                  // long "Recent" + "Most visited" combo doesn't tail off
                  // into a long, sluggish-feeling delay chain.
                  const showEntrance = isFeatured && initialFeaturedMountRef.current && index < 8;

                  return (
                    <div key={tab.id}>
                      {header && (
                        <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/40 dark:text-white/30">
                          {header}
                        </div>
                      )}
                      <button
                        ref={registerItem(resultIndex)}
                        id={resultDomId({ kind: "intent", id: `tab:${tab.id}`, intent: { type: "tab", key: `tab:${tab.id}`, sourceLabel: "Open tab", actionLabel: "Switch to tab", score: 0, tab } })}
                        role="option"
                        aria-selected={active}
                        type="button"
                        onMouseEnter={() => setActiveIndex(resultIndex)}
                        onClick={() => void activate(tab)}
                        style={{
                          ...(orderedTabs.length > CONTENT_VISIBILITY_THRESHOLD
                            ? {
                                contentVisibility: "auto",
                                containIntrinsicSize: isDuplicateTitle ? ROW_CONTAIN_SIZE_DUPLICATE : ROW_CONTAIN_SIZE,
                              }
                            : undefined),
                          ...(showEntrance ? { animationDelay: `${index * 18}ms` } : undefined),
                        }}
                        aria-label={`${tab.title}. Open tab. Switch.${tab.pinned ? " Pinned." : ""}${tab.audible ? " Playing audio." : ""}${tab.muted ? " Muted." : ""}${tab.discarded ? " Discarded." : ""}`}
                        className={`flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-left transition-colors duration-100 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0068d9]/70 ${showEntrance ? "tk-row-in" : ""} ${
                          active
                            ? "bg-[#0057b8] text-white ring-2 ring-inset ring-white/55 shadow-sm dark:bg-[#0a84ff]"
                            : isFeatured
                              ? "bg-[#0068d9]/[0.07] text-black/80 hover:bg-[#0068d9]/[0.12] dark:text-white/80"
                              : "text-black/80 hover:bg-black/[0.05] dark:text-white/80 dark:hover:bg-white/[0.06]"
                        } ${tab.discarded ? "opacity-[0.55]" : ""}`}
                      >
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-[5px] ${
                            active ? "bg-white/20" : "bg-white/[0.08] text-white/80"
                          }`}
                        >
                          <Favicon pageUrl={tab.url} favIconUrl={tab.favIconUrl} size={24} className="h-full w-full" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
                            {highlightTitle(tab.title, query, active)}
                          </span>
                          {isDuplicateTitle && (
                            <span className={`block truncate text-[11px] ${active ? "text-white/85" : "text-black/50 dark:text-white/45"}`}>
                              {domainOf(tab.url)}
                            </span>
                          )}
                        </span>
                        <ResultLabels active={active} />
                        <RowGlyphs tab={tab} currentWindowId={currentWindowId} active={active} />
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
        {activeCommand ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="grid flex-1 place-items-center px-12 text-center">
              <div className="max-w-sm">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#0a84ff]/15 text-[#5eaeff] ring-1 ring-[#0a84ff]/30">
                  <Command className="h-5 w-5" />
                </span>
                <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-white/95">{activeCommand.label}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-white/50">{activeCommand.description}</p>
                {selectedCommandTarget && activeCommand.id !== "new-tab" && (
                  <p className="mt-3 truncate text-[11px] text-white/35">Selected: {selectedCommandTarget.title}</p>
                )}
              </div>
            </div>
            {footer}
          </div>
        ) : !activeTabItem ? (
          <div className="flex h-full min-h-0 flex-col">
            {loading ? (
              // Nothing but the panel chrome while tabs are still loading —
              // no placeholder copy to flash before the first real row lands.
              <div className="flex-1" />
            ) : (
              <>
                {activeIntent && activeIntent.type !== "tab" ? (
                  <div className="grid flex-1 place-items-center px-12 text-center">
                    <div>
                      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.08] text-white/70">
                        {activeIntent.type === "bookmark" ? <Bookmark className="h-5 w-5" /> : activeIntent.type === "history" ? <Clock3 className="h-5 w-5" /> : activeIntent.type === "search" ? <Search className="h-5 w-5" /> : <Globe2 className="h-5 w-5" />}
                      </div>
                      <div className="text-lg font-semibold text-white/90">{activeIntent.title}</div>
                      <div className="mt-2 break-all text-xs leading-relaxed text-white/45">{activeIntent.url}</div>
                      <div className="mt-4 text-xs font-medium text-[#5eaeff]">{activeIntent.actionLabel} · Enter</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid flex-1 place-items-center text-sm text-white/40">
                    {mode === "audio" && audioList.length === 0 ? "Nothing playing right now" : "Select a destination"}
                  </div>
                )}
                {footer}
              </>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Hero (audio-mode artwork → Tier 2 screenshot → Tier 1 og:image →
                Tier 0.5 typographic card). Fixed 16:10 aspect ratio (never
                flex-grown) so it never needs to upscale a thumbnail to fill
                unpredictable flex space; the metadata pane below takes
                whatever height remains and scrolls. Keyed by tab + resolved
                tier (+ artwork URL, since a track change keeps the tier but
                swaps the image) so an upgrade, a demotion, or a selection
                change all cross-fade in rather than hard-swapping. */}
            <div
              ref={heroRef}
              className="relative overflow-hidden border-b border-white/[0.07]"
              style={{
                aspectRatio: HERO_ASPECT,
                background:
                  heroTier === "thumb-contain"
                    ? `${activeCard?.themeColor ?? "#1c1c1e"}22`
                    : "rgba(255,255,255,0.03)",
              }}
            >
              <div
                key={`${activeTabItem.id}:${heroTier}${heroTier === "artwork" ? `:${artworkUrl}` : ""}`}
                className="tk-hero-fade h-full w-full"
              >
                {heroTier === "artwork" && artworkUrl && (
                  <div className="relative h-full w-full">
                    <img
                      src={artworkUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
                    />
                    <div className="relative grid h-full w-full place-items-center p-8">
                      <img
                        src={artworkUrl}
                        alt=""
                        className="max-h-full max-w-full rounded-md object-contain shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
                        referrerPolicy="no-referrer"
                        onError={handleArtworkError}
                      />
                    </div>
                    <HeroTopScrim />
                  </div>
                )}
                {heroTier === "thumb-cover" && thumb && (
                  <>
                    <img src={thumb.url} alt="" className="h-full w-full object-cover object-top" />
                    <HeroTopScrim />
                    <FreshnessChip capturedAt={thumb.capturedAt} now={now} />
                  </>
                )}
                {heroTier === "thumb-contain" && thumb && (
                  <div className="relative h-full w-full">
                    <img
                      src={thumb.url}
                      alt=""
                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
                    />
                    <div className="relative grid h-full w-full place-items-center">
                      <img src={thumb.url} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                    <HeroTopScrim />
                    <FreshnessChip capturedAt={thumb.capturedAt} now={now} />
                  </div>
                )}
                {heroTier === "og-cover" && ogImage && (
                  <>
                    <img
                      src={ogImage}
                      alt=""
                      className="h-full w-full object-cover object-center"
                      referrerPolicy="no-referrer"
                      onLoad={handleOgImageLoad}
                    />
                    <HeroTopScrim />
                  </>
                )}
                {heroTier === "pending" && (
                  <div
                    className="h-full w-full"
                    style={{
                      background: `linear-gradient(155deg, ${activeCard?.themeColor ?? "#1c1c1e"}33 0%, rgba(10,10,12,0.6) 70%)`,
                    }}
                  />
                )}
                {heroTier === "typographic" && <HeroTypographicCard tab={activeTabItem} card={visibleCard} />}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 py-4">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-black/50 dark:text-white/45">
                <span className="truncate">{activeCard?.siteName || domainOf(activeTabItem.url)}</span>
                {heroTier !== "thumb-cover" && heroTier !== "thumb-contain" && activeCard?.capturedAt && (
                  <>
                    <span className="text-black/25 dark:text-white/25">·</span>
                    <span className="shrink-0">captured {relativeTime(activeCard.capturedAt, now)}</span>
                  </>
                )}
              </div>

              <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.02em] text-black/95 dark:text-white/95">
                {activeTabItem.title}
              </h2>
              <div className="mt-1 truncate text-xs text-black/50 dark:text-white/45">{activeTabItem.url}</div>

              {activeAudioTab && mediaStatus?.tabId === activeAudioTab.id && (
                <MediaNowPlaying tab={activeAudioTab} status={mediaStatus.result} />
              )}

              {visibleCard?.description && (
                <p className="mt-4 text-sm leading-relaxed text-black/75 dark:text-white/75">{visibleCard.description}</p>
              )}

              {visibleCard?.excerpt && (
                <p className="mt-4 whitespace-pre-line text-[13px] leading-relaxed text-black/60 dark:text-white/55">
                  {visibleCard.excerpt}
                </p>
              )}

              {previewTextSuppressed && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-black/10 bg-black/[0.035] px-3 py-2.5 text-xs text-black/60 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55">
                  <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-black/75 dark:text-white/75">
                      {activeCard?.description || activeCard?.excerpt ? "Page text hidden" : "Page text not collected"}
                    </div>
                    <div className="mt-0.5 leading-relaxed">
                      {previewTextPreference === "always-hide"
                        ? "Your privacy setting keeps descriptions and page excerpts out of previews."
                        : "This URL looks sensitive, so descriptions and page excerpts stay hidden."}
                    </div>
                    {(activeCard?.description || activeCard?.excerpt) && revealedTextHash !== activeCardHash && (
                      <button
                        type="button"
                        onClick={() => {
                          setRevealedTextHash(activeCardHash);
                          setAnnouncement("Page text shown for this preview only");
                        }}
                        className="mt-2 rounded-md border border-black/15 bg-white/60 px-2 py-1 text-[11px] font-medium text-black/75 hover:bg-white focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0068d9]/60 dark:border-white/15 dark:bg-white/[0.07] dark:text-white/75 dark:hover:bg-white/[0.12]"
                      >
                        Show for this preview
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!activeCard && !thumb && (
                <p className="mt-6 text-xs text-black/45 dark:text-white/40">
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
