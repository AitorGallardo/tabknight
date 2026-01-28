import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e);
      onCheckedChange?.(e.target.checked);
    };

    return (
      <label className="relative inline-flex items-center">
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          onChange={handleChange}
          className="peer sr-only"
          {...props}
        />
        <div
          className={cn(
            "h-4 w-4 shrink-0 rounded border border-input shadow-sm transition-colors",
            "peer-focus-visible:ring-[2px] peer-focus-visible:ring-ring/30",
            "peer-checked:bg-primary peer-checked:border-primary",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            className
          )}
        >
          <Check
            className={cn(
              "h-3 w-3 text-primary-foreground absolute top-0.5 left-0.5 opacity-0 transition-opacity",
              "peer-checked:opacity-100"
            )}
          />
        </div>
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
