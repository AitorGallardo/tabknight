// Background service worker.
// - Keeps the toolbar badge in sync with the open-tab count.
// - Persists content-card snapshots harvested by the content script.
// - Opens the tab-preview overlay (Cmd+K), falling back to a standalone tab
//   on restricted pages where a content script can't be injected.

import { updateBadgeCount } from "../popup/lib/chrome-api";
import { putCard, pruneCards } from "../popup/lib/preview/db";
import type { ContentCard } from "../popup/lib/preview/types";

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

async function ensureAndTogglePreview(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PREVIEW_OVERLAY_TOGGLE" });
    return true;
  } catch {
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

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  // Only update when URL changes
  if (changeInfo.url) {
    updateBadgeCount();
  }
});

// Update when window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateBadgeCount();
  }
});

// Cmd+K — toggle the tab-preview overlay on the active tab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_tab_navigator") return;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (activeTab?.id !== undefined) {
    const opened = await ensureAndTogglePreview(activeTab.id);
    if (opened) return;
  }

  await openStandalonePreview(activeTab);
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

    if (message?.type === "PREVIEW_FALLBACK_STANDALONE") {
      await openStandalonePreview(sender.tab);
      sendResponse({ ok: true });
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
