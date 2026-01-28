// URL patterns to filter out (system tabs)
export const SYSTEM_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^about:/,
  /^edge:\/\//,
  /^brave:\/\//,
  /^opera:\/\//,
  /^vivaldi:\/\//,
  /^file:\/\//,
  /^devtools:\/\//,
];

// Default date format for folder names
export const DATE_FORMAT = "YYYY-MM-DD";

// Popup dimensions
export const POPUP_WIDTH = 400;
export const POPUP_HEIGHT = 500;

// Debounce delay for search (ms)
export const SEARCH_DEBOUNCE_MS = 150;

// Keyboard shortcuts
export const SHORTCUTS = {
  SAVE: "Enter",
  SELECT_ALL: "a",
  CLOSE_POPUP: "Escape",
} as const;
