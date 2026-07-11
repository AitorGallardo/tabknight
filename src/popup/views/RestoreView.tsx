import { useState, useEffect, useCallback } from "react";
import { FolderOpen, ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { FolderPicker } from "../components/FolderPicker";
import { StatusMessage } from "../components/StatusMessage";
import { useBookmarks } from "../hooks/useBookmarks";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useRovingCursor } from "../hooks/useRovingCursor";
import { getBookmarksInFolder, openUrlAsTab, openUrlsAsTabs } from "../lib/chrome-api";
import { cn } from "../lib/cn";

interface RestoreViewProps {
  onBack: () => void;
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
}

export function RestoreView({ onBack }: RestoreViewProps) {
  const { folders, loading: foldersLoading, selectedFolderId, setSelectedFolderId } =
    useBookmarks();

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedFolder, setPickedFolder] = useState(false);

  const handleFolderChange = async (folderId: string) => {
    setSelectedFolderId(folderId);
    setPickedFolder(true);
    setLoadingBookmarks(true);
    setError(null);

    try {
      const items = await getBookmarksInFolder(folderId);
      setBookmarks(
        items.map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url!,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bookmarks");
      setBookmarks([]);
    } finally {
      setLoadingBookmarks(false);
    }
  };

  // The folder picker renders pre-selected with the default folder, so fetch
  // its bookmarks up front instead of waiting for a manual selection.
  useEffect(() => {
    handleFolderChange(selectedFolderId);
  }, []);

  const handleOpenAll = async () => {
    if (bookmarks.length === 0) return;

    setOpening(true);
    setError(null);

    try {
      const urls = bookmarks.map((b) => b.url);
      await openUrlsAsTabs(urls);
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open tabs");
      setOpening(false);
    }
  };

  const handleCursorToggle = useCallback(() => {
    // No selection concept here — Space has nothing to toggle.
  }, []);

  const { cursorIndex, listRef, registerItem } = useRovingCursor({
    items: bookmarks,
    onToggle: handleCursorToggle,
    resetKey: selectedFolderId,
  });

  const handleOpenSelected = useCallback(() => {
    const bookmark = bookmarks[cursorIndex];
    if (!bookmark) return;
    void openUrlAsTab(bookmark.url);
  }, [bookmarks, cursorIndex]);

  useKeyboardShortcuts({
    onSave: bookmarks.length > 0 ? handleOpenSelected : undefined,
    onSaveWithModifier: !opening && bookmarks.length > 0 ? handleOpenAll : undefined,
    onClose: onBack,
  });

  const kbdClass = "rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-white/70";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-white/[0.07] space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-[#5eaeff]" />
          <h1 className="text-sm font-semibold text-white/90">Restore Session</h1>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-[0.08em] text-white/40">Select folder</label>
          <FolderPicker
            folders={folders}
            value={selectedFolderId}
            onChange={handleFolderChange}
            loading={foldersLoading}
          />
        </div>
      </div>

      {/* Bookmark List */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-2 py-2 space-y-0.5">
        {loadingBookmarks ? (
          <div className="flex flex-col items-center gap-2 py-12 text-xs text-white/45">Loading…</div>
        ) : bookmarks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-xs text-white/45">
            {pickedFolder ? "This folder is empty" : "Pick a folder to see its tabs"}
          </div>
        ) : (
          bookmarks.map((bookmark, index) => (
            <a
              key={bookmark.id}
              ref={registerItem(index)}
              href={bookmark.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-white/80 transition-colors duration-100 hover:bg-white/[0.06]",
                index === cursorIndex && "bg-white/[0.06] ring-1 ring-inset ring-white/15"
              )}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white/[0.08] text-white/80">
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-[13px] font-medium tracking-[-0.01em]">{bookmark.title}</span>
            </a>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 p-3 border-t border-white/[0.07] space-y-3">
        {error && <StatusMessage type="error" title={error} />}

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button
            onClick={handleOpenAll}
            disabled={opening || bookmarks.length === 0}
            className="flex-1"
          >
            {opening
              ? "Opening..."
              : `Open ${bookmarks.length} Tab${bookmarks.length !== 1 ? "s" : ""}`}
          </Button>
        </div>

        <div className="flex items-center justify-end gap-4 text-[11px] text-white/50">
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>↑↓</kbd> Move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>↵</kbd> Open
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>⌘↵</kbd> Open all
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>esc</kbd> Back
          </span>
        </div>
      </div>
    </div>
  );
}
