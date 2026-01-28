import { useState, useEffect, useCallback } from "react";
import type { BookmarkFolder, TabInfo, SaveSummary } from "../types";
import {
  getBookmarkTree,
  toBookmarkFolders,
  saveTabsAsBookmarks,
} from "../lib/chrome-api";

interface UseBookmarksReturn {
  folders: BookmarkFolder[];
  loading: boolean;
  error: string | null;
  selectedFolderId: string;
  setSelectedFolderId: (id: string) => void;
  saveTabs: (tabs: TabInfo[], folderName: string) => Promise<SaveSummary>;
  refresh: () => Promise<void>;
}

// Default to "Other Bookmarks" folder ID (usually "2" in Chrome)
const DEFAULT_FOLDER_ID = "2";

export function useBookmarks(): UseBookmarksReturn {
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(DEFAULT_FOLDER_ID);

  const fetchFolders = async () => {
    setLoading(true);
    setError(null);
    try {
      const tree = await getBookmarkTree();
      const bookmarkFolders = toBookmarkFolders(tree);
      setFolders(bookmarkFolders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bookmarks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFolders();
  }, []);

  const saveTabs = useCallback(
    async (tabs: TabInfo[], folderName: string): Promise<SaveSummary> => {
      const { folderId, results } = await saveTabsAsBookmarks(
        tabs,
        selectedFolderId,
        folderName
      );

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return {
        total: tabs.length,
        succeeded,
        failed,
        results,
        folderId,
        folderName,
      };
    },
    [selectedFolderId]
  );

  return {
    folders,
    loading,
    error,
    selectedFolderId,
    setSelectedFolderId,
    saveTabs,
    refresh: fetchFolders,
  };
}
