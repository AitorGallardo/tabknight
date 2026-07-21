export const PREVIEW_TEXT_PREFERENCE_KEY = "previewTextPreference";

export type PreviewTextPreference = "sensitive" | "always-hide" | "always-show";

// Page text is opt-in. Titles, URLs, site names, images, and screenshots are
// separate preview data and remain available when this is selected.
export const DEFAULT_PREVIEW_TEXT_PREFERENCE: PreviewTextPreference = "always-hide";

const SENSITIVE_HOST_PARTS = [
  "account",
  "admin",
  "bank",
  "billing",
  "health",
  "inbox",
  "mail",
  "messages",
  "patient",
  "pay",
  "portal",
  "wallet",
];

const SENSITIVE_PATH_PARTS = [
  "account",
  "admin",
  "auth",
  "billing",
  "checkout",
  "inbox",
  "login",
  "messages",
  "patient",
  "payment",
  "private",
  "settings",
  "signin",
];

export function isPreviewTextPreference(value: unknown): value is PreviewTextPreference {
  return value === "sensitive" || value === "always-hide" || value === "always-show";
}

/** Conservative, local-only URL heuristic. It deliberately never reads page text. */
export function isSensitivePreviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    const hostParts = url.hostname.toLowerCase().split(/[.-]/);
    const pathParts = url.pathname.toLowerCase().split(/[^a-z0-9]+/);
    return (
      hostParts.some((part) => SENSITIVE_HOST_PARTS.includes(part)) ||
      pathParts.some((part) => SENSITIVE_PATH_PARTS.includes(part))
    );
  } catch {
    return true;
  }
}

export function shouldSuppressPreviewText(url: string, preference: PreviewTextPreference): boolean {
  if (preference === "always-hide") return true;
  if (preference === "always-show") return false;
  return isSensitivePreviewUrl(url);
}

export async function getPreviewTextPreference(): Promise<PreviewTextPreference> {
  try {
    const stored = await chrome.storage.local.get(PREVIEW_TEXT_PREFERENCE_KEY);
    const value = stored[PREVIEW_TEXT_PREFERENCE_KEY];
    return isPreviewTextPreference(value) ? value : DEFAULT_PREVIEW_TEXT_PREFERENCE;
  } catch {
    return DEFAULT_PREVIEW_TEXT_PREFERENCE;
  }
}

export async function setPreviewTextPreference(preference: PreviewTextPreference): Promise<void> {
  await chrome.storage.local.set({ [PREVIEW_TEXT_PREFERENCE_KEY]: preference });
}
