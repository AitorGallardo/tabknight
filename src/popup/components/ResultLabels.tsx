interface ResultLabelsProps {
  active: boolean;
  source?: string;
  action?: string;
}

/** Stable source/action grammar shared by compact command-bar result rows. */
export function ResultLabels({ active, source = "Tab", action = "Switch" }: ResultLabelsProps) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      <span
        className={`rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.06em] ${
          active
            ? "bg-white/15 text-white/90"
            : "bg-black/[0.035] text-black/45 dark:bg-white/[0.04] dark:text-white/40"
        }`}
      >
        {source}
      </span>
      <span className={`text-[10px] font-medium ${active ? "text-white/85" : "text-black/50 dark:text-white/45"}`}>
        {action}
      </span>
    </span>
  );
}
