// Background service worker for Tab Saver extension
// Updates badge count when tabs change

import { updateBadgeCount } from "../popup/lib/chrome-api";

const SYSTEM_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^about:/,
  /^edge:\/\//,
  /^brave:\/\//,
  /^opera:\/\//,
  /^vivaldi:\/\//,
  /^file:\/\//,
  /^devtools:\/\//,
];

function isSystemUrl(url: string): boolean {
  return SYSTEM_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function toQueryUrl(raw: string): string {
  const query = raw.trim();
  if (!query) return "chrome://newtab/";

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(query);
  const looksLikeHost = /^[^\s]+\.[^\s]+$/.test(query);

  if (hasProtocol) return query;
  if (looksLikeHost) return `https://${query}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

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

async function ensureAndToggleNavigator(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TAB_NAVIGATOR_TOGGLE" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/index.js"],
      });
      await chrome.tabs.sendMessage(tabId, { type: "TAB_NAVIGATOR_TOGGLE" });
      return true;
    } catch {
      return false;
    }
  }
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

// Global keyboard command to open TabKnight navigator quickly
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_tab_navigator") return;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (activeTab?.id !== undefined) {
    const opened = await ensureAndToggleNavigator(activeTab.id);
    if (opened) return;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    if (message?.type === "TAB_NAVIGATOR_QUERY") {
      const [tabs, focusedWindow] = await Promise.all([
        chrome.tabs.query({}),
        chrome.windows.getCurrent(),
      ]);

      const currentWindowId = sender.tab?.windowId ?? focusedWindow.id ?? null;

      const result = tabs
        .filter(
          (tab): tab is chrome.tabs.Tab & { id: number; windowId: number; url: string } =>
            tab.id !== undefined &&
            tab.windowId !== undefined &&
            !!tab.url &&
            !isSystemUrl(tab.url)
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
        }));

      sendResponse({ ok: true, tabs: result, currentWindowId });
      return;
    }

    if (message?.type === "TAB_NAVIGATOR_ACTIVATE") {
      const tabId = Number(message.tabId);
      const targetTab = await chrome.tabs.get(tabId);
      const targetWindowId = targetTab.windowId;

      await chrome.windows.update(targetWindowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });

      if (typeof targetTab.index === "number") {
        await chrome.tabs.highlight({ windowId: targetWindowId, tabs: targetTab.index });
      }

      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "TAB_NAVIGATOR_OPEN_QUERY") {
      const windowId = sender.tab?.windowId;
      const url = toQueryUrl(typeof message.query === "string" ? message.query : "");
      await chrome.tabs.create({
        url,
        active: true,
        ...(windowId !== undefined ? { windowId } : {}),
      });
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
