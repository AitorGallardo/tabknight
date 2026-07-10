import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants";

interface SearchFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchFilter({
  value,
  onChange,
  placeholder = "Search tabs...",
}: SearchFilterProps) {
  const [localValue, setLocalValue] = useState(value);

  // Debounce the onChange callback
  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [localValue, onChange]);

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <Search className="h-4 w-4 shrink-0 text-white/55" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full border-none bg-transparent text-base font-medium tracking-[-0.01em] text-white/92 outline-none placeholder:text-white/30"
      />
      {localValue && (
        <button
          type="button"
          onClick={() => {
            setLocalValue("");
            onChange("");
          }}
          className="shrink-0 text-white/45 hover:text-white/80"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
