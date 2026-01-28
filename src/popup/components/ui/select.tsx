import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  onValueChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, onValueChange, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e);
      onValueChange?.(e.target.value);
    };

    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-8 w-full appearance-none rounded border border-input bg-transparent px-2 py-1.5 pr-8 text-xs shadow-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          onChange={handleChange}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50 pointer-events-none" />
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
