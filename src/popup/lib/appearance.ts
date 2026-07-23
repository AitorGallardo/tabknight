export const ACCENT_PREFERENCE_KEY = "accentPreference";

export type AccentPreference = "zinc" | "raycast";

export const DEFAULT_ACCENT_PREFERENCE: AccentPreference = "zinc";
export const RAYCAST_RED = "#FF6363";
export const ZINC_BADGE = "#52525B";

export function isAccentPreference(value: unknown): value is AccentPreference {
  return value === "zinc" || value === "raycast";
}

export function applyAccentPreference(
  preference: AccentPreference,
  root: HTMLElement = document.documentElement
): void {
  root.dataset.accent = preference;
}

export function badgeColorForAccent(preference: AccentPreference): string {
  return preference === "raycast" ? RAYCAST_RED : ZINC_BADGE;
}

export async function getAccentPreference(): Promise<AccentPreference> {
  try {
    const stored = await chrome.storage.local.get(ACCENT_PREFERENCE_KEY);
    const value = stored[ACCENT_PREFERENCE_KEY];
    return isAccentPreference(value) ? value : DEFAULT_ACCENT_PREFERENCE;
  } catch {
    return DEFAULT_ACCENT_PREFERENCE;
  }
}

export async function setAccentPreference(preference: AccentPreference): Promise<void> {
  await chrome.storage.local.set({ [ACCENT_PREFERENCE_KEY]: preference });
}
