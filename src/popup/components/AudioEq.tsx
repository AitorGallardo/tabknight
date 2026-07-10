interface AudioEqProps {
  /** Animated bars when true; low, static, dimmed bars when false (paused or muted). */
  playing: boolean;
}

const BAR_COUNT = 4;

/** Tiny CSS-only "now playing" equalizer — animation lives in globals.css (tk-eq). */
export function AudioEq({ playing }: AudioEqProps) {
  return (
    <span
      className={`tk-eq flex h-3 shrink-0 items-end gap-[2px] ${
        playing ? "text-white/90" : "tk-eq--paused text-white/30"
      }`}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span key={i} className="tk-eq-bar h-full w-[3px] rounded-full bg-current" style={{ animationDelay: `${-i * 0.18}s` }} />
      ))}
    </span>
  );
}
