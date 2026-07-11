import { Button } from "./ui/button";

interface BulkActionsProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function BulkActions({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
}: BulkActionsProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {selectedCount > 0 ? (
        <span className="rounded-full bg-[#0a84ff]/20 px-2 py-0.5 text-[11px] font-medium text-[#5eaeff]">
          {selectedCount} of {totalCount} selected
        </span>
      ) : (
        <span className="text-[11px] text-white/45">
          {selectedCount} of {totalCount} selected
        </span>
      )}
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="px-2 py-1 text-[11px]"
          onClick={onSelectAll}
          disabled={selectedCount === totalCount}
        >
          Select All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="px-2 py-1 text-[11px]"
          onClick={onDeselectAll}
          disabled={selectedCount === 0}
        >
          Deselect All
        </Button>
      </div>
    </div>
  );
}
