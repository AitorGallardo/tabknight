// Background service worker.
// - Keeps the toolbar badge in sync with the open-tab count.
// - Persists content-card snapshots harvested by the content script.
// - Opens the tab-preview overlay (Cmd+K), falling back to a standalone tab
//   on restricted pages where a content script can't be injected.

import { updateBadgeCount } from "../popup/lib/chrome-api";
import { putCard, pruneCards } from "../popup/lib/preview/db";
import { captureActiveTabThumbnail } from "../popup/lib/preview/thumbnail";
import type {
  AudibleStateChangedMessage,
  ContentCard,
  MediaControlResult,
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
const lastCaptureAt = new Map<number, number>();
// captureVisibleTab captures the active tab of a given window, so mutual
// exclusion only needs to be per-window — a global lock would starve every
// window but the first that requests a capture at the same time.
const captureInFlightWindows = new Set<number>();

async function maybeCapture(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.id || !tab.active || tab.windowId === undefined) return;

  const now = Date.now();
  if (now - (lastCaptureAt.get(tab.id) ?? 0) < MIN_CAPTURE_INTERVAL) return;
  if (captureInFlightWindows.has(tab.windowId)) return;

  lastCaptureAt.set(tab.id, now);
  captureInFlightWindows.add(tab.windowId);
  try {
    await captureActiveTabThumbnail(tab);
  } finally {
    captureInFlightWindows.delete(tab.windowId);
  }
}

// Captures are driven by the content script (PREVIEW_REQUEST_CAPTURE), which
// only asks when the page is scrolled to the top — so stored thumbnails always
// show the top of the page, never a mid-scroll position.
chrome.tabs.onRemoved.addListener((tabId) => {
  lastCaptureAt.delete(tabId);
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
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateBadgeCount();
  }
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
  };

  void handle().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown runtime error",
    });
  });

  return true;
});
