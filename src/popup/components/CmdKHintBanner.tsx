import { useEffect, useState } from "react";
import { X } from "lucide-react";

const DISMISS_KEY = "cmdkHintDismissed";
const FALLBACK_SHORTCUT = "⌘K / Ctrl+Shift+K";

export function CmdKHintBanner() {
  const [dismissed, setDismissed] = useState(true);
  const [shortcut, setShortcut] = useState(FALLBACK_SHORTCUT);
  const [unbound, setUnbound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await chrome.storage.local.get(DISMISS_KEY);
        if (!cancelled) setDismissed(!!stored[DISMISS_KEY]);
      } catch {
        if (!cancelled) setDismissed(false);
      }

      try {
        const commands = await chrome.commands.getAll();
        const command = commands.find((c) => c.name === "open_tab_navigator");
        if (cancelled) return;
        if (command?.shortcut) {
          setShortcut(command.shortcut);
        } else if (command) {
          setUnbound(true);
        }
      } catch {
        // Keep the fallback shortcut text.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    chrome.storage.local.set({ [DISMISS_KEY]: true }).catch(() => {});
  };

  if (dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] bg-white/[0.04] px-3 py-2 text-[11px] text-white/70 backdrop-blur-sm">
      {unbound ? (
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
          className="truncate text-left underline decoration-white/20 underline-offset-2 hover:text-white/90"
        >
          Set a shortcut to open TabKnight on any page
        </button>
      ) : (
        <span className="truncate">
          Press{" "}
          <kbd className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-[#5eaeff]">
            {shortcut}
          </kbd>{" "}
          on any page to open TabKnight
        </span>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
        aria-label="Dismiss hint"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
