import { isBrowserCommandAvailable } from "./browser-commands";
import type { BrowserCommandId, BrowserCommandTab } from "./browser-commands";

export interface BrowserCommandApi {
  remove: (tabId: number) => Promise<void>;
  duplicate: (tabId: number) => Promise<unknown>;
  update: (tabId: number, properties: { pinned?: boolean; muted?: boolean }) => Promise<unknown>;
  reload: (tabId: number) => Promise<void>;
  create: (properties: { url: string; active: boolean }) => Promise<unknown>;
}

export interface BrowserCommandExecution {
  announcement: string;
}

const TARGET_REQUIRED = new Set<BrowserCommandId>([
  "close-tab",
  "duplicate-tab",
  "pin-tab",
  "unpin-tab",
  "mute-tab",
  "unmute-tab",
  "reload-tab",
]);

/** Routes one explicit activation to Chrome. Callers own dismissal and failure UI. */
export async function executeBrowserCommand(
  commandId: BrowserCommandId,
  targetTab: BrowserCommandTab | null,
  api: BrowserCommandApi
): Promise<BrowserCommandExecution> {
  if (TARGET_REQUIRED.has(commandId) && !targetTab) {
    throw new Error("The current tab is no longer available");
  }
  if (!isBrowserCommandAvailable(commandId, { targetTab })) {
    throw new Error("That command is no longer available");
  }

  const tab = targetTab as BrowserCommandTab;
  switch (commandId) {
    case "close-tab":
      await api.remove(tab.id);
      return { announcement: `Closed ${tab.title}` };
    case "duplicate-tab":
      await api.duplicate(tab.id);
      return { announcement: `Duplicated ${tab.title}` };
    case "pin-tab":
      await api.update(tab.id, { pinned: true });
      return { announcement: `Pinned ${tab.title}` };
    case "unpin-tab":
      await api.update(tab.id, { pinned: false });
      return { announcement: `Unpinned ${tab.title}` };
    case "mute-tab":
      await api.update(tab.id, { muted: true });
      return { announcement: `Muted ${tab.title}` };
    case "unmute-tab":
      await api.update(tab.id, { muted: false });
      return { announcement: `Unmuted ${tab.title}` };
    case "reload-tab":
      await api.reload(tab.id);
      return { announcement: `Reloaded ${tab.title}` };
    case "new-tab":
      await api.create({ url: "chrome://newtab/", active: true });
      return { announcement: "Opened a new tab" };
  }
}
