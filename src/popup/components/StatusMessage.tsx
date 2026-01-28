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
    success: "text-green-600 dark:text-green-500 bg-green-500/10",
    error: "text-destructive bg-destructive/10",
    warning: "text-yellow-600 dark:text-yellow-500 bg-yellow-500/10",
  }[type];

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded p-3",
        colors,
        className
      )}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{title}</p>
        {description && (
          <p className="text-xs opacity-80 mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}
