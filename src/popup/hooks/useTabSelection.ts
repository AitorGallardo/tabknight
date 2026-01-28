import { useState, useCallback, useMemo } from "react";
import type { TabInfo } from "../types";

interface UseTabSelectionReturn {
  selectedIds: Set<number>;
  isSelected: (id: number) => boolean;
  toggle: (id: number) => void;
  selectAll: (tabs: TabInfo[]) => void;
  deselectAll: () => void;
  selectNonPinned: (tabs: TabInfo[]) => void;
  getSelectedTabs: (tabs: TabInfo[]) => TabInfo[];
  selectedCount: number;
}

export function useTabSelection(initialTabs?: TabInfo[]): UseTabSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    if (!initialTabs) return new Set();
    // Pre-select non-pinned tabs
    return new Set(initialTabs.filter((t) => !t.pinned).map((t) => t.id));
  });

  const isSelected = useCallback(
    (id: number) => selectedIds.has(id),
    [selectedIds]
  );

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((tabs: TabInfo[]) => {
    setSelectedIds(new Set(tabs.map((t) => t.id)));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectNonPinned = useCallback((tabs: TabInfo[]) => {
    setSelectedIds(new Set(tabs.filter((t) => !t.pinned).map((t) => t.id)));
  }, []);

  const getSelectedTabs = useCallback(
    (tabs: TabInfo[]) => tabs.filter((t) => selectedIds.has(t.id)),
    [selectedIds]
  );

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  return {
    selectedIds,
    isSelected,
    toggle,
    selectAll,
    deselectAll,
    selectNonPinned,
    getSelectedTabs,
    selectedCount,
  };
}
