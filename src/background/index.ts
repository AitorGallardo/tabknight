// Background service worker.
// - Keeps the toolbar badge in sync with the open-tab count.
// - Persists content-card snapshots harvested by the content script.
// - Opens the tab-preview overlay (Cmd+K), falling back to a standalone tab
//   on restricted pages where a content script can't be injected.

import { updateBadgeCount } from "../popup/lib/chrome-api";
import { ACCENT_PREFERENCE_KEY } from "../popup/lib/appearance";
import { getThumbnail, putCard, pruneCards } from "../popup/lib/preview/db";
import { hashUrl } from "../popup/lib/preview/hash";
import { captureActiveTabThumbnail, isCapturableUrl } from "../popup/lib/preview/thumbnail";
import {
  appendDiagnostic,
  isCurrentFallbackRequest,
  initialFallbackCause,
  sanitizeTabStatus,
  type FallbackCause,
  type InvocationDiagnostic,
} from "../shared/invocation";
import type {
  AudibleStateChangedMessage,
  ContentCard,
  MediaControlResult,
  MediaSessionInfo,
  MediaStatusResult,
  TabRemovedMessage,
} from "../popup/lib/preview/types";

async function injectContentScriptIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ["http://*/*", "https://*/*"],
  });

  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
      .map(async (tab) => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content/index.js"],
          });
        } catch {
          // Ignore pages where script injection is not allowed
        }
      })
  );
}

// Chrome doesn't expose a typed error for "no listener on the other end" — it
// rejects sendMessage with one of these messages. Only these mean the content
// script isn't there; anything else (e.g. the listener itself threw) should
// not trigger a re-injection, or we'd end up with two overlay hosts on the
// page.
function isNoReceiverError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  return (
    lower.includes("receiving end does not exist") ||
    lower.includes("could not establish connection")
  );
}

// Chrome also rejects sendMessage with this when the tab/frame navigates or
// the port closes before the acknowledgement arrives. That is not proof of a
// surviving overlay, so it follows the reinjection/handshake path.
function isPortClosedError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return text.toLowerCase().includes("the message port closed before a response was received");
}

interface OverlayAttempt {
  ok: boolean;
  cause?: FallbackCause;
  documentToken?: string;
}

async function ensureAndTogglePreview(
  tabId: number,
  invocationId: string,
  startedAt: number
): Promise<OverlayAttempt> {
  const message = { type: "PREVIEW_OVERLAY_TOGGLE", invocationId, startedAt };
  try {
    const response = (await chrome.tabs.sendMessage(tabId, message)) as
      | { ok?: boolean; documentToken?: string }
      | undefined;
    return response?.ok
      ? { ok: true, documentToken: response.documentToken }
      : { ok: false, cause: "unknown" };
  } catch (error) {
    if (!isNoReceiverError(error) && !isPortClosedError(error)) {
      return { ok: false, cause: "unknown" };
    }
    try {
      const injection = await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/index.js"],
      });
      const documentId = injection[0]?.documentId;
      const response = (documentId
        ? await chrome.tabs.sendMessage(tabId, message, { documentId })
        : await chrome.tabs.sendMessage(tabId, message)) as
        | { ok?: boolean; documentToken?: string }
        | undefined;
      return response?.ok
        ? { ok: true, documentToken: response.documentToken }
        : { ok: false, cause: "unknown" };
    } catch {
      return { ok: false, cause: "injection-failed" };
    }
  }
}

// Play/pause needs DOM access, so it's forwarded to the target tab's content
// script, injecting it first if it hasn't run there yet (same retry pattern
// as ensureAndTogglePreview).
async function forwardMediaControl(
  tabId: number,
  action: string
): Promise<MediaControlResult> {
  const message = { type: "MEDIA_CONTROL", action };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isNoReceiverError(error)) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown runtime error",
      };
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/index.js"],
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (retryError) {
      return {
        ok: false,
        error: retryError instanceof Error ? retryError.message : "Unknown runtime error",
      };
    }
  }
}

