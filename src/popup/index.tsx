import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

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
