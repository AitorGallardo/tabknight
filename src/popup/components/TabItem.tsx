import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";
import { truncate } from "../lib/utils";
import type { TabInfo } from "../types";

interface TabItemProps {
  tab: TabInfo;
  selected: boolean;
  onToggle: (id: number) => void;
}

export function TabItem({ tab, selected, onToggle }: TabItemProps) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors rounded",
        "hover:bg-accent/50",
        selected && "bg-accent/30"
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(tab.id)}
        className={cn(
          "h-3.5 w-3.5 shrink-0 rounded border border-input shadow-sm",
          "checked:bg-primary checked:border-primary",
          "focus:ring-[2px] focus:ring-ring/30"
        )}
      />
      <img
        src={tab.favIconUrl || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect fill='%23888' width='16' height='16' rx='2'/></svg>"}
        alt=""
        className="h-4 w-4 shrink-0 rounded"
        onError={(e) => {
          (e.target as HTMLImageElement).src =
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect fill='%23888' width='16' height='16' rx='2'/></svg>";
        }}
      />
      <span
        className="flex-1 text-xs truncate"
        title={tab.title}
      >
        {truncate(tab.title, 50)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {tab.pinned && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            Pinned
          </Badge>
        )}
        {tab.isDuplicate && (
          <Badge variant="warning" className="text-[10px] px-1 py-0">
            Duplicate
          </Badge>
        )}
      </div>
    </label>
  );
}