// Track title/artist/artwork live in navigator.mediaSession.metadata, which a
// content script (isolated world) can't see — only a MAIN-world injection can.
// Metadata rarely changes, so it's cached per tab and piggybacks on the 1Hz
// status poll instead of re-injecting a script every tick.
const MEDIA_SESSION_TTL = 5000;
const mediaSessionCache = new Map<number, { info: MediaSessionInfo | null; at: number }>();

async function readMediaSession(tabId: number): Promise<MediaSessionInfo | undefined> {
  const cached = mediaSessionCache.get(tabId);
  if (cached && Date.now() - cached.at < MEDIA_SESSION_TTL) return cached.info ?? undefined;

  let info: MediaSessionInfo | null = null;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const m = navigator.mediaSession?.metadata;
        if (!m) return null;
        const art = [...(m.artwork ?? [])].sort((a, b) => {
          const size = (s?: string) => parseInt(s?.split("x")[0] ?? "0", 10) || 0;
          return size(b.sizes) - size(a.sizes);
        })[0];
        return {
          title: m.title || undefined,
          artist: m.artist || undefined,
          album: m.album || undefined,
          artworkUrl: art?.src || undefined,
        };
      },
    });
    // The result comes from the page's world — validate shapes on this side
    // (a shadowed navigator.mediaSession could return arbitrary values).
    const raw = injected?.result as Record<string, unknown> | null | undefined;
    if (raw) {
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      const url = str(raw.artworkUrl);
      info = {
        title: str(raw.title),
        artist: str(raw.artist),
        album: str(raw.album),
        artworkUrl: url && /^(https?:|data:image\/)/i.test(url) ? url : undefined,
      };
    }
  } catch {
    // Restricted page, no scripting access, or the tab navigated mid-call.
    info = null;
  }

  mediaSessionCache.set(tabId, { info, at: Date.now() });
  return info ?? undefined;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  mediaSessionCache.delete(tabId);

  // Best-effort broadcast so any open overlay/standalone view can drop the
  // tab from its list immediately, mirroring AUDIBLE_STATE_CHANGED's pattern.
  chrome.runtime
    .sendMessage({ type: "TAB_REMOVED", tabId } satisfies TabRemovedMessage)
    .catch(() => {
      // No extension page is listening (overlay closed) — best-effort.
    });
});

// Passive poll for the "now playing" media block — unlike forwardMediaControl,
// this never injects the content script: if it isn't there, the tab just has
// no status yet, and the next poll tick will retry cheaply.
async function forwardMediaStatus(tabId: number): Promise<MediaStatusResult> {
  try {
    const result = (await chrome.tabs.sendMessage(tabId, { type: "MEDIA_STATUS" })) as MediaStatusResult;
    const session = await readMediaSession(tabId);
    return session ? { ...result, session } : result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown runtime error",
    };
  }
}

// Every standalone context is stored under a "preview-" prefixed key (already
// recognizable/distinct from other storage.local keys) and carries a full-page
// PNG data URL. It's only deleted when the standalone tab's React app reads
// it — if that tab is closed before it loads, the entry orphans forever. Sweep
// anything older than this on each standalone open and on startup.
const STANDALONE_CONTEXT_PREFIX = "preview-";
const STANDALONE_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
const INVOCATION_DIAGNOSTICS_KEY = "invocationDiagnostics";

interface ActiveInvocation {
  id: string;
  tabId: number;
  windowId: number;
  startedAt: number;
  tabStatus: InvocationDiagnostic["tabStatus"];
  discarded: boolean;
  documentToken?: string;
  fallbackOpened: boolean;
}

const activeInvocations = new Map<number, ActiveInvocation>();
const invocationQueues = new Map<number, Promise<void>>();
const standaloneContextsByTab = new Map<number, string>();

async function recordInvocationDiagnostic(
  invocation: ActiveInvocation,
  mode: "overlay" | "fallback",
  cause?: FallbackCause
): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(INVOCATION_DIAGNOSTICS_KEY);
    const diagnostics = appendDiagnostic(stored[INVOCATION_DIAGNOSTICS_KEY], {
      at: Date.now(),
      elapsedMs: Math.max(0, Date.now() - invocation.startedAt),
      mode,
      cause,
      tabStatus: invocation.tabStatus,
      discarded: invocation.discarded,
    });
    await chrome.storage.local.set({ [INVOCATION_DIAGNOSTICS_KEY]: diagnostics });
  } catch {
    // Diagnostics are best-effort and deliberately contain no URL or page content.
  }
}

