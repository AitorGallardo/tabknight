export type BrowserCommandId =
  | "close-tab"
  | "duplicate-tab"
  | "pin-tab"
  | "unpin-tab"
  | "mute-tab"
  | "unmute-tab"
  | "reload-tab"
  | "native-split-view"
  | "new-tab";

export interface BrowserCommandTab {
  id: number;
  title: string;
  pinned: boolean;
  muted?: boolean;
}

export interface BrowserCommandContext {
  targetTab: BrowserCommandTab | null;
}

export interface BrowserCommand {
  id: BrowserCommandId;
  label: string;
  actionLabel: string;
  description: string;
  shortcut?: string;
  keywords: readonly string[];
}

interface CommandDefinition extends BrowserCommand {
  available: (context: BrowserCommandContext) => boolean;
}

const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "close-tab",
    label: "Close Selected Tab",
    actionLabel: "Close Tab",
    description: "Close the highlighted tab",
    shortcut: "⌥W / Alt+W",
    keywords: ["close", "close tab", "remove", "selected tab"],
    available: ({ targetTab }) => targetTab !== null,
  },
  {
    id: "duplicate-tab",
    label: "Duplicate Selected Tab",
    actionLabel: "Duplicate Tab",
    description: "Open a copy of the highlighted tab",
    shortcut: "⌥D / Alt+D",
    keywords: ["duplicate", "duplicate tab", "copy", "clone", "selected tab"],
    available: ({ targetTab }) => targetTab !== null,
  },
  {
    id: "pin-tab",
    label: "Pin Selected Tab",
    actionLabel: "Pin Tab",
    description: "Keep the highlighted tab at the start of its window",
    shortcut: "⌥P / Alt+P",
    keywords: ["pin", "pin tab", "keep", "selected tab"],
    available: ({ targetTab }) => targetTab !== null && !targetTab.pinned,
  },
  {
    id: "unpin-tab",
    label: "Unpin Selected Tab",
    actionLabel: "Unpin Tab",
    description: "Return the highlighted tab to the regular tab strip",
    shortcut: "⌥P / Alt+P",
    keywords: ["unpin", "unpin tab", "pin", "pin tab", "selected tab"],
    available: ({ targetTab }) => targetTab !== null && targetTab.pinned,
  },
  {
    id: "mute-tab",
    label: "Mute Selected Tab",
    actionLabel: "Mute Tab",
    description: "Silence audio from the highlighted tab",
    shortcut: "⌥M / Alt+M",
    keywords: ["mute", "mute tab", "sound", "audio", "selected tab"],
    available: ({ targetTab }) => targetTab !== null && !targetTab.muted,
  },
  {
    id: "unmute-tab",
    label: "Unmute Selected Tab",
    actionLabel: "Unmute Tab",
    description: "Restore audio from the highlighted tab",
    shortcut: "⌥M / Alt+M",
    keywords: ["unmute", "unmute tab", "mute", "mute tab", "sound", "audio", "selected tab"],
    available: ({ targetTab }) => targetTab !== null && !!targetTab.muted,
  },
  {
    id: "reload-tab",
    label: "Reload Selected Tab",
    actionLabel: "Reload Tab",
    description: "Refresh the highlighted tab",
    shortcut: "⌥R / Alt+R",
    keywords: ["reload", "reload tab", "refresh", "selected tab"],
    available: ({ targetTab }) => targetTab !== null,
  },
  {
    id: "native-split-view",
    label: "Add Selected Tab to Chrome Split View",
    actionLabel: "Start Split View",
    description: "Close TabKnight and continue in Chrome's native same-window Split View picker",
    shortcut: "⌘⌥/",
    keywords: ["split view", "split", "side by side", "pair tabs", "selected tab"],
    available: ({ targetTab }) => targetTab !== null,
  },
  {
    id: "new-tab",
    label: "New Tab",
    actionLabel: "Open New Tab",
    description: "Open a blank tab",
    shortcut: "⌥N / Alt+N",
    keywords: ["new", "new tab", "open", "blank", "tab"],
    available: () => true,
  },
];

/** Revalidates a command against the latest tab state before execution. */
export function isBrowserCommandAvailable(
  commandId: BrowserCommandId,
  context: BrowserCommandContext
): boolean {
  return COMMANDS.find((command) => command.id === commandId)?.available(context) ?? false;
}

function publicCommand(command: CommandDefinition): BrowserCommand {
  const { available: _available, ...result } = command;
  return result;
}

export function getBrowserCommand(
  commandId: BrowserCommandId,
  context: BrowserCommandContext
): BrowserCommand | undefined {
  const command = COMMANDS.find((candidate) => candidate.id === commandId);
  return command?.available(context) ? publicCommand(command) : undefined;
}

export function listBrowserCommands(context: BrowserCommandContext): BrowserCommand[] {
  return COMMANDS.filter((command) => command.available(context)).map(publicCommand);
}

function scoreCommand(command: BrowserCommand, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;
  const label = command.label.toLowerCase();
  if (label === normalized) return 1000;
  if (label.startsWith(normalized)) return 700;
  if (label.includes(normalized)) return 500;
  const keyword = command.keywords.find((candidate) => candidate === normalized);
  if (keyword) return 450;
  const prefix = command.keywords.find((candidate) => candidate.startsWith(normalized));
  if (prefix) return 300;
  return command.keywords.some((candidate) => candidate.includes(normalized)) ? 150 : 0;
}

/** Pure command discovery: filtering never performs a browser action. */
export function findBrowserCommands(query: string, context: BrowserCommandContext): BrowserCommand[] {
  const trimmed = query.trim();
  const commandMode = trimmed.startsWith(">");
  const commandQuery = commandMode ? trimmed.slice(1).trim() : trimmed;
  if (!commandQuery) return commandMode ? listBrowserCommands(context) : [];
  return COMMANDS.filter((command) => isBrowserCommandAvailable(command.id, context))
    .map((command, index) => ({ command, index, score: scoreCommand(command, commandQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ command }) => publicCommand(command));
}
