import type { BookmarkFolder, TabInfo, SaveResult } from "../types";
import { extractDomain, isSystemUrl, findDuplicateUrls, generateFolderNameWithSuffix } from "./utils";

/**
 * Get all tabs from current window
 */
export async function getCurrentWindowTabs(): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query({ currentWindow: true });
}

/**
 * Process tabs: filter system tabs, extract domains, detect duplicates
 */
export function processTabs(tabs: chrome.tabs.Tab[]): TabInfo[] {
  // Filter out system tabs and tabs without URLs
  const validTabs = tabs.filter(
    (tab) => tab.id !== undefined && tab.url && !isSystemUrl(tab.url)
  );

  // Find duplicate URLs
  const urls = validTabs.map((tab) => tab.url!);
  const duplicateUrls = findDuplicateUrls(urls);

  return validTabs.map((tab) => ({
    id: tab.id!,
    url: tab.url!,
    title: tab.title || tab.url!,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned || false,
    domain: extractDomain(tab.url!),
    isDuplicate: duplicateUrls.has(tab.url!),
  }));
}

/**
 * Close tabs by IDs
 */
export async function closeTabs(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  await chrome.tabs.remove(tabIds);
}

/**
 * Get bookmark tree
 */
export async function getBookmarkTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return chrome.bookmarks.getTree();
}

/**
 * Get children of a bookmark folder
 */
export async function getBookmarkChildren(
  folderId: string
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return chrome.bookmarks.getChildren(folderId);
}

/**
 * Convert Chrome bookmark tree to our BookmarkFolder type (folders only)
 */
export function toBookmarkFolders(
  nodes: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkFolder[] {
  return nodes
    .filter((node) => !node.url) // Only folders (no URL means it's a folder)
    .map((node) => ({
      id: node.id,
      title: node.title || "Untitled",
      parentId: node.parentId,
      children: node.children ? toBookmarkFolders(node.children) : undefined,
    }));
}

/**
 * Create a bookmark folder
 */
export async function createBookmarkFolder(
  parentId: string,
  title: string
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.create({ parentId, title });
}

/**
 * Create a bookmark
 */
export async function createBookmark(
  parentId: string,
  title: string,
  url: string
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.create({ parentId, title, url });
}

/**
 * Save multiple tabs as bookmarks in a new folder
 * Returns results for each tab (success or error)
 */
export async function saveTabsAsBookmarks(
  tabs: TabInfo[],
  parentFolderId: string,
  folderName: string
): Promise<{ folderId: string; results: SaveResult[] }> {
  // Get existing folder names in parent to handle duplicates
  const children = await getBookmarkChildren(parentFolderId);
  const existingNames = children.map((c) => c.title);
  const finalFolderName = generateFolderNameWithSuffix(folderName, existingNames);

  // Create the folder
  const folder = await createBookmarkFolder(parentFolderId, finalFolderName);

  // Save each tab as a bookmark
  const results: SaveResult[] = [];

  for (const tab of tabs) {
    try {
      await createBookmark(folder.id, tab.title, tab.url);
      results.push({
        success: true,
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
      });
    } catch (error) {
      results.push({
        success: false,
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { folderId: folder.id, results };
}

/**
 * Update badge text with tab count
 */
export async function updateBadgeCount(): Promise<void> {
  try {
    const tabs = await getCurrentWindowTabs();
    const count = tabs.filter((tab) => tab.url && !isSystemUrl(tab.url)).length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  } catch {
    // Badge update failed, ignore
  }
}

/**
 * Open Chrome's recently closed tabs page
 */
export function openRecentlyClosed(): void {
  chrome.tabs.create({ url: "chrome://history/" });
}

/**
 * Get bookmarks from a folder
 */
export async function getBookmarksInFolder(
  folderId: string
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const children = await getBookmarkChildren(folderId);
  return children.filter((node) => node.url);
}

/**
 * Open multiple URLs as tabs
 */
export async function openUrlsAsTabs(urls: string[]): Promise<void> {
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
}
