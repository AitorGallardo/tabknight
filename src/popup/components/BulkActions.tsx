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
      <span className="text-xs text-muted-foreground">
        {selectedCount} of {totalCount} selected
      </span>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={selectedCount === totalCount}
        >
          Select All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDeselectAll}
          disabled={selectedCount === 0}
        >
          Deselect All
        </Button>
      </div>
    </div>
  );
}
