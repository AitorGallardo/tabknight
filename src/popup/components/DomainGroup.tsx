import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { TabItem } from "./TabItem";
import type { TabInfo } from "../types";

interface DomainGroupProps {
  domain: string;
  tabs: TabInfo[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  defaultExpanded?: boolean;
}

export function DomainGroup({
  domain,
  tabs,
  selectedIds,
  onToggle,
  defaultExpanded = true,
}: DomainGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const selectedCount = tabs.filter((t) => selectedIds.has(t.id)).length;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors",
          "hover:bg-accent/50"
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="flex-1 text-xs font-medium truncate">{domain}</span>
        <span className="text-xs text-muted-foreground">
          {selectedCount}/{tabs.length}
        </span>
      </button>
      {expanded && (
        <div className="pl-2">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              selected={selectedIds.has(tab.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
