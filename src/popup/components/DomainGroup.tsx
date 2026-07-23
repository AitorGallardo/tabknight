import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { TabItem } from "./TabItem";
import type { TabInfo } from "../types";

interface DomainGroupProps {
  domain: string;
  tabs: TabInfo[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Flat cursor index of this group's first tab within the visible list. */
  indexOffset: number;
  cursorIndex: number;
  registerItem: (index: number) => (el: HTMLElement | null) => void;
}

export function DomainGroup({
  domain,
  tabs,
  selectedIds,
  onToggle,
  expanded,
  onToggleExpanded,
  indexOffset,
  cursorIndex,
  registerItem,
}: DomainGroupProps) {
  const selectedCount = tabs.filter((t) => selectedIds.has(t.id)).length;

  return (
    <div className="border-b border-white/[0.07] last:border-b-0">
      <button
        onClick={onToggleExpanded}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors",
          "hover:bg-white/[0.06]"
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-white/30" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-white/30" />
        )}
        <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
          {domain}
        </span>
        {selectedCount > 0 ? (
          <span className="rounded-full bg-[hsl(var(--tk-accent)/0.16)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--tk-accent))]">
            {selectedCount}/{tabs.length}
          </span>
        ) : (
          <span className="text-[10px] text-white/30">
            {selectedCount}/{tabs.length}
          </span>
        )}
      </button>
      {expanded && (
        <div className="pl-2">
          {tabs.map((tab, i) => (
            <TabItem
              key={tab.id}
              tab={tab}
              selected={selectedIds.has(tab.id)}
              onToggle={onToggle}
              cursor={indexOffset + i === cursorIndex}
              itemRef={registerItem(indexOffset + i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
