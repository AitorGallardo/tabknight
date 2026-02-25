import { useState, useEffect } from "react";
import { X, Copy, History, CheckCircle, RotateCcw } from "lucide-react";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { StatusMessage } from "../components/StatusMessage";
import { TabItem } from "../components/TabItem";
import { useTabSelection } from "../hooks/useTabSelection";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { closeTabs, openRecentlyClosed, getBookmarksInFolder, openUrlsAsTabs } from "../lib/chrome-api";
import { copyToClipboard } from "../lib/utils";
import type { SaveSummary, TabInfo } from "../types";

interface CloseTabsViewProps {
  saveSummary: SaveSummary;
  onComplete: () => void;
}

export function CloseTabsView({ saveSummary, onComplete }: CloseTabsViewProps) {
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [closedCount, setClosedCount] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert save results to TabInfo for selection
  const savedTabs: TabInfo[] = saveSummary.results
    .filter((r) => r.success)
    .map((r) => ({
      id: r.tabId,
      url: r.url,
      title: r.title,
      favIconUrl: r.favIconUrl,
      pinned: false,
      domain: "",
      isDuplicate: false,
    }));

  const { selectedIds, toggle, selectAll, deselectAll, selectedCount } =
    useTabSelection();

  // Pre-select all saved tabs
  useEffect(() => {
    selectAll(savedTabs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = async () => {
    if (selectedCount === 0) {
      onComplete();
      return;
    }

    setClosing(true);
    setError(null);

    try {
      const tabIdsToClose = savedTabs
        .filter((t) => selectedIds.has(t.id))
        .map((t) => t.id);
      await closeTabs(tabIdsToClose);
      setClosedCount(tabIdsToClose.length);
      setClosed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close tabs");
      setClosing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const bookmarks = await getBookmarksInFolder(saveSummary.folderId);
      const urls = bookmarks.map((b) => b.url!).filter(Boolean);
      await openUrlsAsTabs(urls);
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore tabs");
      setRestoring(false);
    }
  };

  const handleCopyUrls = async () => {
    const urls = savedTabs
      .filter((t) => selectedIds.has(t.id))
      .map((t) => t.url)
      .join("\n");

    const success = await copyToClipboard(urls);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSkip = () => {
    window.close();
  };

  useKeyboardShortcuts({
    onSave: closed ? () => window.close() : handleClose,
    onSelectAll: closed ? undefined : () => selectAll(savedTabs),
    onClose: handleSkip,
  });

  // Success screen after tabs are closed
  if (closed) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 space-y-4">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <div className="text-center space-y-1">
          <h2 className="text-sm font-semibold">
            Closed {closedCount} tab{closedCount !== 1 ? "s" : ""}
          </h2>
          <p className="text-xs text-muted-foreground">
            Bookmarks saved to "{saveSummary.folderName}"
          </p>
        </div>

        {error && <StatusMessage type="error" title={error} />}

        <div className="flex flex-col gap-2 w-full max-w-[240px]">
          <Button
            variant="outline"
            onClick={handleRestore}
            disabled={restoring}
            className="w-full"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {restoring ? "Restoring..." : "Restore Tabs"}
          </Button>
          <Button onClick={() => window.close()} className="w-full">
            Done
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Enter to close | Esc to close
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-border space-y-3">
        <StatusMessage
          type={saveSummary.failed > 0 ? "warning" : "success"}
          title={`Saved ${saveSummary.succeeded} tab${saveSummary.succeeded !== 1 ? "s" : ""} to "${saveSummary.folderName}"`}
          description={
            saveSummary.failed > 0
              ? `${saveSummary.failed} tab${saveSummary.failed !== 1 ? "s" : ""} failed to save`
              : undefined
          }
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Close saved tabs?
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => selectAll(savedTabs)}
              disabled={selectedCount === savedTabs.length}
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={deselectAll}
              disabled={selectedCount === 0}
            >
              Deselect All
            </Button>
          </div>
        </div>
      </div>

      {/* Tab List */}
      <ScrollArea className="flex-1 min-h-[200px] resize-y">
        {savedTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            selected={selectedIds.has(tab.id)}
            onToggle={toggle}
          />
        ))}
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 p-3 border-t border-border space-y-3">
        {error && <StatusMessage type="error" title={error} />}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyUrls}
            disabled={selectedCount === 0}
            className="flex-1"
          >
            {copied ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copy URLs
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openRecentlyClosed}
            className="flex-1"
          >
            <History className="h-3.5 w-3.5 mr-1" />
            History
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSkip} className="flex-1">
            Keep Tabs Open
          </Button>
          <Button
            variant="destructive"
            onClick={handleClose}
            disabled={closing}
            className="flex-1"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {closing
              ? "Closing..."
              : `Close ${selectedCount} Tab${selectedCount !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
