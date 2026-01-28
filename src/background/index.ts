// Background service worker for Tab Saver extension
// Updates badge count when tabs change

import { updateBadgeCount } from "../popup/lib/chrome-api";

// Update badge on startup
chrome.runtime.onInstalled.addListener(() => {
  updateBadgeCount();
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
