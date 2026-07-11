import { useCallback, useMemo, useState } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { DomainGroup } from "./DomainGroup";
import { useRovingCursor } from "../hooks/useRovingCursor";
import type { DomainGroup as DomainGroupType } from "../types";

interface TabListProps {
  domainGroups: DomainGroupType[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  searchQuery: string;
}

export function TabList({
  domainGroups,
  selectedIds,
  onToggle,
  searchQuery,
}: TabListProps) {
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set());

  const toggleDomain = useCallback((domain: string) => {
    setCollapsedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return domainGroups;

    const query = searchQuery.toLowerCase();
    return domainGroups
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter(
          (tab) =>
            tab.title.toLowerCase().includes(query) ||
            tab.url.toLowerCase().includes(query) ||
            tab.domain.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.tabs.length > 0);
  }, [domainGroups, searchQuery]);

  // Flattened, collapse-aware visible tabs — the roving cursor's index space.
  const visibleTabs = useMemo(
    () =>
      filteredGroups.flatMap((group) =>
        collapsedDomains.has(group.domain) ? [] : group.tabs
      ),
    [filteredGroups, collapsedDomains]
  );

  const handleCursorToggle = useCallback(
    (index: number) => {
      const tab = visibleTabs[index];
      if (tab) onToggle(tab.id);
    },
    [visibleTabs, onToggle]
  );

  const { cursorIndex, listRef, registerItem } = useRovingCursor({
    items: visibleTabs,
    onToggle: handleCursorToggle,
    resetKey: searchQuery,
  });

  const totalTabs = filteredGroups.reduce((sum, g) => sum + g.tabs.length, 0);

  if (totalTabs === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-xs text-white/45">
        {searchQuery ? "No tabs match" : "No tabs to save"}
      </div>
    );
  }

  let indexOffset = 0;

  return (
    <ScrollArea ref={listRef} className="flex-1 min-h-[200px] resize-y">
      {filteredGroups.map((group) => {
        const expanded = !collapsedDomains.has(group.domain);
        const groupOffset = indexOffset;
        if (expanded) indexOffset += group.tabs.length;

        return (
          <DomainGroup
            key={group.domain}
            domain={group.domain}
            tabs={group.tabs}
            selectedIds={selectedIds}
            onToggle={onToggle}
            expanded={expanded}
            onToggleExpanded={() => toggleDomain(group.domain)}
            indexOffset={groupOffset}
            cursorIndex={cursorIndex}
            registerItem={registerItem}
          />
        );
      })}
    </ScrollArea>
  );
}
