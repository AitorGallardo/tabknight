import { useState } from "react";
import { FolderOpen, ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { FolderPicker } from "../components/FolderPicker";
import { StatusMessage } from "../components/StatusMessage";
import { useBookmarks } from "../hooks/useBookmarks";
import { getBookmarksInFolder, openUrlsAsTabs } from "../lib/chrome-api";

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

  const handleFolderChange = async (folderId: string) => {
    setSelectedFolderId(folderId);
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold">Restore Session</h1>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Select folder</label>
          <FolderPicker
            folders={folders}
            value={selectedFolderId}
            onChange={handleFolderChange}
            loading={foldersLoading}
          />
        </div>
      </div>

      {/* Bookmark List */}
      <ScrollArea className="flex-1">
        {loadingBookmarks ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading bookmarks...
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Select a folder to see bookmarks
          </div>
        ) : (
          <div className="p-2">
            {bookmarks.map((bookmark) => (
              <a
                key={bookmark.id}
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 rounded truncate"
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{bookmark.title}</span>
              </a>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 p-3 border-t border-border space-y-3">
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
      </div>
    </div>
  );
}
