import { useState, useEffect, useMemo } from "react";
import { Bookmark } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { TabList } from "../components/TabList";
import { SearchFilter } from "../components/SearchFilter";
import { BulkActions } from "../components/BulkActions";
import { FolderPicker } from "../components/FolderPicker";
import { StatusMessage } from "../components/StatusMessage";
import { useTabs } from "../hooks/useTabs";
import { useBookmarks } from "../hooks/useBookmarks";
import { useTabSelection } from "../hooks/useTabSelection";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { formatDate } from "../lib/utils";
import type { SaveSummary } from "../types";

interface SaveTabsViewProps {
  onSaveComplete: (summary: SaveSummary) => void;
}

export function SaveTabsView({ onSaveComplete }: SaveTabsViewProps) {
  const { tabs, domainGroups, loading: tabsLoading, error: tabsError } = useTabs();
  const {
    folders,
    loading: foldersLoading,
    selectedFolderId,
    setSelectedFolderId,
    saveTabs,
  } = useBookmarks();

  const [searchQuery, setSearchQuery] = useState("");
  const [folderName, setFolderName] = useState(formatDate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize selection after tabs load
  const {
    selectedIds,
    toggle,
    selectAll,
    deselectAll,
    getSelectedTabs,
    selectedCount,
  } = useTabSelection();

  // Pre-select non-pinned tabs when tabs load
  useEffect(() => {
    if (tabs.length > 0) {
      const nonPinnedIds = tabs.filter((t) => !t.pinned).map((t) => t.id);
      nonPinnedIds.forEach((id) => {
        if (!selectedIds.has(id)) {
          toggle(id);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  // Filtered tabs for selection operations
  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return tabs;
    const query = searchQuery.toLowerCase();
    return tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(query) ||
        tab.url.toLowerCase().includes(query) ||
        tab.domain.toLowerCase().includes(query)
    );
  }, [tabs, searchQuery]);

  const handleSave = async () => {
    const selectedTabs = getSelectedTabs(tabs);
    if (selectedTabs.length === 0) {
      setError("Please select at least one tab to save");
      return;
    }

    if (!folderName.trim()) {
      setError("Please enter a folder name");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const summary = await saveTabs(selectedTabs, folderName.trim());
      onSaveComplete(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tabs");
      setSaving(false);
    }
  };

  const handleClose = () => {
    window.close();
  };

  useKeyboardShortcuts({
    onSave: handleSave,
    onSelectAll: () => selectAll(filteredTabs),
    onClose: handleClose,
  });

  if (tabsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-white/45">Loading tabs...</div>
      </div>
    );
  }

  if (tabsError) {
    return (
      <div className="p-3">
        <StatusMessage
          type="error"
          title="Failed to load tabs"
          description={tabsError}
        />
      </div>
    );
  }

  const kbdClass = "rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-white/70";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.07] px-3 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-[#5eaeff]" />
          <h1 className="text-sm font-semibold text-white/90">Save Tabs as Bookmarks</h1>
        </div>

        <SearchFilter value={searchQuery} onChange={setSearchQuery} />

        <BulkActions
          selectedCount={selectedCount}
          totalCount={filteredTabs.length}
          onSelectAll={() => selectAll(filteredTabs)}
          onDeselectAll={deselectAll}
        />
      </div>

      {/* Tab List */}
      <TabList
        domainGroups={domainGroups}
        selectedIds={selectedIds}
        onToggle={toggle}
        searchQuery={searchQuery}
      />

      {/* Footer */}
      <div className="shrink-0 border-t border-white/[0.07] px-3 py-3 space-y-3">
        {error && (
          <StatusMessage
            type="error"
            title={error}
          />
        )}

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-[0.08em] text-white/40">Folder name</label>
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Enter folder name"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-[0.08em] text-white/40">Save in</label>
          <FolderPicker
            folders={folders}
            value={selectedFolderId}
            onChange={setSelectedFolderId}
            loading={foldersLoading}
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || selectedCount === 0}
          className="w-full"
        >
          {saving ? "Saving..." : `Save ${selectedCount} Tab${selectedCount !== 1 ? "s" : ""}`}
        </Button>

        <div className="flex items-center justify-end gap-4 text-[11px] text-white/50">
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>↵</kbd> Save
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>⌘A</kbd> Select all
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={kbdClass}>esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
