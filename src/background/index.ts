// Background service worker.
// - Keeps the toolbar badge in sync with the open-tab count.
// - Persists content-card snapshots harvested by the content script.
// - Opens the tab-preview overlay (Cmd+K), falling back to a standalone tab
//   on restricted pages where a content script can't be injected.

import { updateBadgeCount } from "../popup/lib/chrome-api";
import { getThumbnail, putCard, pruneCards } from "../popup/lib/preview/db";
import { hashUrl } from "../popup/lib/preview/hash";
import { captureActiveTabThumbnail, isCapturableUrl } from "../popup/lib/preview/thumbnail";
import type {
  AudibleStateChangedMessage,
  ContentCard,
  MediaControlResult,
  MediaSessionInfo,
  MediaStatusResult,
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

// Chrome also rejects sendMessage with this when the listener was present and
// ran (e.g. it called openPreviewOverlay synchronously) but the tab/frame
// navigated or the port otherwise closed before the response made it back.
// Unlike isNoReceiverError, this means the content script IS there — treat it
// as success rather than falling back to a redundant standalone tab.
function isPortClosedError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return text.toLowerCase().includes("the message port closed before a response was received");
}

async function ensureAndTogglePreview(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PREVIEW_OVERLAY_TOGGLE" });
    return true;
  } catch (error) {
    if (isPortClosedError(error)) return true;
    if (!isNoReceiverError(error)) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/index.js"],
      });
      await chrome.tabs.sendMessage(tabId, { type: "PREVIEW_OVERLAY_TOGGLE" });
      return true;
    } catch {
      return false;
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

// Restricted pages (chrome://, the Web Store, …) can't host the overlay, so we
// open the preview in a standalone tab and capture the source tab's screenshot
// to use as a blurred backdrop.
async function openStandalonePreview(sourceTab?: chrome.tabs.Tab): Promise<void> {
  const contextId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let backgroundImage: string | undefined;

  if (sourceTab?.windowId !== undefined) {
    try {
      backgroundImage = await chrome.tabs.captureVisibleTab(sourceTab.windowId, {
        format: "png",
      });
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
    },
  });

  const params = new URLSearchParams({ standalone: "1", view: "preview", context: contextId });

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`popup/index.html?${params.toString()}`),
    active: true,
    ...(sourceTab?.windowId !== undefined ? { windowId: sourceTab.windowId } : {}),
    ...(typeof sourceTab?.index === "number" ? { index: sourceTab.index + 1 } : {}),
  });
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
// captureVisibleTab captures the active tab of a given window, so mutual
// exclusion only needs to be per-window — a global lock would starve every
// window but the first that requests a capture at the same time.
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

// First-run discoverability: once the user actually uses the shortcut, the
// popup's hint banner never needs to show again.
async function markCmdKHintDismissed(): Promise<void> {
  try {
    await chrome.storage.local.set({ cmdkHintDismissed: true });
  } catch {
    // Best-effort — the banner just stays around a bit longer.
  }
}

// Cmd+K — toggle the tab-preview overlay on the active tab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_tab_navigator") return;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  void maybeCaptureOnOverlayOpen(activeTab);

  if (activeTab?.id !== undefined) {
    const opened = await ensureAndTogglePreview(activeTab.id);
    if (opened) {
      await markCmdKHintDismissed();
      return;
    }
  }

  await openStandalonePreview(activeTab);
  await markCmdKHintDismissed();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      await openStandalonePreview(sender.tab);
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
