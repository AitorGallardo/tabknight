import { useState } from "react";
import { TabNavigatorView } from "./views/TabNavigatorView";
import { SaveTabsView } from "./views/SaveTabsView";
import { CloseTabsView } from "./views/CloseTabsView";
import { RestoreView } from "./views/RestoreView";
import { POPUP_HEIGHT, POPUP_WIDTH } from "./lib/constants";
import type { AppView, SaveSummary } from "./types";

export function App() {
  const [view, setView] = useState<AppView>("navigator");
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);

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
