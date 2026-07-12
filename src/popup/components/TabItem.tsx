import { Favicon } from "./Favicon";
import { cn } from "../lib/cn";
import { truncate } from "../lib/utils";
import type { TabInfo } from "../types";

interface TabItemProps {
  tab: TabInfo;
  selected: boolean;
  onToggle: (id: number) => void;
  cursor?: boolean;
  itemRef?: (el: HTMLLabelElement | null) => void;
}

export function TabItem({ tab, selected, onToggle, cursor = false, itemRef }: TabItemProps) {
  return (
    <label
      ref={itemRef}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 transition-colors duration-100",
        selected ? "bg-[#0a84ff]/12 text-white/80" : "text-white/80 hover:bg-white/[0.06]",
        cursor && "ring-1 ring-inset ring-white/15",
        cursor && !selected && "bg-white/[0.06]"
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(tab.id)}
        className={cn(
          "h-4 w-4 shrink-0 rounded-[4px] border border-white/20 bg-white/[0.06]",
          "checked:bg-[#0a84ff] checked:border-[#0a84ff]",
          "focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0a84ff]/50"
        )}
      />
      <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white/[0.08] text-white/80">
        <Favicon pageUrl={tab.url} favIconUrl={tab.favIconUrl} size={24} className="h-full w-full object-cover" />
      </span>
      <span
        className="flex-1 truncate text-[13px] font-medium tracking-[-0.01em]"
        title={tab.title}
      >
        {truncate(tab.title, 50)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {tab.pinned && (
          <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/45">
            Pinned
          </span>
        )}
        {tab.isDuplicate && (
          <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/45">
            Duplicate
          </span>
        )}
      </div>
    </label>
  );
}