async function sweepStaleStandaloneContexts(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const staleKeys = Object.entries(all)
      .filter(([key, value]) => {
        if (!key.startsWith(STANDALONE_CONTEXT_PREFIX)) return false;
        const createdAt = (value as { createdAt?: number } | null | undefined)?.createdAt;
        return typeof createdAt === "number" && now - createdAt > STANDALONE_CONTEXT_MAX_AGE_MS;
      })
      .map(([key]) => key);
    if (staleKeys.length > 0) {
      await chrome.storage.local.remove(staleKeys);
    }
  } catch {
    // Best-effort — an orphaned context just gets swept on a later pass.
  }
}

async function findStandaloneTab(windowId: number): Promise<chrome.tabs.Tab | undefined> {
  const prefix = chrome.runtime.getURL("popup/index.html");
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.find((tab) => tab.url?.startsWith(prefix) && tab.url.includes("standalone=1"));
}

// Restricted/loading pages that cannot complete the handshake use one compact
// fallback per window. Context stays until tab teardown so a service-worker
// restart can still restore the origin.
async function openStandalonePreview(
  sourceTab: chrome.tabs.Tab | undefined,
  cause: FallbackCause,
  invocation: ActiveInvocation
): Promise<void> {
  if (invocation.fallbackOpened) return;
  // Reserve ownership before the first await so concurrent timeout/error
  // messages cannot both pass the dedupe check.
  invocation.fallbackOpened = true;
  void sweepStaleStandaloneContexts();

  const windowId = sourceTab?.windowId ?? invocation.windowId;
  const existing = await findStandaloneTab(windowId);
  const previousContextId = existing?.url
    ? new URL(existing.url).searchParams.get("context")
    : null;

  const contextId = `${STANDALONE_CONTEXT_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let backgroundImage: string | undefined;

  if (sourceTab?.windowId !== undefined) {
    try {
      const [visibleTab] = await chrome.tabs.query({ active: true, windowId: sourceTab.windowId });
      if (visibleTab?.id === sourceTab.id) {
        backgroundImage = await chrome.tabs.captureVisibleTab(sourceTab.windowId, {
          format: "png",
        });
      }
    } catch {
      // Capture is best-effort. It may fail on some contexts.
    }
  }

  await chrome.storage.local.set({
    [contextId]: {
      backgroundImage,
      returnToTabId: sourceTab?.id,
      returnToWindowId: sourceTab?.windowId,
      createdAt: Date.now(),
      cause,
      elapsedMs: Math.max(0, Date.now() - invocation.startedAt),
      standaloneTabId: undefined,
    },
  });

  const params = new URLSearchParams({ standalone: "1", context: contextId });

  const fallbackUrl = chrome.runtime.getURL(`popup/index.html?${params.toString()}`);
  const standalone = existing?.id !== undefined
    ? await chrome.tabs.update(existing.id, {
        active: true,
        url: fallbackUrl,
      })
    : await chrome.tabs.create({
        url: fallbackUrl,
        active: true,
        ...(sourceTab?.windowId !== undefined ? { windowId: sourceTab.windowId } : {}),
        ...(typeof sourceTab?.index === "number" ? { index: sourceTab.index + 1 } : {}),
      });
  await chrome.windows.update(windowId, { focused: true });
  if (standalone.id !== undefined) {
    standaloneContextsByTab.set(standalone.id, contextId);
    await chrome.storage.local.set({
      [contextId]: {
        ...(await chrome.storage.local.get(contextId))[contextId],
        standaloneTabId: standalone.id,
      },
    });
  }
  if (
    previousContextId?.startsWith(STANDALONE_CONTEXT_PREFIX) &&
    previousContextId !== contextId
  ) {
    await chrome.storage.local.remove(previousContextId);
  }
  await recordInvocationDiagnostic(invocation, "fallback", cause);
}

async function dismissStandalone(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !tab.url) return;
  const rawContextId = new URL(tab.url).searchParams.get("context");
  const contextId = rawContextId?.startsWith(STANDALONE_CONTEXT_PREFIX) ? rawContextId : null;
  const context = contextId
    ? ((await chrome.storage.local.get(contextId))[contextId] as
        | { returnToTabId?: number; returnToWindowId?: number }
        | undefined)
    : undefined;
  try {
    if (context?.returnToTabId !== undefined) {
      const origin = await chrome.tabs.get(context.returnToTabId);
      await chrome.windows.update(origin.windowId, { focused: true });
      await chrome.tabs.update(origin.id!, { active: true });
    } else if (context?.returnToWindowId !== undefined) {
      await chrome.windows.update(context.returnToWindowId, { focused: true });
    }
  } catch {
    // Origin may have closed; closing the fallback is still predictable.
  }
  await chrome.tabs.remove(tab.id);
  if (contextId) await chrome.storage.local.remove(contextId);
}

/* ----------------------- pixel-thumbnail capture ------------------------- */
// Snapshot the active tab when the user arrives on it, when it finishes
// loading, and when they settle after scrolling — so the stored image reflects
// the page roughly as last seen. Throttled per tab and serialized globally to
// respect Chrome's captureVisibleTab rate limit.

const MIN_CAPTURE_INTERVAL = 3000;
// Opening the overlay bypasses the per-tab throttle, but only when the stored
// thumbnail is this stale — repeatedly toggling Cmd+K should not spam captures.
const OVERLAY_OPEN_STALE_THRESHOLD = 30000;
const lastCaptureAt = new Map<number, number>();
// Chrome's captureVisibleTab rate limit is per-profile, not per-window — but
// captureVisibleTab itself only ever captures the active tab of a given
// window, so mutual exclusion here only needs to be per-window — a global
// lock would starve every window but the first that requests a capture at
// the same time.
const captureInFlightWindows = new Set<number>();

async function maybeCapture(
  tab: chrome.tabs.Tab | undefined,
  opts?: { bypassThrottle?: boolean }
): Promise<void> {
  if (!tab?.id || !tab.active || tab.windowId === undefined) return;

  const now = Date.now();
  const throttled = now - (lastCaptureAt.get(tab.id) ?? 0) < MIN_CAPTURE_INTERVAL;
  if (throttled && !opts?.bypassThrottle) return;
  if (captureInFlightWindows.has(tab.windowId)) return;

  lastCaptureAt.set(tab.id, now);
  captureInFlightWindows.add(tab.windowId);
  try {
    await captureActiveTabThumbnail(tab);
  } finally {
    captureInFlightWindows.delete(tab.windowId);
  }
}

// The active tab is visible right as the overlay opens — freshen its
// thumbnail so the "previous tab" the user is most likely to want next time
// reflects what they just saw, not a stale capture from minutes ago.
async function maybeCaptureOnOverlayOpen(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const url = tab?.url;
  if (!isCapturableUrl(url)) return;

  let bypassThrottle = true;
  try {
    const existing = await getThumbnail(hashUrl(url));
    bypassThrottle = !existing || Date.now() - existing.capturedAt > OVERLAY_OPEN_STALE_THRESHOLD;
  } catch {
    // DB read failed — default to allowing the capture.
  }

  await maybeCapture(tab, { bypassThrottle });
}

// Captures are driven by the content script (PREVIEW_REQUEST_CAPTURE), which
// only asks when the page is scrolled to the top — so stored thumbnails always
// show the top of the page, never a mid-scroll position.
chrome.tabs.onRemoved.addListener((tabId) => {
  lastCaptureAt.delete(tabId);
  activeInvocations.delete(tabId);
  const contextId = standaloneContextsByTab.get(tabId);
  if (contextId) {
    standaloneContextsByTab.delete(tabId);
    void chrome.storage.local.remove(contextId);
  } else {
    // Service workers may restart while a fallback is open. Recover teardown
    // ownership from the persisted tab id without retaining any browsing data.
    void chrome.storage.local
      .get(null)
      .then((all) => {
        const keys = Object.entries(all)
          .filter(
            ([key, value]) =>
              key.startsWith(STANDALONE_CONTEXT_PREFIX) &&
              (value as { standaloneTabId?: number } | undefined)?.standaloneTabId === tabId
          )
          .map(([key]) => key);
        if (keys.length > 0) return chrome.storage.local.remove(keys);
      })
      .catch(() => {});
  }
});

/* -------------------------- per-session visit counts --------------------- */
// Tracks how many times each tab has been navigated into (activated) during
// this browser session. Mirrored to chrome.storage.session so the overlay can
// read it directly, and so counts survive service-worker restarts within the
// same browser session.

const VISIT_COUNTS_KEY = "visitCounts";
const visitCounts = new Map<number, number>();
let visitCountsLoaded: Promise<void> | undefined;

function loadVisitCounts(): Promise<void> {
  if (!visitCountsLoaded) {
    visitCountsLoaded = (async () => {
      try {
        const stored = await chrome.storage.session.get(VISIT_COUNTS_KEY);
        const record = stored[VISIT_COUNTS_KEY] as Record<string, number> | undefined;
        if (record) {
          for (const [tabId, count] of Object.entries(record)) {
            visitCounts.set(Number(tabId), count);
          }
        }
      } catch {
        // Best-effort — counts just start from zero this session.
      }
    })();
  }
  return visitCountsLoaded;
}

async function persistVisitCounts(): Promise<void> {
  try {
    const record: Record<string, number> = {};
    for (const [tabId, count] of visitCounts) {
      record[tabId] = count;
    }
    await chrome.storage.session.set({ [VISIT_COUNTS_KEY]: record });
  } catch {
    // Best-effort — storage.session write failed, in-memory count still holds.
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  void (async () => {
    try {
      await loadVisitCounts();
      visitCounts.set(activeInfo.tabId, (visitCounts.get(activeInfo.tabId) ?? 0) + 1);
      await persistVisitCounts();
    } catch {
      // Best-effort.
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    try {
      await loadVisitCounts();
      visitCounts.delete(tabId);
      await persistVisitCounts();
    } catch {
      // Best-effort.
    }
  })();
});

// Update badge on startup
chrome.runtime.onInstalled.addListener(() => {
  updateBadgeCount();
  void injectContentScriptIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void injectContentScriptIntoOpenTabs();
  void sweepStaleStandaloneContexts();
});

// Update badge when tabs change
chrome.tabs.onCreated.addListener(() => {
  updateBadgeCount();
});

chrome.tabs.onRemoved.addListener(() => {
  updateBadgeCount();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only update when URL changes
  if (changeInfo.url) {
    updateBadgeCount();
    // A URL change creates a new document. Any late ready/fallback request
    // from the previous document must no longer own this tab's invocation.
    activeInvocations.delete(tabId);
  }

  if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) {
    chrome.runtime
      .sendMessage({
        type: "AUDIBLE_STATE_CHANGED",
        tabId,
        audible: changeInfo.audible,
        muted: changeInfo.mutedInfo?.muted,
      } satisfies AudibleStateChangedMessage)
      .catch(() => {
        // No extension page is listening (overlay closed) — best-effort.
      });
  }
});

// Update when window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  updateBadgeCount();

  // The newly focused window's active tab is visible on screen — opportunistically
  // refresh its thumbnail so multi-window usage stays fresh at zero user-visible cost.
  void chrome.tabs
    .query({ active: true, windowId })
    .then(([tab]) => maybeCapture(tab))
    .catch(() => {
      // Best-effort — window may have closed between the event and the query.
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && ACCENT_PREFERENCE_KEY in changes) void updateBadgeCount();
});

// First-run discoverability: once the user actually uses the shortcut, the
// popup's hint banner never needs to show again.
async function markCmdKHintDismissed(): Promise<void> {
  try {
    await chrome.storage.local.set({ cmdkHintDismissed: true });
  } catch {
    // Best-effort — the banner just stays around a bit longer.
  }
}

function enqueueInvocation(windowId: number, task: () => Promise<void>): void {
  const previous = invocationQueues.get(windowId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .catch(() => {
      // A failed invocation must not poison later shortcuts in this window.
    });
  invocationQueues.set(windowId, next);
  void next.finally(() => {
    if (invocationQueues.get(windowId) === next) invocationQueues.delete(windowId);
  });
}

async function handleNavigatorCommand(activeTab: chrome.tabs.Tab): Promise<void> {
  if (activeTab.id === undefined || activeTab.windowId === undefined) return;

  if (
    activeTab.url?.startsWith(chrome.runtime.getURL("popup/index.html")) &&
    activeTab.url.includes("standalone=1")
  ) {
    await dismissStandalone(activeTab);
    return;
  }

  const startedAt = Date.now();
  const invocation: ActiveInvocation = {
    id: `${startedAt}-${crypto.randomUUID()}`,
    tabId: activeTab.id,
    windowId: activeTab.windowId,
    startedAt,
    tabStatus: sanitizeTabStatus(activeTab.status),
    discarded: activeTab.discarded === true,
    fallbackOpened: false,
  };
  activeInvocations.set(activeTab.id, invocation);

  void maybeCaptureOnOverlayOpen(activeTab);
  const immediateCause = initialFallbackCause(activeTab);
  if (immediateCause) {
    await openStandalonePreview(activeTab, immediateCause, invocation);
    await markCmdKHintDismissed();
    return;
  }

  const result = await ensureAndTogglePreview(activeTab.id, invocation.id, startedAt);
  if (result.ok) {
    invocation.documentToken = result.documentToken;
    await recordInvocationDiagnostic(invocation, "overlay");
  } else {
    const latest = await chrome.tabs.get(activeTab.id).catch(() => undefined);
    const cause = latest?.status === "loading" ? "loading-tab" : result.cause ?? "unknown";
    await openStandalonePreview(latest ?? activeTab, cause, invocation);
  }
  await markCmdKHintDismissed();
}

// Both palette shortcuts share one serialized path per focused window, so
// rapid presses cannot race hosts or create multiple fallbacks.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_tab_navigator" && command !== "open_tab_navigator_fallback") return;
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab || activeTab.windowId === undefined) return;
    enqueueInvocation(activeTab.windowId, () => handleNavigatorCommand(activeTab));
  } catch {
    // Never let a shortcut error escape the service worker.
  }
});

// Messages this listener actually responds to. Anything else must return
// `false` synchronously — returning `true` unconditionally kept Chrome's
// message port open for senders of unrecognized types, whose sendResponse
// was never called, leaving their promise hanging forever.
const HANDLED_MESSAGE_TYPES = new Set([
  "PREVIEW_CARD_CAPTURE",
  "PREVIEW_REQUEST_CAPTURE",
  "PREVIEW_FALLBACK_STANDALONE",
  "MEDIA_CONTROL_REQUEST",
  "MEDIA_STATUS_REQUEST",
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!HANDLED_MESSAGE_TYPES.has(message?.type)) return false;

  const handle = async () => {
    if (message?.type === "PREVIEW_CARD_CAPTURE") {
      const card = message.card as ContentCard | undefined;
      if (card?.urlHash) {
        // Prefer the live favicon Chrome already resolved for the tab.
        if (sender.tab?.favIconUrl) card.favIconUrl = sender.tab.favIconUrl;
        await putCard(card);
        await pruneCards();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "PREVIEW_REQUEST_CAPTURE") {
      // Sent by the content script after the user settles (e.g. stops
      // scrolling) so the stored image matches what they last looked at.
      await maybeCapture(sender.tab);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "PREVIEW_FALLBACK_STANDALONE") {
      const invocation = sender.tab?.id !== undefined ? activeInvocations.get(sender.tab.id) : undefined;
      if (!invocation || !isCurrentFallbackRequest(invocation, message) || !sender.tab) {
        sendResponse({ ok: false, stale: true });
        return;
      }
      invocation.documentToken = message.documentToken;
      await openStandalonePreview(
        sender.tab,
        message.cause === "overlay-error" ? "overlay-error" : "overlay-timeout",
        invocation
      );
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "MEDIA_CONTROL_REQUEST") {
      const result = await forwardMediaControl(message.tabId, message.action);
      sendResponse(result);
      return;
    }

    if (message?.type === "MEDIA_STATUS_REQUEST") {
      const result = await forwardMediaStatus(message.tabId);
      sendResponse(result);
      return;
    }
  };

  void handle().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown runtime error",
    });
  });

  return true;
});
