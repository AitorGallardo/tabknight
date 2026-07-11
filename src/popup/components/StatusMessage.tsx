import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { cn } from "../lib/cn";

interface StatusMessageProps {
  type: "success" | "error" | "warning";
  title: string;
  description?: string;
  className?: string;
}

export function StatusMessage({
  type,
  title,
  description,
  className,
}: StatusMessageProps) {
  const Icon = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
  }[type];

  const colors = {
    success: "border border-white/[0.07] bg-white/[0.04] text-white/80",
    error: "border border-red-400/25 bg-red-500/10 text-red-200",
    warning: "border border-amber-400/25 bg-amber-500/10 text-amber-200",
  }[type];

  const iconColors = {
    success: "text-[#30d158]",
    error: "text-red-200",
    warning: "text-amber-200",
  }[type];

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[10px] px-3 py-2 text-xs",
        colors,
        className
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconColors)} />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-white/55 mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}
