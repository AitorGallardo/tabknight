import { useState, useEffect } from "react";
import { X, Copy, History, CheckCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { StatusMessage } from "../components/StatusMessage";
import { TabItem } from "../components/TabItem";
import { useTabSelection } from "../hooks/useTabSelection";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { closeTabs, openRecentlyClosed } from "../lib/chrome-api";
import { copyToClipboard } from "../lib/utils";
import type { SaveSummary, TabInfo } from "../types";

interface CloseTabsViewProps {
  saveSummary: SaveSummary;
  onComplete: () => void;
}

export function CloseTabsView({ saveSummary, onComplete }: CloseTabsViewProps) {
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert save results to TabInfo for selection
  const savedTabs: TabInfo[] = saveSummary.results
    .filter((r) => r.success)
    .map((r) => ({
      id: r.tabId,
      url: r.url,
      title: r.title,
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
      // Auto-close popup after closing tabs
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close tabs");
      setClosing(false);
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
    onSave: handleClose,
    onSelectAll: () => selectAll(savedTabs),
    onClose: handleSkip,
  });

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
      <ScrollArea className="flex-1">
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
