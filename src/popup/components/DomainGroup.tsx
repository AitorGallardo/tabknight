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
    <div className="border-b border-white/[0.07] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
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
          <span className="rounded-full bg-[#0a84ff]/20 px-2 py-0.5 text-[11px] font-medium text-[#5eaeff]">
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
