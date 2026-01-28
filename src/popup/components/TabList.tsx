import { useMemo } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { DomainGroup } from "./DomainGroup";
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

  const totalTabs = filteredGroups.reduce((sum, g) => sum + g.tabs.length, 0);

  if (totalTabs === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        {searchQuery ? "No tabs match your search" : "No tabs available"}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      {filteredGroups.map((group) => (
        <DomainGroup
          key={group.domain}
          domain={group.domain}
          tabs={group.tabs}
          selectedIds={selectedIds}
          onToggle={onToggle}
        />
      ))}
    </ScrollArea>
  );
}
