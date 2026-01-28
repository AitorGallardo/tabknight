import { useState } from "react";
import { SaveTabsView } from "./views/SaveTabsView";
import { CloseTabsView } from "./views/CloseTabsView";
import { RestoreView } from "./views/RestoreView";
import type { AppView, SaveSummary } from "./types";

export function App() {
  const [view, setView] = useState<AppView>("save");
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
    <div className="w-[400px] h-[500px] bg-background text-foreground overflow-hidden">
      {view === "save" && <SaveTabsView onSaveComplete={handleSaveComplete} />}
      {view === "close" && saveSummary && (
        <CloseTabsView saveSummary={saveSummary} onComplete={handleCloseComplete} />
      )}
      {view === "restore" && <RestoreView onBack={handleBackToSave} />}
    </div>
  );
}
