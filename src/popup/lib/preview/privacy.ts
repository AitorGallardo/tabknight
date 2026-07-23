export const PREVIEW_TEXT_PREFERENCE_KEY = "previewTextPreference";
export const PREVIEW_TEXT_REDACTION_VERSION_KEY = "previewTextRedactionVersion";
const PREVIEW_TEXT_REDACTION_VERSION = 1;

export type PreviewTextPreference = "sensitive" | "always-hide" | "always-show";

// Rich local previews are the default. Users can still hide text everywhere
// or only on sensitive-looking URLs from Options.
export const DEFAULT_PREVIEW_TEXT_PREFERENCE: PreviewTextPreference = "always-show";

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

export async function redactAndMarkPreviewText(redact: () => Promise<void>): Promise<void> {
  await redact();
  await chrome.storage.local.set({
    [PREVIEW_TEXT_REDACTION_VERSION_KEY]: PREVIEW_TEXT_REDACTION_VERSION,
  });
}

/**
 * Lazily purge prose captured by older releases when a restrictive policy is
 * first observed. The version marker keeps normal overlay opens read-only.
 */
export async function ensurePreviewTextPrivacy(redact: () => Promise<void>): Promise<PreviewTextPreference> {
  const preference = await getPreviewTextPreference();
  if (preference === "always-show") return preference;

  try {
    const stored = await chrome.storage.local.get(PREVIEW_TEXT_REDACTION_VERSION_KEY);
    if (stored[PREVIEW_TEXT_REDACTION_VERSION_KEY] !== PREVIEW_TEXT_REDACTION_VERSION) {
      await redactAndMarkPreviewText(redact);
    }
  } catch {
    // Display still fails closed; retry the storage migration next time.
  }

  return preference;
}

export async function setPreviewTextPreference(preference: PreviewTextPreference): Promise<void> {
  await chrome.storage.local.set({
    [PREVIEW_TEXT_PREFERENCE_KEY]: preference,
    ...(preference === "always-show" ? { [PREVIEW_TEXT_REDACTION_VERSION_KEY]: 0 } : {}),
  });
}
