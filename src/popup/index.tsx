import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  ACCENT_PREFERENCE_KEY,
  DEFAULT_ACCENT_PREFERENCE,
  applyAccentPreference,
  getAccentPreference,
  isAccentPreference,
} from "./lib/appearance";

// In the tab-preview overlay (?overlay=1), the host page already paints a
// blurred backdrop + skeleton behind the iframe — the iframe document itself
// must stay transparent until React mounts, or a pre-React white body paint
// flashes over the skeleton. This runs as a module import, before render, so
// it lands as early as possible; it must not affect the normal toolbar popup
// or the standalone (?standalone=1) preview tab, which both want an opaque
// background. (An inline <script> in popup/index.html would run earlier
// still, but MV3's default extension-page CSP blocks inline scripts.)
if (location.search.includes("overlay=1")) {
  document.documentElement.classList.add("tk-overlay");
}

// Apply zinc synchronously to avoid a stale-color flash, then hydrate the
// user's optional accent and keep every extension surface in sync.
applyAccentPreference(DEFAULT_ACCENT_PREFERENCE);
void getAccentPreference().then(applyAccentPreference);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const value = changes[ACCENT_PREFERENCE_KEY]?.newValue;
  applyAccentPreference(isAccentPreference(value) ? value : DEFAULT_ACCENT_PREFERENCE);
});

// Apply dark mode based on system preference
function applyTheme() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", isDark);
}

// Apply theme on load
applyTheme();

// Listen for theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// Mount React app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
