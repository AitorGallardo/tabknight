import { useEffect, useState } from "react";
import { TabNavigatorView } from "./views/TabNavigatorView";
import { SaveTabsView } from "./views/SaveTabsView";
import { CloseTabsView } from "./views/CloseTabsView";
import { RestoreView } from "./views/RestoreView";
import { POPUP_HEIGHT, POPUP_WIDTH } from "./lib/constants";
import type { AppView, SaveSummary } from "./types";

interface StandaloneContext {
  backgroundImage?: string;
  returnToTabId?: number;
  returnToWindowId?: number;
  createdAt?: number;
}

export function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const isStandaloneNavigator = searchParams.get("standalone") === "1";
  const contextId = searchParams.get("context");
  const [view, setView] = useState<AppView>("navigator");
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);
  const [standaloneContext, setStandaloneContext] = useState<StandaloneContext | null>(null);

  useEffect(() => {
    if (!isStandaloneNavigator || !contextId) return;

    let cancelled = false;

    const loadContext = async () => {
      const stored = await chrome.storage.local.get(contextId);
      const context = stored[contextId] as StandaloneContext | undefined;

      await chrome.storage.local.remove(contextId);

      if (!cancelled) {
        setStandaloneContext(context ?? {});
      }
    };

    void loadContext();

    return () => {
      cancelled = true;
    };
  }, [contextId, isStandaloneNavigator]);

  const handleSaveComplete = (summary: SaveSummary) => {
    setSaveSummary(summary);
    setView("close");
  };

  const handleCloseComplete = () => {
    window.close();
  };

  const handleBackToSave = () => {
    setView("save");
    setSaveSummary(null);
  };

  if (isStandaloneNavigator) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05060a] p-4">
        {standaloneContext?.backgroundImage && (
          <>
            <div
              className="absolute inset-0 scale-105 bg-cover bg-center opacity-45 blur-2xl"
              style={{ backgroundImage: `url(${standaloneContext.backgroundImage})` }}
            />
            <div className="absolute inset-0 bg-[#05060a]/55" />
          </>
        )}
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
            WebkitMaskImage:
              "radial-gradient(circle at center, black 22%, transparent 78%)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_50%,transparent,rgba(5,6,10,0.42))]" />
        <div className="relative w-full max-w-[760px]" style={{ height: 430 }}>
          {view === "navigator" && (
            <TabNavigatorView
              onOpenSaveFlow={() => setView("save")}
              showSaveButton={false}
              temporary
              returnToTabId={standaloneContext?.returnToTabId ?? null}
            />
          )}
          {view === "save" && <SaveTabsView onSaveComplete={handleSaveComplete} />}
          {view === "close" && saveSummary && (
            <CloseTabsView saveSummary={saveSummary} onComplete={handleCloseComplete} />
          )}
          {view === "restore" && <RestoreView onBack={handleBackToSave} />}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-background text-foreground overflow-hidden"
      style={{ width: POPUP_WIDTH, height: POPUP_HEIGHT }}
    >
      {view === "navigator" && <TabNavigatorView onOpenSaveFlow={() => setView("save")} />}
      {view === "save" && <SaveTabsView onSaveComplete={handleSaveComplete} />}
      {view === "close" && saveSummary && (
        <CloseTabsView saveSummary={saveSummary} onComplete={handleCloseComplete} />
      )}
      {view === "restore" && <RestoreView onBack={handleBackToSave} />}
    </div>
  );
}
