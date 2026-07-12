import { useCallback, useEffect, useState } from "react";
import { Keyboard, ShieldCheck, Trash2 } from "lucide-react";
import { clearAllCards, clearAllThumbnails, countCards, countThumbnails } from "../lib/preview/db";

interface StorageStats {
  cards: number;
  thumbnails: number;
  approxBytes: number | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const panelClass =
  "rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(28,28,30,0.86),rgba(20,20,22,0.84))] px-6 py-5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-[30px]";

export function OptionsView() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [unbound, setUnbound] = useState(false);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const version = chrome.runtime.getManifest().version;

  const loadStats = useCallback(async () => {
    try {
      const [cards, thumbnails] = await Promise.all([countCards(), countThumbnails()]);
      let approxBytes: number | null = null;
      try {
        const estimate = await navigator.storage.estimate();
        approxBytes = estimate.usage ?? null;
      } catch {
        approxBytes = null;
      }
      setStats({ cards, thumbnails, approxBytes });
    } catch {
      setStats({ cards: 0, thumbnails: 0, approxBytes: null });
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const commands = await chrome.commands.getAll();
        const command = commands.find((c) => c.name === "open_tab_navigator");
        if (command?.shortcut) {
          setShortcut(command.shortcut);
        } else {
          setUnbound(true);
        }
      } catch {
        setUnbound(true);
      }
    })();
    void loadStats();
  }, [loadStats]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    setCleared(false);
    try {
      await Promise.all([clearAllCards(), clearAllThumbnails()]);
      await loadStats();
      setCleared(true);
    } finally {
      setClearing(false);
    }
  }, [loadStats]);

  const openShortcutsPage = () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#05060a] px-4 py-10 text-[#f5f5f7]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.22) 1px, transparent 0)",
            "radial-gradient(circle at 1px 1px, rgba(90,120,255,0.12) 1px, transparent 0)",
          ].join(","),
          backgroundSize: "14px 14px, 22px 22px",
          backgroundPosition: "0 0, 7px 7px",
          maskImage: "radial-gradient(circle at center, black 22%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(circle at center, black 22%, transparent 78%)",
        }}
      />

      <div className="relative mx-auto flex max-w-[640px] flex-col gap-4">
        <header className={`flex items-center justify-between ${panelClass}`}>
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.02em] text-white/95">TabKnight</h1>
            <p className="text-xs text-white/45">Settings &amp; privacy</p>
          </div>
          <span className="rounded-md bg-white/[0.08] px-2 py-1 text-[11px] text-white/60">v{version}</span>
        </header>

        <section className={panelClass}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
            <Keyboard className="h-4 w-4 text-[#5eaeff]" />
            Shortcut
          </div>
          <p className="mt-2 text-xs text-white/55">
            Opens the tab-preview overlay (Cmd+K) on the page you&apos;re viewing.
          </p>
          <div className="mt-3 flex items-center justify-between">
            {unbound ? (
              <span className="text-sm text-white/70">No shortcut set</span>
            ) : (
              <kbd className="rounded-md bg-white/[0.08] px-2 py-1 text-sm text-white/85">
                {shortcut}
              </kbd>
            )}
            <button
              type="button"
              onClick={openShortcutsPage}
              className="rounded-md border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0a84ff]/50"
            >
              Change
            </button>
          </div>
        </section>

        <section className={panelClass}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
            <ShieldCheck className="h-4 w-4 text-[#5eaeff]" />
            Privacy
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            TabKnight builds tab previews by reading page titles, descriptions, and
            og:images, and by capturing screenshots of the tabs you visit. All of
            it is stored locally in your browser (IndexedDB) — nothing ever leaves
            your device. No analytics, no network calls, no third parties.
          </p>
        </section>

        <section className={panelClass}>
          <div className="text-sm font-semibold text-white/90">Preview data</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
            <span>{stats ? stats.cards : "…"} cards</span>
            <span>{stats ? stats.thumbnails : "…"} thumbnails</span>
            <span>
              {stats?.approxBytes != null
                ? `~${formatBytes(stats.approxBytes)} used`
                : "Storage size unavailable"}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={clearing}
              className="flex items-center gap-1.5 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-[#0a84ff]/50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear preview data
            </button>
            {cleared && <span className="text-xs text-white/50">Cleared</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
