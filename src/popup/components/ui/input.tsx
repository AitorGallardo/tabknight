import * as React from "react";
import { cn } from "../../lib/cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 transition-colors",
          "file:border-0 file:bg-transparent file:text-xs file:font-medium",
          "placeholder:text-white/30",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0a84ff]/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
